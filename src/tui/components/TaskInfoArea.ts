import blessed from 'blessed';
import { QueueEngine, AgentTask } from '../../core/queue';
import { PersistedSession } from '../types';

export class TaskInfoArea {
  widget: blessed.Widgets.BoxElement;

  constructor(screen: blessed.Widgets.Screen, headerHeight: number, infoHeight: number, sidebarWidth: number) {
    this.widget = blessed.box({
      parent: screen,
      top: headerHeight,
      left: sidebarWidth,
      width: `100%-${sidebarWidth}`,
      height: infoHeight,
      label: ' Session Info ',
      border: { type: 'line' },
      style: { border: { fg: 'gray' } },
      tags: true
    });
  }

  update(session: PersistedSession | undefined, tasks: AgentTask[]) {
    if (session) {
      const id = session.id;
      const created = new Date(session.createdAt || Date.now()).toLocaleString();
      const updated = new Date(session.updatedAt).toLocaleString();
      const stats = session.stats || { tokens: 0, cost: 0, contextSize: 0 };
      
      const infoText = [
        `{cyan-fg}ID:{/} ${id.padEnd(15)} {cyan-fg}Created:{/} ${created} {cyan-fg}Updated:{/} ${updated}`,
        `{yellow-fg}Tokens:{/} ${stats.tokens.toLocaleString()} (Limit: 1M) | {yellow-fg}Cost:{/} $${stats.cost.toFixed(4)} | {yellow-fg}Context:{/} ${stats.contextSize} msgs`
      ].join('\n');
      this.widget.setContent(infoText);
    } else {
      this.widget.setContent('No session selected');
    }
  }
}
