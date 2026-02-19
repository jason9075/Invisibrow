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
    // 檢查舊的啟動參數
    let isHeadlessChanged = false;
    if (this.browser && this.browser.isConnected()) {
      try {
        const oldOptions = this.browser.process()?.spawnargs || [];
        const isActuallyHeadless = oldOptions.some((arg: string) => arg.includes('--headless'));
        isHeadlessChanged = isActuallyHeadless !== this.headless;
      } catch (e) {
        isHeadlessChanged = true;
      }
    }

    if (this.browser && this.browser.isConnected() && !isHeadlessChanged) return;

    if (this.browser) {
      log(`[BrowserManager][${this.sessionId}] 偵測到 Headless 狀態改變或連線中斷，正在重新啟動...`);
      await this.close();
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const userDataDir = path.join(homeDir, '.local', 'share', 'invisibrow', 'storage', 'session', this.sessionId);
    log(`[BrowserManager][${this.sessionId}] 啟動瀏覽器 (Headless: ${this.headless}, userDataDir: ${userDataDir})`);

    try {
      this.browser = await (puppeteer as any).launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: this.headless,
        userDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--window-size=1280,800',
          '--lang=zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          this.headless ? '' : '--start-maximized'
        ].filter(Boolean),
        defaultViewport: this.headless ? { width: 1280, height: 800 } : null
      });
    } catch (launchError: any) {
      log(`[BrowserManager][${this.sessionId}] 啟動失敗: ${launchError.message}`, 'error');
      // 清理狀態以允許下一次嘗試
      this.browser = null;
      throw launchError;
    }

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
