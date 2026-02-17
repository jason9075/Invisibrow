import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { log } from '../utils/logger';

puppeteer.use(StealthPlugin());

export class BrowserManager {
  private browser: any;
  private page: any;
  private sessionId: string;
  private headless: boolean;

  constructor(sessionId: string, headless: boolean = true) {
    this.sessionId = sessionId;
    this.headless = headless;
  }

  async init() {
    if (this.browser && this.browser.isConnected()) return;

    if (this.browser) {
      await this.close();
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const userDataDir = path.join(homeDir, '.local', 'share', 'invisibrow', 'storage', 'session', this.sessionId);
    log(`[BrowserManager][${this.sessionId}] 啟動瀏覽器 (Headless: ${this.headless}, userDataDir: ${userDataDir})`);

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
      log(`[BrowserManager][${this.sessionId}] 瀏覽器連線中斷`, 'warn');
      this.browser = null;
      this.page = null;
    });

    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();

    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    });
  }

  getPage() {
    return this.page;
  }

  getBrowser() {
    return this.browser;
  }

  setHeadless(val: boolean) {
    this.headless = val;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
