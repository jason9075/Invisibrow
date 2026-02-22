import blessed from 'blessed';
import { QueueEngine, AgentTask } from '../../core/queue';
import { PersistedSession, UIMode } from '../types';

export class CommandBar {
  widget: blessed.Widgets.BoxElement;
  commandInput: blessed.Widgets.TextboxElement;

  constructor(screen: blessed.Widgets.Screen, commandBarHeight: number) {
    this.widget = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: commandBarHeight,
      border: { type: 'line' },
      style: { border: { fg: 'yellow' } },
      tags: true
    });

    this.commandInput = blessed.textbox({
      parent: this.widget,
      top: 0,
      left: 10,
      width: '100%-12',
      height: 1,
      inputOnFocus: false, 
      keys: true, 
      mouse: true,
      style: { fg: 'yellow', bold: true },
      hidden: true,
      name: 'commandInput'
    });
  }

  update(mode: UIMode, focusPane: string, selectedSession: PersistedSession | undefined, tasks: AgentTask[], selectedTaskIdx: number) {
    if (mode === 'normal') {
      this.widget.style.border.fg = 'gray';
      let content = '';
      if (focusPane === 'sidebar') {
        content = ' [Tab] Switch to Tasks | [e] Actions | [n] New Session | [v] Toggle Headless | [j/k] Select | Ctrl+C Exit';
      } else {
        content = ' [Tab] Switch to Sidebar | [y] Copy URL/Res | [r] Copy Result | [o] Open URL | [j/k] Select Task';
        const selectedTask = tasks[selectedTaskIdx];
        if (selectedTask && (selectedTask.url || selectedTask.result)) {
          content += ` | {yellow-fg}Click URL/Ans to Copy{/}`;
        }
      }
      
      if (selectedSession && selectedSession.isVerifying) {
        content = ' {red-bg}{white-fg}[c] Confirm Verification Done{/} |' + content;
      }
      this.widget.setContent(content);
    } 
    else if (mode === 'options') {
      const selectedTask = tasks[selectedTaskIdx];
      const stopAction = (selectedTask && selectedTask.status === 'running') ? ' | [s] Stop' : '';
      
      this.widget.style.border.fg = 'yellow';
      this.widget.setContent(` {yellow-fg}{bold}ACTIONS:{/} [e] Execute | [r] Rename${stopAction} | [l] Login | [d] Delete | [Esc] Cancel`);
    }
    else if (mode === 'execute') {
      this.widget.style.border.fg = 'cyan';
      this.widget.setContent(' {cyan-fg}{bold}ACTIONS:{/} [Ctrl+S] Submit | [Ctrl+C] Clear | [Enter] Newline | [Esc] Cancel');
    }
    else if (mode === 'rename') {
      this.widget.style.border.fg = 'magenta';
      this.widget.setContent(' {magenta-fg}{bold}NAME:{/} ');
    }
  }

  showInput(value: string) {
    this.commandInput.show();
    this.commandInput.focus();
    this.commandInput.setValue(value);
  }

  hideInput() {
    this.commandInput.clearValue();
    this.commandInput.hide();
  }

  onInput(cb: (err: any, value: string | undefined) => void) {
      this.commandInput.readInput(cb);
  }
}
