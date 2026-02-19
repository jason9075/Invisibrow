import path from 'path';
import fs from 'fs';
import os from 'os';
import { log } from './logger';

export interface MessageLogRecord {
  timestamp: string;
  session_id: string;
  agent_type: string;
  model: string;
  messages: any[];
  response: {
    content: string;
    reasoning?: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

export class MessageLogger {
  private static storageBase = path.join(os.homedir(), '.local', 'share', 'invisibrow', 'storage', 'message');

  static async log(record: MessageLogRecord) {
    try {
      const dirPath = path.join(this.storageBase, record.session_id, record.agent_type);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // 格式化檔名: msg_20250219_210914.json
      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/[-:]/g, '')
        .replace(/\..+/, '')
        .replace('T', '_');
      
      const fileName = `msg_${timestamp}.json`;
      const filePath = path.join(dirPath, fileName);

      await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
      // log(`[MessageLogger] 已儲存對話紀錄: ${filePath}`);
    } catch (e: any) {
      log(`[MessageLogger] 儲存對話紀錄失敗: ${e.message}`, 'error');
    }
  }
}
