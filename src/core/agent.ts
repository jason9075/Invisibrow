import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import OpenAI from 'openai';
import { z } from 'zod';
import path from 'path';
import { log, eventBus } from '../utils/logger';

puppeteer.use(StealthPlugin());

const ActionSchema = z.object({
  thought: z.string(),
  action: z.enum(['goto', 'click', 'type', 'search', 'wait', 'finish', 'answer']),
  param: z.string().optional(),
  answer: z.string().optional(),
});

export class BrowserAgent {
  private browser: any;
  private page: any;
  private openai: OpenAI;
  public sessionId: string;
  private headless: boolean;

  constructor(sessionId: string, headless: boolean = true) {
    this.sessionId = sessionId;
    this.headless = headless;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async init() {
    if (this.browser && this.browser.isConnected()) return;

    // 如果瀏覽器存在但連線中斷，先清理
    if (this.browser) {
      await this.close();
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const userDataDir = path.join(homeDir, '.local', 'share', 'invisibrow', 'storage', 'session', this.sessionId);
    log(`[${this.sessionId}] 啟動瀏覽器 (Headless: ${this.headless}, userDataDir: ${userDataDir})`);

    this.browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: this.headless as any,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800',
        '--lang=zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
      ],
      defaultViewport: { width: 1280, height: 800 }
    });

    this.browser.on('disconnected', () => {
      log(`[${this.sessionId}] 瀏覽器連線中斷 (可能是手動關閉或崩潰)`, 'warn');
      this.browser = null;
      this.page = null;
    });

    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();

    // 額外的 Stealth 設定
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    });
  }

  async executeTask(goal: string) {
    await this.init();

    if (goal === 'MANUAL_LOGIN') {
      log(`[${this.sessionId}] 進入手動操作模式 (300 秒)`);
      // 確保至少有一個空白頁或當前頁
      if (this.page.url() === 'about:blank') {
        await this.page.goto('https://www.google.com');
      }
      await new Promise(r => setTimeout(r, 300000));
      return { answer: '手動操作結束', url: this.page.url() };
    }

    let currentStep = 0;
    const history: string[] = [];

    while (currentStep < 15) {
      currentStep++;
      const state = await this.getPageState();

      // 新增機器人偵測檢查
      const isBotDetected = await this.checkBotDetection(state);
      if (isBotDetected) {
        log(`[${this.sessionId}] 偵測到機器人攔截，詢問使用者是否手動排除...`, 'warn');
        
        // 1. 通知 TUI 並等待使用者決定 (Yes/No)
        eventBus.emit('verification_needed', { sessionId: this.sessionId, url: state.url });
        
        const decision = await new Promise<'accept' | 'deny'>((resolve) => {
          const onAccept = (data: any) => {
            if (data.sessionId === this.sessionId) {
              eventBus.off('verification_accepted', onAccept);
              eventBus.off('verification_denied', onDeny);
              resolve('accept');
            }
          };
          const onDeny = (data: any) => {
            if (data.sessionId === this.sessionId) {
              eventBus.off('verification_accepted', onAccept);
              eventBus.off('verification_denied', onDeny);
              resolve('deny');
            }
          };
          eventBus.on('verification_accepted', onAccept);
          eventBus.on('verification_denied', onDeny);
        });

        if (decision === 'deny') {
          log(`[${this.sessionId}] 使用者取消手動排除，終止任務。`, 'error');
          return { answer: '使用者取消驗證排除，任務終止。', url: state.url };
        }

        log(`[${this.sessionId}] 使用者同意排除，切換至 GUI 模式...`);
        
        // 2. 切換至 GUI 模式
        const wasHeadless = this.headless;
        if (wasHeadless) {
          await this.close();
          this.headless = false;
          await this.init();
          // 重啟後可能需要重新進入該頁面
          await this.page.goto(state.url, { waitUntil: 'networkidle2' });
        }

        // 3. 阻塞直到使用者按下 C
        await new Promise<void>((resolve) => {
          const handler = (data: any) => {
            if (data.sessionId === this.sessionId) {
              eventBus.off('verification_resolved', handler);
              resolve();
            }
          };
          eventBus.on('verification_resolved', handler);
        });

        log(`[${this.sessionId}] 驗證完成，繼續任務...`);
        continue;
      }

      const decision = await this.getDecision(goal, state, history);
      
      log(`[${this.sessionId}] Step ${currentStep}: ${decision.thought}`);
      history.push(`${currentStep}: ${decision.thought}`);

      if (decision.action === 'answer' || decision.action === 'finish') {
        return { 
          answer: decision.answer || '任務完成', 
          url: state.url 
        };
      }

      await this.performAction(decision);
      // 隨機等待 2-4 秒，模擬人類觀察頁面
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    }
    throw new Error('達到最大步數限制');
  }

  private async checkBotDetection(state: any): Promise<boolean> {
    const botKeywords = [
      'CAPTCHA',
      'Verify you are human',
      'Are you a robot',
      '偵測到異常流量',
      '請證明你不是機器人',
      'Google 驗證頁面'
    ];
    
    // 檢查內容片段和標題
    const hasKeyword = botKeywords.some(keyword => 
      state.contentSnippet.toLowerCase().includes(keyword.toLowerCase()) || 
      state.title.toLowerCase().includes(keyword.toLowerCase())
    );

    // Google 驗證頁面常見 URL 特徵
    const isGoogleCaptcha = state.url.includes('google.com/sorry/index');

    return hasKeyword || isGoogleCaptcha;
  }

  private async getPageState() {
    try {
      // 確保瀏覽器和頁面仍然有效
      await this.init();

      if (!this.page || this.page.isClosed()) {
        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();
      }

      return await this.page.evaluate(() => {
        // 增加選擇器範圍，並過濾掉隱藏元素
        const selectors = 'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
        const elements = Array.from(document.querySelectorAll(selectors))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0; // 只要看得到的
          });

        return {
          url: window.location.href,
          title: document.title,
          interactiveElements: elements
            .slice(0, 100) // 增加到 100 個
            .map((el, i) => ({ 
              id: i, 
              tag: el.tagName,
              text: (el as any).innerText?.trim().substring(0, 50) || (el as any).placeholder || (el as any).getAttribute('aria-label') || '' 
            })),
          contentSnippet: document.body.innerText.substring(0, 1500) // 增加長度
        };
      });
    } catch (e: any) {
      if (e.message.includes('detached') || e.message.includes('protocol error')) {
        log(`[${this.sessionId}] 偵測到 Frame 異常，嘗試重新等待頁面穩定...`, 'warn');
        await new Promise(r => setTimeout(r, 2000));
        return this.getPageState(); // 重試
      }
      throw e;
    }
  }

  private async getDecision(goal: string, state: any, history: string[]) {
    const response = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: `你是一個專業的自主瀏覽器 Agent。你的目標是：${goal}
目前的歷史紀錄：
${history.join('\n')}

### 操作指南：
1. 觀察 URL 和 ContentSnippet 判斷是否成功跳轉。
2. 如果連續兩次執行相同 Action 且頁面狀態沒變，請嘗試點擊其他相關元素或使用不同的 Action。
3. 對於 X.com (Twitter) 等社交媒體，請優先尋找 [role="article"] 或包含文字的區塊。
4. 如果發現被 Block (如出現驗證碼)，請立即回報。

請決定下一步動作。回傳格式必須是 JSON 物件：
{
  "thought": "你的思考過程 (請確認目前的頁面是否符合預期)",
  "action": "goto" | "click" | "type" | "search" | "wait" | "finish" | "answer",
  "param": "動作參數 (ID:文字 或 URL)",
  "answer": "最終答案"
}` 
        },
        { role: 'user', content: JSON.stringify(state) }
      ],
      response_format: { type: 'json_object' }
    });
    return JSON.parse(response.choices[0].message.content!) as z.infer<typeof ActionSchema>;
  }

  private async performAction(decision: any) {
    try {
      switch (decision.action) {
        case 'goto':
          if (decision.param) await this.page.goto(decision.param, { waitUntil: 'networkidle2', timeout: 30000 });
          break;
        case 'search':
          if (decision.param) {
            log(`[${this.sessionId}] 模擬真人搜尋流程: ${decision.param}`);
            // 1. 先去 Google 首頁
            await this.page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
            
            // 2. 隨機等待 1-2 秒，模擬思考
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

            // 3. 尋找輸入框 (Google 的輸入框通常是 textarea[name="q"] 或 input[name="q"])
            const searchInput = await this.page.$('textarea[name="q"], input[name="q"]');
            if (searchInput) {
              await searchInput.focus();
              await searchInput.click();
              // 4. 模擬人類打字速度
              await this.page.keyboard.type(decision.param, { delay: 150 + Math.random() * 200 });
              // 5. 隨機等待一下再按 Enter
              await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
              await this.page.keyboard.press('Enter');
              // 6. 等待搜尋結果加載，增加 timeout 並檢查可能的 bot 偵測
              await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 });
            } else {
              // 退而求其次使用直接跳轉 (作為備案)
              log(`[${this.sessionId}] 找不到搜尋框，改用直接跳轉`, 'warn');
              await this.page.goto(`https://www.google.com/search?q=${encodeURIComponent(decision.param)}`, { waitUntil: 'networkidle2' });
            }
          }
          break;
        case 'click':
          if (decision.param) {
            const id = parseInt(decision.param);
            await this.page.evaluate((targetId: number) => {
              const selectors = 'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
              const elements = Array.from(document.querySelectorAll(selectors)).filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              const el = elements[targetId] as HTMLElement;
              if (el) {
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
                el.click();
              }
            }, id);
            // 點擊後多等一下，讓 X.com 這種 SPA 有時間渲染
            await new Promise(r => setTimeout(r, 2500));
          }
          break;
        case 'type':
          if (decision.param) {
            const [targetId, ...textParts] = decision.param.split(':');
            const text = textParts.join(':');
            const id = parseInt(targetId);
            
            await this.page.evaluate((tid: number, txt: string) => {
              const selectors = 'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
              const el = Array.from(document.querySelectorAll(selectors))[tid] as HTMLElement;
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.focus();
                el.click();
                // 學習 project-golem 的方式，模擬真實輸入
                document.execCommand('insertText', false, txt);
              }
            }, id, text);

            await this.page.keyboard.press('Enter');
          }
          break;
        case 'wait':
          await new Promise(r => setTimeout(r, 5000));
          break;
      }
      log(`[${this.sessionId}] 執行動作完成: ${decision.action}`);
    } catch (e: any) {
      log(`[${this.sessionId}] 執行動作失敗: ${e.message}`, 'error');
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
