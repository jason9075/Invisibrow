import { z } from 'zod';
import { log, eventBus } from '../../utils/logger';
import { BrowserManager } from '../../core/browser';
import type { IAgent, AgentResponse } from '../../core/types';
import { WatchdogAgent } from '../watchdog';
import OpenAI from 'openai';

const ActionSchema = z.object({
  thought: z.string(),
  action: z.enum(['goto', 'click', 'type', 'search', 'wait', 'finish', 'answer']),
  param: z.string().optional(),
  answer: z.string().optional(),
});

export type BrowserAction = z.infer<typeof ActionSchema>;

export class BrowserAgent implements IAgent<string, { answer: string; url: string }> {
  readonly card = {
    name: 'BrowserAgent',
    description: '負責自主瀏覽網頁、搜尋資訊並執行互動操作',
    version: '1.0.0',
    skills: [
      {
        id: 'web_navigation',
        name: '網頁導航',
        description: '前往指定 URL 並獲取頁面內容'
      },
      {
        id: 'web_interaction',
        name: '網頁互動',
        description: '點擊、輸入文字、搜尋等操作'
      }
    ]
  };

  private openai: OpenAI;
  private browserMgr: BrowserManager;
  private watchdog: WatchdogAgent;
  public sessionId: string;

  constructor(sessionId: string, headless: boolean = true) {
    this.sessionId = sessionId;
    this.browserMgr = new BrowserManager(sessionId, headless);
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL
    });
    this.watchdog = new WatchdogAgent(sessionId);
  }

  public setHeadless(val: boolean) {
    this.browserMgr.setHeadless(val);
  }


  async execute(taskId: string, goal: string): Promise<AgentResponse<{ answer: string; url: string }>> {
    try {
      if (goal === 'MANUAL_LOGIN') {
        await this.browserMgr.init();
        const page = this.browserMgr.getPage();
        log(`[${this.sessionId}] [${taskId}] 進入手動操作模式 (300 秒)`);
        if (page.url() === 'about:blank') {
          await page.goto('https://www.google.com');
        }
        await new Promise(r => setTimeout(r, 300000));
        return { 
          status: 'success', 
          data: { answer: '手動操作結束', url: page.url() } 
        };
      }

      const result = await this.runAutomation(taskId, goal);
      return { status: 'success', data: result };
    } catch (error: any) {
      return { 
        status: 'failed', 
        data: { answer: '', url: '' }, 
        message: error.message 
      };
    }
  }

  public async runAutomation(taskId: string, goal: string) {
    await this.browserMgr.init();
    let currentStep = 0;
    const history: string[] = [];

    while (currentStep < 15) {
      currentStep++;
      const state = await this.getPageState();

      const isBotDetected = await this.checkBotDetection(state);
      if (isBotDetected) {
        log(`[${this.sessionId}] [${taskId}] 偵測到機器人攔截，詢問使用者是否手動排除...`, 'warn');
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
          throw new Error('使用者取消驗證排除');
        }

        this.browserMgr.setHeadless(false);
        await this.browserMgr.init();
        const page = this.browserMgr.getPage();
        await page.goto(state.url, { waitUntil: 'networkidle2' });

        await new Promise<void>((resolve) => {
          const handler = (data: any) => {
            if (data.sessionId === this.sessionId) {
              eventBus.off('verification_resolved', handler);
              resolve();
            }
          };
          eventBus.on('verification_resolved', handler);
        });
        continue;
      }

      const decision = await this.getDecision(goal, state, history);
      log(`[${this.sessionId}] [${taskId}] Step ${currentStep}: ${decision.thought}`);
      history.push(`${currentStep}: ${decision.thought}`);

      if (decision.action === 'answer' || decision.action === 'finish') {
        return { 
          answer: decision.answer || '任務完成', 
          url: state.url 
        };
      }

      await this.performAction(decision);
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    }
    throw new Error('達到最大步數限制');
  }

  private async checkBotDetection(state: any): Promise<boolean> {
    const botKeywords = ['CAPTCHA', 'Verify you are human', 'Are you a robot', '偵測到異常流量', '請證明你不是機器人', 'Google 驗證頁面'];
    const hasKeyword = botKeywords.some(keyword => 
      state.contentSnippet.toLowerCase().includes(keyword.toLowerCase()) || 
      state.title.toLowerCase().includes(keyword.toLowerCase())
    );
    return hasKeyword || state.url.includes('google.com/sorry/index');
  }

  public async getPageState() {
    await this.browserMgr.init();
    const page = this.browserMgr.getPage();
    try {
      return await page.evaluate(() => {
        const selectors = 'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
        const elements = Array.from(document.querySelectorAll(selectors))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

        return {
          url: window.location.href,
          title: document.title,
          interactiveElements: elements
            .slice(0, 100)
            .map((el, i) => ({ 
              id: i, 
              tag: el.tagName,
              text: (el as any).innerText?.trim().substring(0, 50) || (el as any).placeholder || (el as any).getAttribute('aria-label') || '' 
            })),
          contentSnippet: (document.body as HTMLElement).innerText.substring(0, 1500)
        };
      });
    } catch (e: any) {
      log(`[${this.sessionId}] 獲取頁面狀態失敗: ${e.message}`, 'error');
      throw e;
    }
  }

  private async getDecision(goal: string, state: any, history: string[]) {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
  "thought": "你的思考過程",
  "action": "goto" | "click" | "type" | "search" | "wait" | "finish" | "answer",
  "param": "動作參數 (ID:文字 或 URL)",
  "answer": "最終答案"
}` 
        },
        { role: 'user', content: JSON.stringify(state) }
      ],
      response_format: { type: 'json_object' }
    });
    return JSON.parse(response.choices[0].message.content!) as BrowserAction;
  }

  private async performAction(decision: BrowserAction) {
    const page = this.browserMgr.getPage();
    try {
      switch (decision.action) {
        case 'goto':
          if (decision.param) await page.goto(decision.param, { waitUntil: 'networkidle2', timeout: 30000 });
          break;
        case 'search':
          if (decision.param) {
            await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
            const searchInput = await page.$('textarea[name="q"], input[name="q"]');
            if (searchInput) {
              await searchInput.focus();
              await searchInput.click();
              await page.keyboard.type(decision.param, { delay: 150 + Math.random() * 200 });
              await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
              await page.keyboard.press('Enter');
              await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 });
            } else {
              await page.goto(`https://www.google.com/search?q=${encodeURIComponent(decision.param)}`, { waitUntil: 'networkidle2' });
            }
          }
          break;
        case 'click':
          if (decision.param) {
            const id = parseInt(decision.param);
            await page.evaluate((targetId: number) => {
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
            await new Promise(r => setTimeout(r, 2500));
          }
          break;
        case 'type':
          if (decision.param) {
            const [targetId, ...textParts] = decision.param.split(':');
            const text = textParts.join(':');
            const id = parseInt(targetId);
            await page.evaluate((tid: number, txt: string) => {
              const selectors = 'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
              const el = Array.from(document.querySelectorAll(selectors))[tid] as HTMLElement;
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.focus();
                el.click();
                document.execCommand('insertText', false, txt);
              }
            }, id, text);
            await page.keyboard.press('Enter');
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
    await this.browserMgr.close();
  }
}
