import path from 'path';
import fs from 'fs';
import os from 'os';
import { log } from './logger';

export interface TokenUsage {
  /** prompt_tokens（含 cached） */
  promptTokens: number;
  /** completion_tokens */
  completionTokens: number;
  /** prompt_tokens_details.cached_tokens（命中 OpenAI Prompt Cache 的部分） */
  cachedTokens: number;
  /** 使用的 model 名稱，用於計算成本 */
  model: string;
}

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
      cached_tokens: number;
    };
  };
}

export class MessageLogger {
  private static storageBase = path.join(os.homedir(), '.local', 'share', 'invisibrow', 'storage', 'message');

  static async log(record: MessageLogRecord, onTokenUsage?: (usage: TokenUsage) => void) {
    // 即時回呼，讓 QueueEngine 累積 session stats
    if (onTokenUsage) {
      onTokenUsage({
        promptTokens: record.response.usage.input_tokens,
        completionTokens: record.response.usage.output_tokens,
        cachedTokens: record.response.usage.cached_tokens,
        model: record.model,
      });
    }
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
