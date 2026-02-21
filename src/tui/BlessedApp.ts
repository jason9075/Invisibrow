import fs from 'fs';
import path from 'path';
import blessed from 'blessed';
import type { QueueEngine, SessionConfig, AgentTask } from '../core/queue';
import { eventBus, log } from '../utils/logger';
import { copyToClipboard, openUrl } from '../utils/clipboard';

type UIMode = 'normal' | 'options' | 'execute' | 'rename' | 'verify';

interface PersistedSession extends SessionConfig {
  createdAt: string;
  updatedAt: string;
  isVerifying?: boolean;
  stats?: {
    tokens: number;
    cost: number;
    contextSize: number;
  };
}

export class BlessedUI {
  private screen: blessed.Widgets.Screen;
  private queueEngine: QueueEngine;
  private sessions: PersistedSession[] = [];
  private selectedSessionIdx = 0;
  private selectedTaskIdx = 0;
  private focusPane: 'sidebar' | 'tasks' = 'sidebar';
  private logs: string[] = [];
  private mode: UIMode = 'normal';
  private storagePath: string;
  private sessionsFilePath: string;
  private inputHistory: string[] = [];
  private historyIdx = -1;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  // Layout Components
  private header: blessed.Widgets.BoxElement;
  private sidebar: blessed.Widgets.ListElement;
  private taskInfoArea: blessed.Widgets.BoxElement;
  private taskArea: blessed.Widgets.ListElement;
  private logArea: blessed.Widgets.BoxElement;
  private commandBar: blessed.Widgets.BoxElement;
  private commandInput: blessed.Widgets.TextboxElement;
  private questionBox: blessed.Widgets.QuestionElement;

  constructor(queueEngine: QueueEngine) {
    this.queueEngine = queueEngine;
    
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.storagePath = path.join(homeDir, '.local', 'share', 'invisibrow', 'storage');
    this.sessionsFilePath = path.join(this.storagePath, 'sessions.json');
    
    this.loadSessions();

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
      tags: true,
      keys: false,
      vi: false
    });

    // 3a. Task Info Area (Fixed at top of task area)
    this.taskInfoArea = blessed.box({
      parent: this.screen,
      top: headerHeight,
      left: sidebarWidth,
      width: `100%-${sidebarWidth}`,
      height: infoHeight,
      label: ' SESSION INFO ',
      border: { type: 'line' },
      style: { border: { fg: 'gray' } },
      tags: true
    });

    // 3b. Task Area
    this.taskArea = blessed.list({
      parent: this.screen,
      top: headerHeight + infoHeight,
      left: sidebarWidth,
      width: `100%-${sidebarWidth}`,
      height: `100%-${headerHeight + infoHeight + logHeight + commandBarHeight}`,
      label: ' TASKS ',
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

    this.questionBox = blessed.question({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      border: { type: 'line' },
      style: {
        border: { fg: 'red' },
        bg: 'black',
        fg: 'white'
      },
      hidden: true,
      tags: true,
      label: ' {red-fg}Bot Detection{/} '
    });

    this.sidebar.on('select', () => {
      this.focusPane = 'sidebar';
      this.syncSessionConfig();
      this.updateUI();
    });


    this.taskArea.on('select', (item: any, index: number) => {
      this.focusPane = 'tasks';
      const currentSession = this.sessions[this.selectedSessionIdx];
      if (!currentSession) return;
      
      const tasks = this.queueEngine.getTasks().filter(t => t.sessionId === currentSession.id);
      
      // Figure out which task was clicked based on line index
      let count = 0;
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i] as AgentTask;
        const taskStart = count;
        count++; // Goal
        const resultLine = t.result ? count : -1;
        if (t.result) count++; // Result line
        const urlLine = t.url ? count : -1;
        if (t.url) count++; // URL line
        
        if (index >= taskStart && index < count) {
          this.selectedTaskIdx = i;
          if (index === urlLine && t.url) {
            copyToClipboard(t.url);
          } else if (index === resultLine && t.result) {
            copyToClipboard(t.result);
          }
          break;
        }
      }
      this.updateUI();
    });

    this.setupEvents();
    this.updateUI();
    this.sidebar.focus();
    
    setInterval(() => this.updateUI(), 150);
  }

  private setupEvents() {
    this.screen.key(['C-c'], () => process.exit(0));

    // Global key handler based on Mode
    this.screen.on('keypress', (_ch, key) => {
      if (this.mode === 'execute' || this.mode === 'rename') return; // Input handled by textbox

      const s = this.sessions[this.selectedSessionIdx] as PersistedSession | undefined;

      // NORMAL MODE
      if (this.mode === 'normal') {
        if (key.name === 'tab' || key.name === 'l' || key.name === 'h') {
          if (key.name === 'l') this.focusPane = 'tasks';
          else if (key.name === 'h') this.focusPane = 'sidebar';
          else this.focusPane = this.focusPane === 'sidebar' ? 'tasks' : 'sidebar';
          this.updateUI();
          return;
        }

        if (this.focusPane === 'sidebar') {
          if (key.name === 'j' || key.name === 'down') {
            if (this.selectedSessionIdx < this.sessions.length - 1) {
              this.selectedSessionIdx++;
              this.selectedTaskIdx = 0; // Reset task selection
              this.updateUI();
            }
          }
          if (key.name === 'k' || key.name === 'up') {
            if (this.selectedSessionIdx > 0) {
              this.selectedSessionIdx--;
              this.selectedTaskIdx = 0; // Reset task selection
              this.updateUI();
            }
          }
        } else {
          // Tasks Pane navigation
          const currentSession = this.sessions[this.selectedSessionIdx];
          const tasks = this.queueEngine.getTasks().filter(t => t.sessionId === currentSession?.id);
          
          if (key.name === 'j' || key.name === 'down') {
            const step = key.shift ? 5 : 1;
            this.selectedTaskIdx = Math.min(tasks.length - 1, this.selectedTaskIdx + step);
            this.updateUI();
          }
          if (key.name === 'k' || key.name === 'up') {
            const step = key.shift ? 5 : 1;
            this.selectedTaskIdx = Math.max(0, this.selectedTaskIdx - step);
            this.updateUI();
          }
          if (key.name === 'y') {
            const task = tasks[this.selectedTaskIdx];
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
            const task = tasks[this.selectedTaskIdx];
            if (task && task.result) {
              copyToClipboard(task.result);
              log(`[TUI] Copied Result to clipboard`);
            }
          }
          if (key.name === 'o') {
            const task = tasks[this.selectedTaskIdx];
            if (task && task.url) {
              openUrl(task.url);
            }
          }
        }

        if (key.name === 'n') this.createNewSession();
        if (key.name === 'e') {
          this.mode = 'options';
          this.updateUI();
        }
        if (key.name === 'v') this.toggleHeadless();
        if (key.name === 'c') {
          if (s && s.isVerifying) {
            s.isVerifying = false;
            eventBus.emit('verification_resolved', { sessionId: s.id });
            log(`[TUI] 使用者已確認驗證完成 (${s.id})`);
            this.updateUI();
          }
        }
      } 
      // OPTIONS MODE
      else if (this.mode === 'options') {
        if (key.name === 'escape' || key.name === 'q') {
          this.mode = 'normal';
          this.updateUI();
        }
        if (key.name === 'e') this.enterMode('execute');
        if (key.name === 'r') this.enterMode('rename');
        if (key.name === 's') {
          const currentSession = this.sessions[this.selectedSessionIdx];
          const tasks = this.queueEngine.getTasks().filter(t => t.sessionId === currentSession?.id);
          const task = tasks[this.selectedTaskIdx];
          if (task && task.status === 'running') {
            this.queueEngine.stopTask(task.id);
            log(`[TUI] 使用者停止任務: ${task.id}`);
            this.mode = 'normal';
            this.updateUI();
          }
        }
        if (key.name === 'l') {
          if (s) this.queueEngine.addTask(s.id, 'MANUAL_LOGIN');
          this.mode = 'normal';
          this.updateUI();
        }
        if (key.name === 'd') {
          if (this.sessions.length > 1) {
            this.sessions.splice(this.selectedSessionIdx, 1);
            this.selectedSessionIdx = 0;
            this.saveSessions();
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
          // Add to history if unique
          if (this.inputHistory[0] !== value) {
            this.inputHistory.unshift(value);
          }
          this.historyIdx = -1;

          log(`[TUI] Submitting goal for ${s.name}: ${value}`);
          s.updatedAt = new Date().toISOString();
          
          // Store the session ID to re-locate it after sorting
          const targetId = s.id;
          
          this.saveSessions();
          
          // Trigger UI update (which includes sorting)
          this.updateUI();
          
          // Re-locate the selected index based on the ID after sorting
          const newIdx = this.sessions.findIndex(sess => sess.id === targetId);
          if (newIdx !== -1) {
            this.selectedSessionIdx = newIdx;
            this.selectedTaskIdx = 0;
            this.updateUI(); // Render again with new selection
          }
          
          this.queueEngine.addTask(s.id, value);
        } else if (this.mode === 'rename') {
          const oldName = s.name;
          s.name = value;
          // Renaming is metadata update, not necessarily "execution"
          this.saveSessions();
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
      this.historyIdx = -1;
      this.commandInput.clearValue();
      this.commandInput.hide();
      this.updateUI();
      this.sidebar.focus();
    });

    this.commandInput.key(['up'], () => {
      if (this.mode === 'execute' && this.inputHistory.length > 0) {
        if (this.historyIdx < this.inputHistory.length - 1) {
          this.historyIdx++;
          this.commandInput.setValue(this.inputHistory[this.historyIdx]);
          this.screen.render();
        }
      }
    });

    this.commandInput.key(['down'], () => {
      if (this.mode === 'execute') {
        if (this.historyIdx > 0) {
          this.historyIdx--;
          this.commandInput.setValue(this.inputHistory[this.historyIdx]);
        } else if (this.historyIdx === 0) {
          this.historyIdx = -1;
          this.commandInput.setValue('');
        }
        this.screen.render();
      }
    });

    // Log listener
    eventBus.on('log', (data: { message: string }) => {
      this.logs.push(data.message);
      if (this.logs.length > 50) this.logs.shift();
      this.updateLogArea();
    });

    eventBus.on('verification_needed', (data: { sessionId: string }) => {
      const s = this.sessions.find(s => s.id === data.sessionId);
      if (s) {
        this.questionBox.ask(`偵測到機器人攔截 (${s.name})\n是否開啟瀏覽器視窗手動排除？`, (err, value) => {
          if (value) {
            s.isVerifying = true;
            eventBus.emit('verification_accepted', { sessionId: s.id });
          } else {
            eventBus.emit('verification_denied', { sessionId: s.id });
          }
          this.updateUI();
        });
      }
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
    const nowStr = new Date().toLocaleTimeString();
    const newId = Math.random().toString(36).substring(7);
    const nowIso = new Date().toISOString();
    const newSession: PersistedSession = { 
      id: newId, 
      name: `Session - ${nowStr}`, 
      headless: false,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    this.sessions.push(newSession);
    this.saveSessions();
    log(`[TUI] Created new session: ${newSession.name} (${newId})`);
    this.updateUI();
  }

  private toggleHeadless() {
    const s = this.sessions[this.selectedSessionIdx];
    if (s) {
      s.headless = !s.headless;
      s.updatedAt = new Date().toISOString();
      this.saveSessions();
      log(`[TUI] Session ${s.id} headless: ${s.headless}`);
      this.updateUI();
    }
  }

  private loadSessions() {
    try {
      if (fs.existsSync(this.sessionsFilePath)) {
        const data = fs.readFileSync(this.sessionsFilePath, 'utf8');
        this.sessions = JSON.parse(data);
      } else {
        const now = new Date().toISOString();
        this.sessions = [{ 
          id: 'default', 
          name: 'Default Session', 
          headless: true,
          createdAt: now,
          updatedAt: now
        }];
        this.saveSessions();
      }
    } catch (e) {
      log(`[TUI] Failed to load sessions: ${e}`, 'error');
      const now = new Date().toISOString();
      this.sessions = [{ 
        id: 'default', 
        name: 'Default Session', 
        headless: true,
        createdAt: now,
        updatedAt: now
      }];
    }
  }

  private saveSessions() {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
      fs.writeFileSync(this.sessionsFilePath, JSON.stringify(this.sessions, null, 2));
      this.syncSessionConfig();
    } catch (e) {
      log(`[TUI] Failed to save sessions: ${e}`, 'error');
    }
  }

  private syncSessionConfig() {
    const currentSession = this.sessions[this.selectedSessionIdx];
    if (currentSession) {
      this.queueEngine.setSessionConfig(currentSession.id, {
        id: currentSession.id,
        name: currentSession.name,
        headless: currentSession.headless
      });
    }
  }

  private updateUI() {
    const tasksTotal = this.queueEngine.getTasks().length;
    this.header.setContent(` INVISIBROW TUI | SESSIONS: ${this.sessions.length} | TASKS: ${tasksTotal}`);

    // Sort sessions by updatedAt DESC
    this.sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Group sessions by date
    const today = new Date().toDateString();
    const groups: { [date: string]: PersistedSession[] } = {};
    
    this.sessions.forEach(s => {
      const dateStr = new Date(s.updatedAt).toDateString();
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(s);
    });

    const sortedDates = Object.keys(groups).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    // Build sidebar items with grouping
    const sidebarItems: string[] = [];
    let sessionCount = 0;

    sortedDates.forEach(dateStr => {
      const label = dateStr === today ? 'TODAY' : dateStr.toUpperCase();
      sidebarItems.push(`{center}{yellow-fg}--- ${label} ---{/}{/}`);
      
      groups[dateStr].forEach(s => {
        const prefix = sessionCount === this.selectedSessionIdx ? '▶ ' : '  ';
        const mode = s.headless ? '(H)' : '(G)';
        const verifyTag = s.isVerifying ? ' {red-bg}{white-fg}[VERIFY]{/}' : '';
        sidebarItems.push(`${prefix}${s.name.padEnd(25).substring(0, 25)} ${mode}${verifyTag}`);
        sessionCount++;
      });
    });

    this.sidebar.setItems(sidebarItems);
    
    // Map selectedSessionIdx to UI index (skipping separators)
    if (this.sessions.length > 0) {
      let uiIdx = 0;
      let currentSessionCount = 0;
      for (let i = 0; i < sidebarItems.length; i++) {
          const item = sidebarItems[i];
          if (item && item.includes('---') && item.includes('---')) continue;
          if (currentSessionCount === this.selectedSessionIdx) {
              uiIdx = i;
              break;
          }
          currentSessionCount++;
      }
      this.sidebar.select(uiIdx);
    }

    this.sidebar.style.border.fg = this.focusPane === 'sidebar' ? 'cyan' : 'gray';
    this.taskArea.style.border.fg = this.focusPane === 'tasks' ? 'cyan' : 'gray';

    // Update Tasks & Session Info
    const currentSession = this.sessions[this.selectedSessionIdx] as PersistedSession | undefined;
    if (currentSession) {
      // Session Info Area
      const id = currentSession.id;
      const created = new Date(currentSession.createdAt || Date.now()).toLocaleString();
      const updated = new Date(currentSession.updatedAt).toLocaleString();
      const stats = currentSession.stats || { tokens: 0, cost: 0, contextSize: 0 };
      
      const infoText = [
        `{cyan-fg}ID:{/} ${id.padEnd(15)} {cyan-fg}Created:{/} ${created} {cyan-fg}Updated:{/} ${updated}`,
        `{yellow-fg}Tokens:{/} ${stats.tokens.toLocaleString()} (Limit: 1M) | {yellow-fg}Cost:{/} $${stats.cost.toFixed(4)} | {yellow-fg}Context:{/} ${stats.contextSize} msgs`
      ].join('\n');
      this.taskInfoArea.setContent(infoText);

      const tasks = this.queueEngine.getTasks().filter((t: AgentTask) => t.sessionId === currentSession.id);
      
      const taskItems: string[] = [];
      if (tasks.length === 0) {
        taskItems.push('{grey-fg}No tasks yet. Press "e" -> "e" to add one.{/}');
      } else {
        const spinnerIdx = Math.floor(Date.now() / 150) % this.spinnerFrames.length;
        tasks.forEach((t: AgentTask, i: number) => {
          let color = 'white';
          if (t.status === 'running') color = 'yellow';
          else if (t.status === 'completed') color = 'green';
          else if (t.status === 'failed' || t.status === 'cancelled') color = 'red';

          const prefix = (this.focusPane === 'tasks' && i === this.selectedTaskIdx) ? '▶ ' : '  ';
          const timeInfo = t.completedAt ? ` {grey-fg}(Done: ${new Date(t.completedAt).toLocaleTimeString()}){/}` : '';
          
          let statusText = t.status.toUpperCase();
          if (t.status === 'running') {
            statusText = `${this.spinnerFrames[spinnerIdx]} RUNNING`;
          }
          
          taskItems.push(`${prefix}{${color}-fg}[${statusText}] ${t.goal}{/}${timeInfo}`);
          if (t.result) {
            taskItems.push(`    {white-fg}└─ Ans: ${t.result}{/}`);
          }
          if (t.url) {
            const displayUrl = t.url.length > 60 ? t.url.substring(0, 57) + '...' : t.url;
            taskItems.push(`    {blue-fg}└─ URL: ${displayUrl}{/}`);
          }
        });
      }
      this.taskArea.setItems(taskItems);
      if (this.focusPane === 'tasks') {
        // Need to calculate correct UI index for tasks (including sub-lines)
        let uiTaskIdx = 0;
        let count = 0;
        for (let i = 0; i < tasks.length; i++) {
          if (i === this.selectedTaskIdx) {
            uiTaskIdx = count;
            break;
          }
          count++; // The main task line
          if (tasks[i].result) count++;
          if (tasks[i].url) count++;
        }
        this.taskArea.select(uiTaskIdx);
      }
    }

    // Update Command Bar based on Mode
    this.updateCommandBar();

    this.screen.render();
  }

  private updateCommandBar() {
    const s = this.sessions[this.selectedSessionIdx];
    if (this.mode === 'normal') {
      this.commandBar.style.border.fg = 'gray';
      let content = '';
      if (this.focusPane === 'sidebar') {
        content = ' [Tab] Switch to Tasks | [e] Actions | [n] New Session | [v] Toggle Headless | [j/k] Select | Ctrl+C Exit';
      } else {
        content = ' [Tab] Switch to Sidebar | [y] Copy URL/Res | [r] Copy Result | [o] Open URL | [j/k] Select Task';
        const tasks = this.queueEngine.getTasks().filter(t => t.sessionId === s?.id);
        const selectedTask = tasks[this.selectedTaskIdx];
        if (selectedTask && (selectedTask.url || selectedTask.result)) {
          content += ` | {yellow-fg}Click URL/Ans to Copy{/}`;
        }
      }
      
      if (s && s.isVerifying) {
        content = ' {red-bg}{white-fg}[c] Confirm Verification Done{/} |' + content;
      }
      this.commandBar.setContent(content);
    } 
    else if (this.mode === 'options') {
      const currentSession = this.sessions[this.selectedSessionIdx];
      const tasks = this.queueEngine.getTasks().filter(t => t.sessionId === currentSession?.id);
      const selectedTask = tasks[this.selectedTaskIdx];
      const stopAction = (selectedTask && selectedTask.status === 'running') ? ' | [s] Stop' : '';
      
      this.commandBar.style.border.fg = 'yellow';
      this.commandBar.setContent(` {yellow-fg}{bold}ACTIONS:{/} [e] Execute | [r] Rename${stopAction} | [l] Login | [d] Delete | [Esc] Cancel`);
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
