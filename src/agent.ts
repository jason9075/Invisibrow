import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import OpenAI from 'openai';
import { z } from 'zod';
import path from 'path';
import { exec } from 'child_process';

puppeteer.use(StealthPlugin());

const ActionSchema = z.object({
  thought: z.string(),
  action: z.enum(['goto', 'click', 'type', 'search', 'wait', 'finish', 'answer']),
  param: z.string().optional(),
  answer: z.string().optional(),
});

type Action = z.infer<typeof ActionSchema>;

interface Task {
  goal: string;
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
}

export class BrowserAgent {
  private browser: any;
  private page: any;
  private openai: OpenAI;
  private queue: Task[] = [];
  private isProcessing = false;
  private maxSteps = 15;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  private async notify(message: string, icon: string = 'dialog-information') {
    const title = '🤖 AI Browser Agent';
    exec(`notify-send -i ${icon} "${title}" "${message}"`);
  }

  private async captureDebugScreenshot(step: number, name: string = 'debug') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `debug_screenshots/${timestamp}_step${step}_${name}.png`;
    await this.page.screenshot({ path: filename, fullPage: true });
    console.log(`📸 Screenshot saved: ${filename}`);
    return filename;
  }

  async init() {
    if (this.browser) return;

    const useSession = process.env.USE_SESSION === 'true';
    const userDataDir = useSession ? path.join(process.cwd(), 'user_data') : undefined;

    console.log(`🚀 Starting browser (Session: ${useSession ? 'Persistent' : 'Ephemeral'})...`);
    
    this.browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: process.env.HEADLESS !== 'false' ? 'new' : false,
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

  async solve(goal: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ goal, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    const task = this.queue.shift()!;

    try {
      await this.init();
      let currentStep = 0;
      let history: string[] = [];

      while (currentStep < this.maxSteps) {
        currentStep++;
        console.log(`\n--- [Step ${currentStep}] ---`);
        
        const state = await this.getPageState();
        const decision = await this.getDecision(task.goal, state, history);
        
        console.log(`🧠 Thought: ${decision.thought}`);
        console.log(`🎬 Action: ${decision.action} ${decision.param ? `(${decision.param})` : ''}`);

        history.push(`Step ${currentStep}: ${decision.thought} -> ${decision.action}`);

        if (decision.action === 'finish' || decision.action === 'answer') {
          const result = decision.answer || '任務已完成';
          await this.notify(`✅ 任務完成: ${result}`);
          task.resolve(result);
          break;
        }

        await this.executeAction(decision, currentStep);
        await new Promise(r => setTimeout(r, 3000));
      }

      if (currentStep >= this.maxSteps) {
        const screenshot = await this.captureDebugScreenshot(currentStep, 'timeout');
        await this.notify(`⚠️ 任務逾時 (15步)，截圖已存至 ${screenshot}`, 'dialog-warning');
        task.reject('已達到最大步數上限');
      }
    } catch (error: any) {
      console.error('Processing error:', error);
      const screenshot = await this.captureDebugScreenshot(99, 'error');
      await this.notify(`❌ 任務發生錯誤: ${error.message}\n截圖已存至 ${screenshot}`, 'dialog-error');
      task.reject(error);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 500);
      }
    }
  }

  private async getPageState() {
    return await this.page.evaluate(() => {
      const selectors = 'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
      const elements = Array.from(document.querySelectorAll(selectors))
        .map((el, index) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none') return null;
          
          let text = (el as any).innerText || (el as any).placeholder || (el as any).value || el.getAttribute('aria-label') || el.getAttribute('title') || '';
          text = text.trim().substring(0, 50);
          
          if (!text && el.tagName === 'A') text = el.getAttribute('href') || '';
          if (!text && el.getAttribute('role') === 'textbox') text = '輸入框 (Textbox)';

          return {
            id: index,
            tag: el.tagName.toLowerCase(),
            text: text || `[${el.tagName.toLowerCase()}]`,
            role: el.getAttribute('role') || ''
          };
        })
        .filter(el => el !== null)
        .slice(0, 100);

      return {
        url: window.location.href,
        title: document.title,
        interactiveElements: elements,
        contentSnippet: document.body.innerText.substring(0, 1500).replace(/\s+/g, ' ')
      };
    });
  }

  private async getDecision(goal: string, state: any, history: string[]): Promise<Action> {
    const prompt = `你是一個自主瀏覽器 Agent。你的目標是：${goal}
目前的歷史紀錄：
${history.join('\n')}

請觀察目前的網頁狀態，決定下一步動作。
回傳格式必須是 JSON 物件：
{
  "thought": "你的思考過程 (請分析目前是否已在正確的頁面，避免重複無效動作)",
  "action": "goto" | "click" | "type" | "search" | "wait" | "answer",
  "param": "動作參數",
  "answer": "如果是 answer 動作，請填寫最終答案"
}

重要準則：
1. **驗證目標**：在發送訊息前，務必確認目前開啟的對話對象是否完全符合目標要求。
2. **避免重複**：如果連續兩次動作相同且沒有進展，請嘗試不同的方法（例如改用搜尋或點擊其他相關元素）。
3. **精準點擊**：查看 interactiveElements 中的文字，確保點擊的是正確的人名或按鈕。
4. **Discord 技巧**：搜尋好友可以點擊左上角的「尋找或開始對話」或使用快捷鍵。`;

    const response = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `目前狀態: ${JSON.stringify(state)}` }
      ],
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content || '{}';
    try {
      const parsed = JSON.parse(content);
      // 容錯處理：如果 AI 寫了 open_url，自動轉為 goto
      if (parsed.action === 'open_url') parsed.action = 'goto';
      return parsed as Action;
    } catch (e) {
      console.error('JSON 解析失敗:', content);
      throw e;
    }
  }

  private async executeAction(decision: Action, step: number) {
    try {
      switch (decision.action) {
        case 'goto':
          if (decision.param) await this.page.goto(decision.param, { waitUntil: 'networkidle2' });
          break;
        case 'search':
          if (decision.param) await this.page.goto(`https://www.google.com/search?q=${encodeURIComponent(decision.param)}`, { waitUntil: 'networkidle2' });
          break;
        case 'click':
          if (decision.param) {
            const id = parseInt(decision.param);
            await this.page.evaluate((targetId: number) => {
              const selectors = 'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
              const el = Array.from(document.querySelectorAll(selectors))[targetId] as HTMLElement;
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.click();
              }
            }, id);
          }
          break;
        case 'type':
          if (decision.param) {
            const [targetId, ...textParts] = decision.param.split(':');
            const text = textParts.join(':');
            const id = parseInt(targetId);
            
            await this.page.evaluate((tid: number) => {
              const selectors = 'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
              const el = Array.from(document.querySelectorAll(selectors))[tid] as HTMLElement;
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.focus();
                el.click();
              }
            }, id);

            await this.page.keyboard.type(text, { delay: 100 });
            await this.page.keyboard.press('Enter');
          }
          break;
        case 'wait':
          await new Promise(r => setTimeout(r, 5000));
          break;
      }
    } catch (e) {
      console.error('Action execution failed:', e);
      await this.captureDebugScreenshot(step, 'action_failed');
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
