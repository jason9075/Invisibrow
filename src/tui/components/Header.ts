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

  update(sessionCount: number, running: number, processed: number, total: number) {
    this.widget.setContent(` InvisiBrow TUI | Sessions: ${sessionCount} | ${running}/${processed}/${total} Tasks`);
  }
}
