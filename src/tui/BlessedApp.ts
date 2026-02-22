import { App } from './components/App';
import { QueueEngine } from '../core/queue';

export class BlessedUI {
  app: App;

  constructor(queueEngine: QueueEngine) {
    this.app = new App(queueEngine);
  }
}
