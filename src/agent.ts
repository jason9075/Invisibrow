import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import OpenAI from 'openai';

puppeteer.use(StealthPlugin());

/**
 * AI Browser Agent
 * 核心功能：啟動瀏覽器，執行 AI 指令
 */
export class BrowserAgent {
  private browser: any;
  private page: any;
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * 啟動瀏覽器
   */
  async init() {
    console.log('🚀 Starting browser...');
    this.browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: process.env.HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    this.page = await this.browser.newPage();
    
    // 設置隨機 User-Agent 與 Viewport
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await this.page.setViewport({ width: 1280, height: 800 });
  }

  /**
   * 導覽至網址
   */
  async goto(url: string) {
    console.log(`🌐 Navigating to ${url}...`);
    await this.page.goto(url, { waitUntil: 'networkidle2' });
  }

  /**
   * 取得網頁簡化內容供 AI 分析
   */
  async getPageContent() {
    return await this.page.evaluate(() => {
      // 移除不必要的標籤以節省 Token
      const scripts = document.querySelectorAll('script, style, noscript, iframe');
      scripts.forEach(s => s.remove());
      
      // 取得頁面主要文字內容
      return {
        title: document.title,
        body: document.body.innerText.substring(0, 10000), // 限制長度
        url: window.location.href
      };
    });
  }

  /**
   * 分析頁面並決定下一步
   */
  async analyze(query: string) {
    const content = await this.getPageContent();
    console.log('🧠 Analyzing page with OpenAI...');

    const response = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: '你是一個網頁瀏覽 Agent。根據提供的頁面內容，回答使用者的問題或建議下一步操作。請以繁體中文回答。'
        },
        {
          role: 'user',
          content: `頁面標題: ${content.title}\n頁面網址: ${content.url}\n頁面內容: ${content.body}\n\n使用者指令: ${query}`
        }
      ],
    });

    return response.choices[0].message.content;
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}
