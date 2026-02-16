import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import OpenAI from 'openai';
import { z } from 'zod';
import path from 'path';
import { log } from '../utils/logger';

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

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async init() {
    if (this.browser) return;

    const userDataDir = path.join(process.cwd(), 'user_data', `session_${this.sessionId}`);
    log(`[${this.sessionId}] 啟動瀏覽器 (userDataDir: ${userDataDir})`);

    this.browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: process.env.HEADLESS === 'true' ? 'new' : false,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800'
      ],
      defaultViewport: { width: 1280, height: 800 }
    });

    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
  }

  async executeTask(goal: string) {
    await this.init();
    let currentStep = 0;
    const history: string[] = [];

    while (currentStep < 15) {
      currentStep++;
      const state = await this.getPageState();

      // 新增機器人偵測檢查
      const isBotDetected = await this.checkBotDetection(state);
      if (isBotDetected) {
        log(`[${this.sessionId}] 偵測到機器人攔截 (CAPTCHA/Challenge)，停止搜尋。`, 'error');
        return { 
          answer: '偵測到機器人攔截，任務終止。', 
          url: state.url 
        };
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
      await new Promise(r => setTimeout(r, 2000));
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
      // 確保頁面還活著
      if (this.page.isClosed()) {
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
          if (decision.param) await this.page.goto(`https://www.google.com/search?q=${encodeURIComponent(decision.param)}`, { waitUntil: 'networkidle2' });
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
