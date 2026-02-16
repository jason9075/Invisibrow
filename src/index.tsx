import { BlessedUI } from './tui/BlessedApp';
import { QueueEngine } from './core/queue';
import { log } from './utils/logger';

async function bootstrap() {
  log('正在初始化系統 (Blessed 版)...');
  
  const queueEngine = new QueueEngine(2);
  
  // 啟動 Blessed TUI
  new BlessedUI(queueEngine);
}

bootstrap().catch(err => {
  console.error('致命錯誤:', err);
});
