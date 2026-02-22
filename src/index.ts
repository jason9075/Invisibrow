import { QueueEngine } from './core/queue';
import { BlessedUI } from './tui/BlessedApp';
import { log } from './utils/logger';

// Load environment variables (though Bun usually handles .env automatically)
// but for explicit clarity or if using 'dotenv' package:
// import 'dotenv/config'; 

async function main() {
  try {
    log('[Main] Starting Invisibrow TUI...');

    // Initialize the Queue Engine
    const queue = new QueueEngine();

    // Initialize the TUI
    const tui = new BlessedUI(queue);

    log('[Main] Application started successfully.');
  } catch (error) {
    console.error('Fatal error starting application:', error);
    process.exit(1);
  }
}

main();
