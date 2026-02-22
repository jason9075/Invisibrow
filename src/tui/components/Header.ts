import blessed from 'blessed';

export class Header {
  widget: blessed.Widgets.BoxElement;

  constructor(screen: blessed.Widgets.Screen) {
    this.widget = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: { bg: 'blue', fg: 'white', bold: true }
    });
  }

  update(sessionCount: number, taskCount: number) {
    this.widget.setContent(` INVISIBROW TUI | SESSIONS: ${sessionCount} | TASKS: ${taskCount}`);
  }
}
