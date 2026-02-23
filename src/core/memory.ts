import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { log } from '../utils/logger';

const DEFAULT_BOT_KEYWORDS = [
  'captcha',
  'verify you are human',
  'are you a robot',
  '偵測到異常流量',
  '請證明你不是機器人',
  'google 驗證頁面',
];

export interface MemoryRecord {
  id: string;
  goal: string;
  keywords: string[];
  summary: string;
  artifacts: any;
  status: 'success' | 'failed';
  timestamp?: string;
}

export class MemoryService {
  private db: Database;
  private storagePath: string;

  constructor() {
    this.storagePath = path.join(os.homedir(), '.local', 'share', 'invisibrow', 'storage');
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
    const dbPath = path.join(this.storagePath, 'memory.sqlite');
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        goal TEXT,
        keywords TEXT,
        summary TEXT,
        artifacts_json TEXT,
        status TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_keywords ON memories(keywords)`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS bot_keywords (
        keyword TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.seedDefaultBotKeywords();
  }

  async save(record: MemoryRecord) {
    try {
      const query = this.db.prepare(`
        INSERT OR REPLACE INTO memories (id, goal, keywords, summary, artifacts_json, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      query.run(
        record.id,
        record.goal,
        record.keywords.join(','),
        record.summary,
        JSON.stringify(record.artifacts),
        record.status
      );
      log(`[Memory] 已儲存記憶: ${record.id} (Tags: ${record.keywords.join(', ')})`);
    } catch (e: any) {
      log(`[Memory] 儲存失敗: ${e.message}`, 'error');
    }
  }

  async search(keywords: string[]): Promise<MemoryRecord[]> {
    try {
      if (keywords.length === 0) return [];

      // 使用簡單的 LIKE 進行關鍵字匹配
      const conditions = keywords.map(() => `keywords LIKE ?`).join(' OR ');
      const query = this.db.prepare(`
        SELECT * FROM memories 
        WHERE status = 'success' AND (${conditions})
        ORDER BY timestamp DESC
        LIMIT 5
      `);

      const params = keywords.map((k) => `%${k}%`);
      const results = query.all(...params) as any[];

      return results.map((r) => ({
        id: r.id,
        goal: r.goal,
        keywords: r.keywords.split(','),
        summary: r.summary,
        artifacts: JSON.parse(r.artifacts_json),
        status: r.status as any,
        timestamp: r.timestamp,
      }));
    } catch (e: any) {
      log(`[Memory] 搜尋失敗: ${e.message}`, 'error');
      return [];
    }
  }

  async getBotKeywords(): Promise<string[]> {
    try {
      const rows = this.db.prepare(`SELECT keyword FROM bot_keywords ORDER BY created_at DESC`).all() as any[];
      if (!rows.length) {
        this.seedDefaultBotKeywords();
        return DEFAULT_BOT_KEYWORDS.map((keyword) => this.normalizeKeyword(keyword));
      }

      return rows.map((row) => row.keyword);
    } catch (e: any) {
      log(`[Memory] 讀取 bot keywords 失敗: ${e.message}`, 'error');
      return DEFAULT_BOT_KEYWORDS.map((keyword) => this.normalizeKeyword(keyword));
    }
  }

  async addBotKeyword(keyword: string) {
    const normalized = this.normalizeKeyword(keyword);
    if (!normalized) return;

    try {
      this.db.prepare(`INSERT OR IGNORE INTO bot_keywords (keyword) VALUES (?)`).run(normalized);
      log(`[Memory] 儲存 bot keyword: ${normalized}`);
    } catch (e: any) {
      log(`[Memory] bot keyword 儲存失敗: ${e.message}`, 'error');
    }
  }

  /**
   * 取得所有 bot keywords（給 UI 顯示用）
   */
  async getAllBotKeywords(): Promise<string[]> {
    return this.getBotKeywords();
  }

  /**
   * 刪除指定 bot keyword
   */
  async deleteBotKeyword(keyword: string) {
    const normalized = this.normalizeKeyword(keyword);
    if (!normalized) return;

    try {
      this.db.prepare(`DELETE FROM bot_keywords WHERE keyword = ?`).run(normalized);
      log(`[Memory] 刪除 bot keyword: ${normalized}`);
    } catch (e: any) {
      log(`[Memory] bot keyword 刪除失敗: ${e.message}`, 'error');
    }
  }

  async addBotKeywordsFromText(text: string) {
    if (!text) return;
    const cleaned = text.replace(/\r?\n/g, ' ').trim();
    const tokens = cleaned
      .split(/[\s,.;:?!\/\\\-()\[\]{}]+/)
      .map((token) => token.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, ''))
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
      .slice(0, 12);

    const uniqueTokens = Array.from(new Set(tokens));
    for (const token of uniqueTokens) {
      await this.addBotKeyword(token);
    }
  }

  private seedDefaultBotKeywords() {
    try {
      const insert = this.db.prepare(`INSERT OR IGNORE INTO bot_keywords (keyword) VALUES (?)`);
      for (const keyword of DEFAULT_BOT_KEYWORDS) {
        insert.run(this.normalizeKeyword(keyword));
      }
    } catch (e: any) {
      log(`[Memory] 初始化 bot keywords 失敗: ${e.message}`, 'error');
    }
  }

  private normalizeKeyword(value: string): string {
    return value.trim().toLowerCase();
  }
}

export const memoryService = new MemoryService();

