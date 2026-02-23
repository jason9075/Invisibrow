import blessed from 'blessed';

export interface PaletteCommand {
  label: string;
  description: string;
  action: string;
}

const COMMANDS: PaletteCommand[] = [
  {
    label: 'Keyword 管理',
    description: '管理 bot 偵測關鍵字（新增/刪除）',
    action: 'keyword_manager',
  },
];

export class CommandPaletteModal {
  widget: blessed.Widgets.BoxElement;
  listBox: blessed.Widgets.BoxElement;
  hintBox: blessed.Widgets.BoxElement;
  screen: blessed.Widgets.Screen;

  private selectedIdx: number = 0;
  private resolveCallback: ((action: string | null) => void) | null = null;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;

    this.widget = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: Math.min(COMMANDS.length + 6, 20),
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        bg: 'black',
        fg: 'white',
      },
      label: ' {bold}{cyan-fg}Command Palette{/} ',
      tags: true,
      hidden: true,
      shadow: true,
    });

    this.listBox = blessed.box({
      parent: this.widget,
      top: 0,
      left: 0,
      width: '100%-2',
      height: `100%-4`,
      tags: true,
      style: { bg: 'black', fg: 'white' },
    });

    this.hintBox = blessed.box({
      parent: this.widget,
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: 1,
      tags: true,
      style: { bg: 'black', fg: 'gray' },
      content: ' {gray-fg}[j/k] 選擇  [Enter] 確認  [Esc] 關閉{/}',
    });

    this.setupEvents();
  }

  private setupEvents() {
    this.widget.key(['escape', 'q'], () => {
      this.close(null);
    });

    this.widget.key(['j', 'down'], () => {
      this.selectedIdx = Math.min(COMMANDS.length - 1, this.selectedIdx + 1);
      this.render();
    });

    this.widget.key(['k', 'up'], () => {
      this.selectedIdx = Math.max(0, this.selectedIdx - 1);
      this.render();
    });

    this.widget.key(['enter'], () => {
      const cmd = COMMANDS[this.selectedIdx];
      if (cmd) this.close(cmd.action);
    });
  }

  private render() {
    const lines = COMMANDS.map((cmd, i) => {
      const isSelected = i === this.selectedIdx;
      const prefix = isSelected ? '{cyan-fg}{bold}▶ ' : '  ';
      const suffix = isSelected ? '{/}' : '';
      return `${prefix}${cmd.label}  {gray-fg}${cmd.description}{/}${suffix}`;
    });
    this.listBox.setContent(lines.join('\n'));
    this.screen.render();
  }

  /**
   * 開啟 Command Palette，回傳使用者選擇的 action，取消回傳 null
   */
  show(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolveCallback = resolve;
      this.selectedIdx = 0;
      this.render();
      this.widget.show();
      this.widget.setFront();
      this.widget.focus();
      this.screen.render();
    });
  }

  private close(action: string | null) {
    this.widget.hide();
    this.screen.render();
    if (this.resolveCallback) {
      this.resolveCallback(action);
      this.resolveCallback = null;
    }
  }
}
