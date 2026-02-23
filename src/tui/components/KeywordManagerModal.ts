import blessed from 'blessed';
import { MemoryService } from '../../core/memory';

type SubMode = 'view' | 'input' | 'confirm';

export class KeywordManagerModal {
  widget: blessed.Widgets.BoxElement;
  listBox: blessed.Widgets.BoxElement;
  statusBar: blessed.Widgets.BoxElement;
  inputBox: blessed.Widgets.TextboxElement;
  screen: blessed.Widgets.Screen;

  private memory: MemoryService;
  private keywords: string[] = [];
  private selectedIdx: number = 0;
  private subMode: SubMode = 'view';
  private onCloseCallback: (() => void) | null = null;

  constructor(screen: blessed.Widgets.Screen, memory: MemoryService) {
    this.screen = screen;
    this.memory = memory;

    this.widget = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '70%',
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' },
        bg: 'black',
        fg: 'white',
      },
      label: ' {bold}{yellow-fg}Bot Keyword 管理{/} ',
      tags: true,
      hidden: true,
      shadow: true,
    });

    // 關鍵字清單區
    this.listBox = blessed.box({
      parent: this.widget,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-5',
      scrollable: true,
      alwaysScroll: true,
      keys: false,
      mouse: true,
      tags: true,
      style: { bg: 'black', fg: 'white' },
    });

    // 底部狀態列（hint / confirm 提示 / 輸入框佔位標籤）
    this.statusBar = blessed.box({
      parent: this.widget,
      bottom: 2,
      left: 0,
      width: '100%-2',
      height: 1,
      tags: true,
      style: { bg: 'black', fg: 'gray' },
    });

    // 底部 inline 輸入框（新增 keyword 用）
    this.inputBox = blessed.textbox({
      parent: this.widget,
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: 1,
      inputOnFocus: true,
      keys: true,
      mouse: true,
      style: {
        fg: 'white',
        bg: 'blue',
        focus: { bg: 'blue' },
      },
      hidden: true,
    });

    this.setupEvents();
  }

  private setupEvents() {
    // view / confirm 模式：由 widget 捕捉
    this.widget.key(['escape'], () => {
      if (this.subMode === 'view') {
        this.close();
      } else {
        this.cancelSubMode();
      }
    });

    this.widget.key(['j', 'down'], () => {
      if (this.subMode !== 'view') return;
      this.selectedIdx = Math.min(this.keywords.length - 1, this.selectedIdx + 1);
      this.render();
    });

    this.widget.key(['k', 'up'], () => {
      if (this.subMode !== 'view') return;
      this.selectedIdx = Math.max(0, this.selectedIdx - 1);
      this.render();
    });

    this.widget.key(['a'], () => {
      if (this.subMode !== 'view') return;
      this.enterInputMode();
    });

    this.widget.key(['d'], () => {
      if (this.subMode !== 'view') return;
      if (this.keywords.length === 0) return;
      this.enterConfirmMode();
    });

    // confirm 模式：y 確認刪除
    this.widget.key(['y'], () => {
      if (this.subMode !== 'confirm') return;
      this.deleteSelected();
    });

    // confirm 模式：n 或 Esc 取消（Esc 已在上方處理）
    this.widget.key(['n'], () => {
      if (this.subMode !== 'confirm') return;
      this.cancelSubMode();
    });

    // 輸入框：Enter 確認新增，Esc 取消
    this.inputBox.key(['enter'], () => {
      if (this.subMode !== 'input') return;
      this.submitInput();
    });

    this.inputBox.key(['escape', 'C-c'], () => {
      if (this.subMode !== 'input') return;
      this.cancelSubMode();
    });
  }

  // --- 子狀態切換 ---

  private enterInputMode() {
    this.subMode = 'input';
    this.inputBox.clearValue();
    this.inputBox.show();
    this.inputBox.focus();
    this.renderStatusBar();
    this.screen.render();
  }

  private enterConfirmMode() {
    this.subMode = 'confirm';
    this.renderStatusBar();
    this.screen.render();
  }

  private cancelSubMode() {
    this.subMode = 'view';
    this.inputBox.clearValue();
    this.inputBox.hide();
    this.widget.focus();
    this.renderStatusBar();
    this.screen.render();
  }

  // --- 動作 ---

  private async submitInput() {
    const value = this.inputBox.getValue().trim();
    this.inputBox.clearValue();
    this.inputBox.hide();
    this.subMode = 'view';
    this.widget.focus();

    if (value) {
      await this.memory.addBotKeyword(value);
      await this.reload();
      // 選中剛新增的項目
      const newIdx = this.keywords.findIndex((k) => k === value.trim().toLowerCase());
      if (newIdx !== -1) this.selectedIdx = newIdx;
    }

    this.render();
  }

  private async deleteSelected() {
    const keyword = this.keywords[this.selectedIdx];
    if (!keyword) return;

    await this.memory.deleteBotKeyword(keyword);
    await this.reload();

    // 調整 selectedIdx 防止越界
    this.selectedIdx = Math.min(this.selectedIdx, Math.max(0, this.keywords.length - 1));
    this.subMode = 'view';
    this.render();
  }

  // --- 資料 & 渲染 ---

  private async reload() {
    this.keywords = await this.memory.getAllBotKeywords();
  }

  private render() {
    this.renderList();
    this.renderStatusBar();
    this.screen.render();
  }

  private renderList() {
    if (this.keywords.length === 0) {
      this.listBox.setContent('{gray-fg}（尚無 keyword）{/}');
      return;
    }

    const lines = this.keywords.map((kw, i) => {
      const isSelected = i === this.selectedIdx;
      if (isSelected) {
        return `{black-fg}{white-bg} ▶ ${kw.padEnd(40)}{/}`;
      }
      return `   ${kw}`;
    });

    lines.push('');
    lines.push(`{gray-fg}共 ${this.keywords.length} 個 keyword{/}`);
    this.listBox.setContent(lines.join('\n'));
  }

  private renderStatusBar() {
    if (this.subMode === 'view') {
      this.statusBar.setContent(
        ' {gray-fg}[a] 新增  [d] 刪除  [j/k] 移動  [Esc] 關閉{/}'
      );
    } else if (this.subMode === 'confirm') {
      const kw = this.keywords[this.selectedIdx] ?? '';
      this.statusBar.setContent(
        ` {red-fg}{bold}確定刪除 "${kw}"？{/} {white-fg}[y] 確認  [n/Esc] 取消{/}`
      );
    } else if (this.subMode === 'input') {
      this.statusBar.setContent(
        ' {cyan-fg}輸入新 keyword：{/}  {gray-fg}[Enter] 確認  [Esc] 取消{/}'
      );
    }
  }

  // --- 公開 API ---

  /**
   * 開啟 Keyword 管理 Modal
   */
  async show(onClose?: () => void) {
    this.onCloseCallback = onClose ?? null;
    this.subMode = 'view';
    this.selectedIdx = 0;
    this.inputBox.hide();
    await this.reload();
    this.render();
    this.widget.show();
    this.widget.setFront();
    this.widget.focus();
    this.screen.render();
  }

  private close() {
    this.widget.hide();
    this.inputBox.hide();
    this.subMode = 'view';
    this.screen.render();
    if (this.onCloseCallback) {
      this.onCloseCallback();
      this.onCloseCallback = null;
    }
  }
}
