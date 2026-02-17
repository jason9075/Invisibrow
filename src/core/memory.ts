import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { log } from '../utils/logger';

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
    // 建立關鍵字索引以加速搜尋
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_keywords ON memories(keywords)`);
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

      const params = keywords.map(k => `%${k}%`);
      const results = query.all(...params) as any[];

      return results.map(r => ({
        id: r.id,
        goal: r.goal,
        keywords: r.keywords.split(','),
        summary: r.summary,
        artifacts: JSON.parse(r.artifacts_json),
        status: r.status as any,
        timestamp: r.timestamp
      }));
    } catch (e: any) {
      log(`[Memory] 搜尋失敗: ${e.message}`, 'error');
      return [];
    }
  }
}

export const memoryService = new MemoryService();
