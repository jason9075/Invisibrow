import winston from 'winston';
import { EventEmitter } from 'events';

/**
 * 全域事件匯流排
 * log: 日誌更新
 * verification_needed: 偵測到驗證碼，詢問是否排除
 * verification_accepted: 使用者同意排除
 * verification_denied: 使用者拒絕排除
 * verification_resolved: 驗證完成（按下 c）
 */
export const eventBus = new EventEmitter();

/**
 * 配置 Winston Logger
 */
export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'tmp/app.log' }),
  ],
});

/**
 * 自定義日誌函式，同時寫入檔案並推送到 TUI
 */
export const log = (message: string, level: string = 'info') => {
  logger.log(level, message);
  eventBus.emit('log', { message, level, timestamp: new Date() });
};

/**
 * 脫敏處理：隱藏敏感資訊
 */
export const maskSecrets = (text: string): string => {
  return text.replace(/(sk-[a-zA-Z0-9]{32})|([a-zA-Z0-9]{20,}:[a-zA-Z0-9]{20,})/g, '********');
};
