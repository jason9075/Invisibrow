import blessed from 'blessed';
import type { QueueEngine, SessionConfig, AgentTask } from '../core/queue';
import { eventBus, log } from '../utils/logger';

type UIMode = 'normal' | 'options' | 'execute' | 'rename';

export class BlessedUI {
  private screen: blessed.Widgets.Screen;
  private queueEngine: QueueEngine;
  private sessions: SessionConfig[] = [{ id: 'default', name: 'Default Session', headless: true }];
  private selectedSessionIdx = 0;
  private logs: string[] = [];
  private mode: UIMode = 'normal';

  // Layout Components
  private header: blessed.Widgets.BoxElement;
  private sidebar: blessed.Widgets.ListElement;
  private taskArea: blessed.Widgets.BoxElement;
  private logArea: blessed.Widgets.BoxElement;
  private commandBar: blessed.Widgets.BoxElement;
  private commandInput: blessed.Widgets.TextboxElement;

  constructor(queueEngine: QueueEngine) {
    this.queueEngine = queueEngine;
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'AI Browser Agent TUI',
      fullUnicode: true,
    });

    const headerHeight = 1;
    const commandBarHeight = 3;
    const logHeight = 6;
    const sidebarWidth = 40;

    // 1. Header
    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: headerHeight,
      style: { bg: 'blue', fg: 'white', bold: true }
    });

    // 2. Sidebar
    this.sidebar = blessed.list({
      parent: this.screen,
      top: headerHeight,
      left: 0,
      width: sidebarWidth,
      height: `100%-${headerHeight + logHeight + commandBarHeight}`,
      label: ' SESSIONS ',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'cyan', fg: 'black' }
      },
      keys: false,
      vi: false
    });

    // 3. Task Area
    this.taskArea = blessed.box({
      parent: this.screen,
      top: headerHeight,
      left: sidebarWidth,
      width: `100%-${sidebarWidth}`,
      height: `100%-${headerHeight + logHeight + commandBarHeight}`,
      label: ' TASKS ',
      border: { type: 'line' },
      style: { border: { fg: 'white' } },
      tags: true,
      scrollable: true
    });

    // 4. Log Area
    this.logArea = blessed.box({
      parent: this.screen,
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

    // 5. Command Bar (The Interactive Zone)
    this.commandBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: commandBarHeight,
      border: { type: 'line' },
      style: { border: { fg: 'yellow' } },
      tags: true
    });

    // 6. Command Input (Hidden inside Command Bar by default)
    this.commandInput = blessed.textbox({
      parent: this.commandBar,
      top: 0,
      left: 2,
      width: '100%-4',
      height: 1,
      inputOnFocus: true,
      style: { fg: 'yellow', bold: true },
      hidden: true
    });

    this.setupEvents();
    this.updateUI();
    this.sidebar.focus();
    
    setInterval(() => this.updateUI(), 1000);
  }

  private setupEvents() {
    this.screen.key(['C-c'], () => process.exit(0));

    // Global key handler based on Mode
    this.screen.on('keypress', (_ch, key) => {
      if (this.mode === 'execute' || this.mode === 'rename') return; // Input handled by textbox

      // NORMAL MODE
      if (this.mode === 'normal') {
        if (key.name === 'j' || key.name === 'down') {
          if (this.selectedSessionIdx < this.sessions.length - 1) {
            this.selectedSessionIdx++;
            this.updateUI();
          }
        }
        if (key.name === 'k' || key.name === 'up') {
          if (this.selectedSessionIdx > 0) {
            this.selectedSessionIdx--;
            this.updateUI();
          }
        }
        if (key.name === 'n') this.createNewSession();
        if (key.name === 'e') {
          this.mode = 'options';
          this.updateUI();
        }
        if (key.name === 'v') this.toggleHeadless();
      } 
      // OPTIONS MODE
      else if (this.mode === 'options') {
        if (key.name === 'escape' || key.name === 'q') {
          this.mode = 'normal';
          this.updateUI();
        }
        if (key.name === 'e') this.enterMode('execute');
        if (key.name === 'r') this.enterMode('rename');
        if (key.name === 'l') {
          const s = this.sessions[this.selectedSessionIdx];
          if (s) this.queueEngine.addTask(s.id, 'MANUAL_LOGIN');
          this.mode = 'normal';
          this.updateUI();
        }
        if (key.name === 'd') {
          if (this.sessions.length > 1) {
            this.sessions.splice(this.selectedSessionIdx, 1);
            this.selectedSessionIdx = 0;
          }
          this.mode = 'normal';
          this.updateUI();
        }
      }
    });

    // Textbox events
    this.commandInput.on('submit', (value: string) => {
      const s = this.sessions[this.selectedSessionIdx];
      if (value && value.trim() && s) {
        if (this.mode === 'execute') {
          log(`[TUI] Submitting goal for ${s.name}: ${value}`);
          this.queueEngine.addTask(s.id, value);
        } else if (this.mode === 'rename') {
          const oldName = s.name;
          s.name = value;
          log(`[TUI] Renamed session ${s.id}: ${oldName} -> ${value}`);
        }
      }
      this.mode = 'normal';
      this.commandInput.clearValue();
      this.commandInput.hide();
      this.updateUI();
      this.sidebar.focus();
    });

    this.commandInput.on('cancel', () => {
      log(`[TUI] Input cancelled (Mode: ${this.mode})`);
      this.mode = 'normal';
      this.commandInput.clearValue();
      this.commandInput.hide();
      this.updateUI();
      this.sidebar.focus();
    });

    // Log listener
    eventBus.on('log', (data: { message: string }) => {
      this.logs.push(data.message);
      if (this.logs.length > 50) this.logs.shift();
      this.updateLogArea();
    });
  }

  private enterMode(newMode: 'execute' | 'rename') {
    this.mode = newMode;
    const s = this.sessions[this.selectedSessionIdx];
    if (!s) return;

    this.commandInput.show();
    
    if (newMode === 'execute') {
      this.commandInput.setValue('');
    } else {
      this.commandInput.setValue(s.name);
    }
    
    this.updateUI();
    this.commandInput.focus();
  }

  private createNewSession() {
    const now = new Date().toLocaleTimeString();
    const newId = Math.random().toString(36).substring(7);
    this.sessions.push({ id: newId, name: `Session - ${now}`, headless: false });
    log(`[TUI] Created new session: ${newId}`);
    this.updateUI();
  }

  private toggleHeadless() {
    const s = this.sessions[this.selectedSessionIdx];
    if (s) {
      s.headless = !s.headless;
      log(`[TUI] Session ${s.id} headless: ${s.headless}`);
      this.updateUI();
    }
  }

  private updateUI() {
    const tasksTotal = this.queueEngine.getTasks().length;
    this.header.setContent(` AI BROWSER AGENT TUI | SESSIONS: ${this.sessions.length} | TASKS: ${tasksTotal}`);

    // Update Sidebar
    const items = this.sessions.map((s, i) => {
      const prefix = i === this.selectedSessionIdx ? '▶ ' : '  ';
      const mode = s.headless ? '(H)' : '(G)';
      return `${prefix}${s.name.padEnd(25).substring(0, 25)} ${mode}`;
    });
    this.sidebar.setItems(items);
    this.sidebar.select(this.selectedSessionIdx);

    // Update Tasks
    const currentSession = this.sessions[this.selectedSessionIdx];
    if (currentSession) {
      const tasks = this.queueEngine.getTasks().filter((t: AgentTask) => t.sessionId === currentSession.id);
      let taskContent = `{yellow-fg}{bold}${currentSession.name.toUpperCase()}{/}\n\n`;
      if (tasks.length === 0) {
        taskContent += '{grey-fg}No tasks yet. Press "e" -> "e" to add one.{/}';
      } else {
      tasks.forEach((t: AgentTask) => {
        const color = t.status === 'running' ? 'yellow' : t.status === 'completed' ? 'green' : 'white';
        taskContent += `{${color}-fg}• [${t.status.toUpperCase()}] ${t.goal}{/}\n`;
        if (t.result) {
          taskContent += `  {white-fg}└─ Ans: ${t.result}{/}\n`;
        }
        if (t.url) {
          taskContent += `  {blue-fg}└─ URL: ${t.url}{/}\n`;
        }
      });
      }
      this.taskArea.setContent(taskContent);
    }

    // Update Command Bar based on Mode
    this.updateCommandBar();

    this.screen.render();
  }

  private updateCommandBar() {
    if (this.mode === 'normal') {
      this.commandBar.style.border.fg = 'gray';
      this.commandBar.setContent(' [e] Actions | [n] New Session | [v] Toggle Headless | [j/k] Select | Ctrl+C Exit');
    } 
    else if (this.mode === 'options') {
      this.commandBar.style.border.fg = 'yellow';
      this.commandBar.setContent(' {yellow-fg}{bold}ACTIONS:{/} [e] Execute | [r] Rename | [l] Login | [d] Delete | [Esc] Cancel');
    }
    else if (this.mode === 'execute') {
      this.commandBar.style.border.fg = 'cyan';
      this.commandBar.setContent(' {cyan-fg}{bold}GOAL:{/} ');
    }
    else if (this.mode === 'rename') {
      this.commandBar.style.border.fg = 'magenta';
      this.commandBar.setContent(' {magenta-fg}{bold}NAME:{/} ');
    }
  }

  private updateLogArea() {
    this.logArea.setContent(this.logs.slice(-10).join('\n'));
    this.logArea.setScrollPerc(100);
    this.screen.render();
  }
}
