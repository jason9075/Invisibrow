import winston from 'winston';
import { EventEmitter } from 'events';

/**
 * 全域事件匯流排，用於 TUI 訂閱日誌
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
