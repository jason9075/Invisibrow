import blessed from 'blessed';
import { QueueEngine, AgentTask } from '../../core/queue';
import { PersistedSession } from '../types';

export class TaskArea {
  widget: blessed.Widgets.ListElement;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  constructor(screen: blessed.Widgets.Screen, headerHeight: number, infoHeight: number, logHeight: number, commandBarHeight: number, sidebarWidth: number) {
    this.widget = blessed.list({
      parent: screen,
      top: headerHeight + infoHeight,
      left: sidebarWidth,
      width: `100%-${sidebarWidth}`,
      height: `100%-${headerHeight + infoHeight + logHeight + commandBarHeight}`,
      label: ' Tasks ',
      border: { type: 'line' },
      style: {
        border: { fg: 'gray' },
        selected: { bg: 'blue', fg: 'white' }
      },
      tags: true,
      keys: false,
      vi: false,
      mouse: true,
      scrollbar: {
        ch: ' ',
        track: { bg: 'gray' },
        style: { inverse: true }
      }
    });
  }

  update(tasks: AgentTask[], selectedTaskIdx: number, hasFocus: boolean) {
    const taskItems: string[] = [];
    let uiTaskIdx = 0;

    if (tasks.length === 0) {
      taskItems.push('{grey-fg}No tasks yet. Press "e" -> "e" to add one.{/}');
    } else {
      const spinnerIdx = Math.floor(Date.now() / 150) % this.spinnerFrames.length;
      let count = 0;

      tasks.forEach((t: AgentTask, i: number) => {
        let color = 'white';
        if (t.status === 'running') color = 'yellow';
        else if (t.status === 'completed') color = 'green';
        else if (t.status === 'failed' || t.status === 'cancelled') color = 'red';

        const prefix = (hasFocus && i === selectedTaskIdx) ? '▶ ' : '  ';
        const timeInfo = t.completedAt ? ` {grey-fg}(Done: ${new Date(t.completedAt).toLocaleTimeString()}){/}` : '';
        
        let statusText = t.status.toUpperCase();
        if (t.status === 'running') {
          statusText = `${this.spinnerFrames[spinnerIdx]} RUNNING`;
        }
        
        taskItems.push(`${prefix}{${color}-fg}[${statusText}] ${t.goal}{/}${timeInfo}`);
        
        if (i === selectedTaskIdx) {
          uiTaskIdx = count;
        }
        count++;

        if (t.result) {
          taskItems.push(`    {white-fg}└─ Ans: ${t.result}{/}`);
          count++;
        }
        if (t.url) {
          const displayUrl = t.url.length > 60 ? t.url.substring(0, 57) + '...' : t.url;
          taskItems.push(`    {blue-fg}└─ URL: ${displayUrl}{/}`);
          count++;
        }
      });
    }

    this.widget.setItems(taskItems);
    if (hasFocus) {
       this.widget.select(uiTaskIdx);
    }
    this.widget.style.border.fg = hasFocus ? 'cyan' : 'gray';
  }
}
