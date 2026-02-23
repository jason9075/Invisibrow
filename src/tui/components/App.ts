import blessed from 'blessed';
import { QueueEngine } from '../../core/queue';
import { AppState } from '../store/appState';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { TaskInfoArea } from './TaskInfoArea';
import { TaskArea } from './TaskArea';
import { LogArea } from './LogArea';
import { CommandBar } from './CommandBar';
import { TaskInputModal } from './TaskInputModal';
import { TaskDetailModal } from './TaskDetailModal';
import { CommandPaletteModal } from './CommandPaletteModal';
import { KeywordManagerModal } from './KeywordManagerModal';
import { copyToClipboard, openUrl } from '../../utils/clipboard';
import { eventBus, log } from '../../utils/logger';
import { memoryService } from '../../core/memory';
import { formatCost } from '../../utils/pricing';

export class App {
  screen: blessed.Widgets.Screen;
  state: AppState;
  
  header: Header;
  sidebar: Sidebar;
  taskInfoArea: TaskInfoArea;
  taskArea: TaskArea;
  logArea: LogArea;
  commandBar: CommandBar;
  taskInputModal: TaskInputModal;
  taskDetailModal: TaskDetailModal;
  commandPaletteModal: CommandPaletteModal;
  keywordManagerModal: KeywordManagerModal;
  
  constructor(queueEngine: QueueEngine) {
    this.state = new AppState(queueEngine);
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Invisibrow TUI',
      fullUnicode: true,
      mouse: true,
    });

    const headerHeight = 1;
    const commandBarHeight = 3;
    const logHeight = 9;
    const sidebarWidth = 40;
    const infoHeight = 4;

    this.header = new Header(this.screen);
    this.sidebar = new Sidebar(this.screen, headerHeight, logHeight, commandBarHeight, sidebarWidth);
    this.taskInfoArea = new TaskInfoArea(this.screen, headerHeight, infoHeight, sidebarWidth);
    this.taskArea = new TaskArea(this.screen, headerHeight, infoHeight, logHeight, commandBarHeight, sidebarWidth);
    this.logArea = new LogArea(this.screen, logHeight, commandBarHeight);
    this.commandBar = new CommandBar(this.screen, commandBarHeight);
    this.taskInputModal = new TaskInputModal(this.screen);
    this.taskDetailModal = new TaskDetailModal(this.screen);
    this.commandPaletteModal = new CommandPaletteModal(this.screen);
    this.keywordManagerModal = new KeywordManagerModal(this.screen, memoryService);
    
    this.setupEvents();
    this.updateUI();
    this.sidebar.widget.focus();
    setInterval(() => this.updateUI(), 150);
  }

  setupEvents() {
    this.screen.key(['C-c'], () => process.exit(0));

    // 即時更新 Header token stats（不需要等 150ms interval）
    eventBus.on('session:stats-updated', (sessionId: string) => {
      const current = this.state.getCurrentSession();
      if (current?.id === sessionId) {
        this.updateUI();
      }
    });

    // Ctrl+P — 全域開啟 Command Palette（任何 mode 皆可觸發，除了文字輸入 mode）
    this.screen.key(['C-p'], () => {
      if (this.state.mode === 'execute' || this.state.mode === 'rename') return;
      this.openCommandPalette();
    });
    
    // Global key handler
    this.screen.on('keypress', (_ch, key) => {
        if (
          this.state.mode === 'execute' ||
          this.state.mode === 'rename' ||
          this.state.mode === 'command_palette' ||
          this.state.mode === 'keyword_manager'
        ) return;

        if (this.state.mode === 'normal') {
            this.handleNormalMode(key);
        } else if (this.state.mode === 'options') {
            this.handleOptionsMode(key);
        }
    });

    this.sidebar.widget.on('select', () => {
        this.state.focusPane = 'sidebar';
        this.state.syncSessionConfig();
        this.updateUI();
    });

    this.taskArea.widget.on('select', (item: any, index: number) => {
        this.handleTaskSelection(index);
    });
    
    // Command Input Events
    this.commandBar.commandInput.key(['C-c', 'escape'], () => this.handleInputCancel());
    this.commandBar.commandInput.key(['up'], () => this.handleHistoryNavigation('up'));
    this.commandBar.commandInput.key(['down'], () => this.handleHistoryNavigation('down'));

    // Log listener
    eventBus.on('log', (data: { message: string }) => {
        this.state.addLog(data.message);
        this.logArea.update(this.state.logs);
        this.screen.render();
    });

    eventBus.on('verification_needed', (data: { sessionId: string; reason?: string; url?: string }) => {
        const session = this.state.sessions.find((s) => s.id === data.sessionId);
        if (!session) return;
        session.isVerifying = true;
        log(`[TUI] ${session.name} 需要人工介入: ${data.reason || data.url || '驗證碼/登入'}`);
        this.updateUI();
    });
  }

  handleNormalMode(key: any) {
    if (key.name === 'tab' || key.name === 'l' || key.name === 'h') {
        if (key.name === 'l') this.state.focusPane = 'tasks';
        else if (key.name === 'h') this.state.focusPane = 'sidebar';
        else this.state.focusPane = this.state.focusPane === 'sidebar' ? 'tasks' : 'sidebar';
        this.updateUI();
        return;
    }

    if (this.state.focusPane === 'sidebar') {
        this.handleSidebarNavigation(key);
    } else {
        this.handleTaskNavigation(key);
    }

    if (key.name === 'n') this.state.createNewSession();
    if (key.name === 'e') {
        this.state.mode = 'options';
        this.updateUI();
    }
    if (key.name === 'v') this.state.toggleHeadless();
    if (key.name === 'c') {
        const s = this.state.getCurrentSession();
        if (s && s.isVerifying) {
            s.isVerifying = false;
            eventBus.emit('verification_resolved', { sessionId: s.id });
            log(`[TUI] 使用者已確認驗證完成 (${s.id})`);
            this.updateUI();
        }
    }
  }

  handleSidebarNavigation(key: any) {
      if (key.name === 'j' || key.name === 'down') {
          if (this.state.selectedSessionIdx < this.state.sessions.length - 1) {
              this.state.selectedSessionIdx++;
              this.state.selectedTaskIdx = 0;
              this.updateUI();
          }
      }
      if (key.name === 'k' || key.name === 'up') {
          if (this.state.selectedSessionIdx > 0) {
              this.state.selectedSessionIdx--;
              this.state.selectedTaskIdx = 0;
              this.updateUI();
          }
      }
  }

  handleTaskNavigation(key: any) {
      const tasks = this.state.getTasksForCurrentSession();
      if (key.name === 'j' || key.name === 'down') {
          const step = key.shift ? 5 : 1;
          this.state.selectedTaskIdx = Math.min(tasks.length - 1, this.state.selectedTaskIdx + step);
          this.updateUI();
      }
      if (key.name === 'k' || key.name === 'up') {
          const step = key.shift ? 5 : 1;
          this.state.selectedTaskIdx = Math.max(0, this.state.selectedTaskIdx - step);
          this.updateUI();
      }
      if (key.name === 'y') {
          const task = tasks[this.state.selectedTaskIdx];
          if (task) {
              if (task.url) {
                  copyToClipboard(task.url);
                  log(`[TUI] Copied URL to clipboard`);
              } else if (task.result) {
                  copyToClipboard(task.result);
                  log(`[TUI] Copied Result to clipboard`);
              }
          }
      }
      if (key.name === 'r') {
          const task = tasks[this.state.selectedTaskIdx];
          if (task && task.result) {
              copyToClipboard(task.result);
              log(`[TUI] Copied Result to clipboard`);
          }
      }
      if (key.name === 'o') {
          const task = tasks[this.state.selectedTaskIdx];
          if (task && task.url) {
              openUrl(task.url);
          }
      }
      if (key.name === 'enter') {
          const task = tasks[this.state.selectedTaskIdx];
          if (task) {
              let content = `{yellow-fg}{bold}Goal:{/}\n${task.goal}\n\n`;

              if (task.steps && task.steps.length > 0) {
                  content += `{yellow-fg}{bold}Steps:{/}\n`;
                  for (const s of task.steps) {
                      const agentLabel = s.agent === 'planer' ? '[P]' : '[B]';
                      let tokenStr = '';
                      if (s.tokenUsage) {
                        const { inputTokens, cachedTokens, outputTokens, cost } = s.tokenUsage;
                        tokenStr = ` {green-fg}(I:${inputTokens.toLocaleString()} C:${cachedTokens.toLocaleString()} O:${outputTokens.toLocaleString()} ${formatCost(cost)}){/}`;
                      }
                      content += `  ${agentLabel} ${s.step}. {bold}${s.command}{/} — ${s.thought}${tokenStr}\n`;
                  }
                  content += '\n';
              }

              if (task.result) content += `{yellow-fg}{bold}Result:{/}\n${task.result}\n\n`;
              if (task.url) content += `{yellow-fg}{bold}URL:{/}\n{blue-fg}${task.url}{/}\n\n`;
              if (task.error) content += `{yellow-fg}{bold}Error:{/}\n{red-fg}${task.error}{/}\n\n`;

              if (task.tokenUsage) {
                const { inputTokens, cachedTokens, outputTokens } = task.tokenUsage;
                content += `{yellow-fg}{bold}Token Usage:{/}\n`;
                content += `  Input:   ${inputTokens.toLocaleString()}\n`;
                content += `  Cached:  {green-fg}${cachedTokens.toLocaleString()}{/}\n`;
                content += `  Output:  ${outputTokens.toLocaleString()}\n`;
                content += `  Total:   {bold}${(inputTokens + outputTokens).toLocaleString()}{/}\n\n`;
              }
              
              this.taskDetailModal.show(`Task Details (${task.status})`, content, () => {
                  this.taskArea.widget.focus();
                  this.screen.render();
              });
          }
      }
  }

  handleOptionsMode(key: any) {
      if (key.name === 'escape' || key.name === 'q') {
          this.state.mode = 'normal';
          this.updateUI();
      }
      if (key.name === 'e') this.enterMode('execute');
      if (key.name === 'r') this.enterMode('rename');
      if (key.name === 's') {
          const tasks = this.state.getTasksForCurrentSession();
          const task = tasks[this.state.selectedTaskIdx];
          if (task && task.status === 'running') {
              this.state.queueEngine.stopTask(task.id);
              log(`[TUI] 使用者停止任務: ${task.id}`);
              this.state.mode = 'normal';
              this.updateUI();
          }
      }
      if (key.name === 'l') {
          const s = this.state.getCurrentSession();
          if (s) this.state.submitTask(s.id, 'MANUAL_LOGIN');
          this.state.mode = 'normal';
          this.updateUI();
      }
      if (key.name === 'd') {
          this.state.deleteCurrentSession();
          this.state.mode = 'normal';
          this.updateUI();
      }
  }

  handleTaskSelection(index: number) {
      this.state.focusPane = 'tasks';
      const tasks = this.state.getTasksForCurrentSession();
      let count = 0;
      for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i];
          const taskStart = count;
          count++;
          const resultLine = t.result ? count : -1;
          if (t.result) count++;
          const urlLine = t.url ? count : -1;
          if (t.url) count++;

          if (index >= taskStart && index < count) {
              this.state.selectedTaskIdx = i;
              if (index === urlLine && t.url) {
                  copyToClipboard(t.url);
              } else if (index === resultLine && t.result) {
                  copyToClipboard(t.result);
              }
              break;
          }
      }
      this.updateUI();
  }

  handleHistoryNavigation(direction: 'up' | 'down') {
      if ((this.state.mode === 'execute' || this.state.mode === 'rename')) {
          if (direction === 'up' && this.state.inputHistory.length > 0) {
              if (this.state.historyIdx < this.state.inputHistory.length - 1) {
                  this.state.historyIdx++;
                  this.commandBar.commandInput.setValue(this.state.inputHistory[this.state.historyIdx]);
                  this.screen.render();
              }
          } else if (direction === 'down') {
              if (this.state.historyIdx > 0) {
                  this.state.historyIdx--;
                  this.commandBar.commandInput.setValue(this.state.inputHistory[this.state.historyIdx]);
              } else if (this.state.historyIdx === 0) {
                  this.state.historyIdx = -1;
                  this.commandBar.commandInput.setValue('');
              }
              this.screen.render();
          }
      }
  }

  async enterMode(newMode: 'execute' | 'rename') {
      this.state.mode = newMode;
      const s = this.state.getCurrentSession();
      if (!s) return;
      
      this.updateCommandBar();
      this.screen.render();

      if (newMode === 'execute') {
        const result = await this.taskInputModal.show();
        if (result) {
            this.handleInputSubmit(result);
        } else {
            this.handleInputCancel();
        }
      } else {
        const initialValue = s.name;
        this.commandBar.showInput(initialValue);
        this.screen.render();

        this.commandBar.onInput((err, value) => {
            if (value !== undefined) {
                this.handleInputSubmit(value);
            } else {
                this.handleInputCancel();
            }
        });
      }
  }

  handleInputSubmit(value: string) {
      const s = this.state.getCurrentSession();
      if (value && value.trim() && s) {
          if (this.state.mode === 'execute') {
              this.state.addToHistory(value);
              log(`[TUI] Submitting goal for ${s.name}: ${value}`);
              s.updatedAt = new Date().toISOString();
              
              const targetId = s.id;
              this.state.saveSessions();
              this.updateUI();
              
              const newIdx = this.state.sessions.findIndex(sess => sess.id === targetId);
              if (newIdx !== -1) {
                  this.state.selectedSessionIdx = newIdx;
                  this.state.selectedTaskIdx = 0;
                  this.updateUI();
              }
              
              this.state.submitTask(s.id, value);
          } else if (this.state.mode === 'rename') {
              const oldName = s.name;
              s.name = value;
              this.state.saveSessions();
              log(`[TUI] Renamed session ${s.id}: ${oldName} -> ${value}`);
          }
      }
      this.resetInputState();
  }

  handleInputCancel() {
      log(`[TUI] Input cancelled (Mode: ${this.state.mode})`);
      this.resetInputState();
  }

  resetInputState() {
      this.state.mode = 'normal';
      this.state.historyIdx = -1;
      this.commandBar.hideInput();
      this.updateUI();
      this.sidebar.widget.focus();
      this.screen.render();
  }

  updateUI() {
      const allTasks = this.state.queueEngine.getTasks();
      const tasksTotal = allTasks.length;
      const running = allTasks.filter(t => t.status === 'running').length;
      const processed = allTasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status)).length;
      
      this.header.update(
        this.state.sessions.length,
        running,
        processed,
        tasksTotal,
        this.state.getCurrentSession()?.stats,
      );
      this.sidebar.update(this.state.sessions, this.state.selectedSessionIdx, this.state.focusPane === 'sidebar');
      this.taskInfoArea.update(this.state.getCurrentSession(), this.state.getTasksForCurrentSession());
      this.taskArea.update(this.state.getTasksForCurrentSession(), this.state.selectedTaskIdx, this.state.focusPane === 'tasks');
      this.logArea.update(this.state.logs);
      this.updateCommandBar();
      this.screen.render();
  }

  updateCommandBar() {
      this.commandBar.update(
          this.state.mode, 
          this.state.focusPane, 
          this.state.getCurrentSession(), 
          this.state.getTasksForCurrentSession(),
          this.state.selectedTaskIdx
      );
  }

  /**
   * 開啟 Command Palette，等待使用者選擇後路由到對應功能
   */
  async openCommandPalette() {
    this.state.mode = 'command_palette';
    this.updateUI();

    const action = await this.commandPaletteModal.show();

    if (action === 'keyword_manager') {
      await this.openKeywordManager();
    } else {
      // 使用者取消
      this.state.mode = 'normal';
      this.updateUI();
      this.sidebar.widget.focus();
    }
  }

  /**
   * 開啟 Keyword 管理 Modal
   */
  async openKeywordManager() {
    this.state.mode = 'keyword_manager';
    this.updateUI();

    await this.keywordManagerModal.show(() => {
      this.state.mode = 'normal';
      this.updateUI();
      this.sidebar.widget.focus();
    });
  }
}
