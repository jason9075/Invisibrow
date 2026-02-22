import blessed from 'blessed';

export class LogArea {
  widget: blessed.Widgets.BoxElement;

  constructor(screen: blessed.Widgets.Screen, logHeight: number, commandBarHeight: number) {
    this.widget = blessed.box({
      parent: screen,
      bottom: commandBarHeight,
      left: 0,
      width: '100%',
      height: logHeight,
      label: ' LOGS ',
      border: { type: 'line' },
      style: { border: { fg: 'gray' } },
      tags: true,
      scrollable: true
    });
  }

  update(logs: string[]) {
    this.widget.setContent(logs.slice(-10).join('\n'));
    this.widget.setScrollPerc(100);
  }
}
