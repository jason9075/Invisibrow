import blessed from 'blessed';

export class TaskDetailModal {
  widget: blessed.Widgets.BoxElement;
  contentBox: blessed.Widgets.BoxElement;
  screen: blessed.Widgets.Screen;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
    
    this.widget = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        bg: 'black',
        fg: 'white'
      },
      label: ' {bold}Task Details{/} (Esc/Enter: Close) ',
      tags: true,
      hidden: true,
      shadow: true
    });

    this.contentBox = blessed.box({
      parent: this.widget,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: ' ',
        track: { bg: 'gray' },
        style: { inverse: true }
      },
      tags: true
    });

    this.setupEvents();
  }

  private setupEvents() {
    this.contentBox.key(['escape', 'enter', 'q'], () => {
      this.close();
    });
  }

  private onClose?: () => void;

  show(title: string, content: string, onClose?: () => void) {
    this.onClose = onClose;
    this.widget.setLabel(` {bold}${title}{/} (Esc/Enter: Close) `);
    this.contentBox.setContent(content);
    this.widget.show();
    this.widget.setFront();
    this.contentBox.focus();
    this.screen.render();
  }

  close() {
    this.widget.hide();
    this.screen.render();
    if (this.onClose) {
      this.onClose();
      this.onClose = undefined;
    }
  }
}
