import fs from 'fs';
import path from 'path';
import { QueueEngine } from '../../core/queue';
import { log, eventBus } from '../../utils/logger';
import { PersistedSession, UIMode, FocusPane, SessionStats } from '../types';
import type { TokenUsage } from '../../core/types';
import { estimateCost } from '../../utils/pricing';

/** 各 model 的 context window 大小（tokens） */
const MODEL_CONTEXT_WINDOW: Record<string, number> = {
  'gpt-4o':      128_000,
  'gpt-4o-mini': 128_000,
};

function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOW[model] ?? 128_000;
}

export class AppState {
  // Data
  sessions: PersistedSession[] = [];
  logs: string[] = [];
  inputHistory: string[] = [];
  
  // UI State
  selectedSessionIdx: number = 0;
  selectedTaskIdx: number = 0;
  focusPane: FocusPane = 'sidebar';
  mode: UIMode = 'normal';
  historyIdx: number = -1;
  
  // Dependencies
  queueEngine: QueueEngine;
  
  // Paths
  private storagePath: string;
  private sessionsFilePath: string;

  constructor(queueEngine: QueueEngine) {
    this.queueEngine = queueEngine;
    
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.storagePath = path.join(homeDir, '.local', 'share', 'invisibrow', 'storage');
    this.sessionsFilePath = path.join(this.storagePath, 'sessions.json');
    
    this.loadSessions();
  }

  // Session Management
  loadSessions() {
    try {
      if (fs.existsSync(this.sessionsFilePath)) {
        const data = fs.readFileSync(this.sessionsFilePath, 'utf8');
        this.sessions = JSON.parse(data);
      } else {
        this.createDefaultSession();
      }
    } catch (e) {
      log(`[TUI] Failed to load sessions: ${e}`, 'error');
      this.createDefaultSession();
    }
  }

  saveSessions() {
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

  createDefaultSession() {
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

  createNewSession() {
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
  }

  deleteCurrentSession() {
    if (this.sessions.length > 1) {
      this.sessions.splice(this.selectedSessionIdx, 1);
      this.selectedSessionIdx = 0;
      this.saveSessions();
    }
  }

  syncSessionConfig() {
    const currentSession = this.getCurrentSession();
    if (currentSession) {
      this.queueEngine.setSessionConfig(currentSession.id, {
        id: currentSession.id,
        name: currentSession.name,
        headless: currentSession.headless
      });
    }
  }

  // Getters
  getCurrentSession(): PersistedSession | undefined {
    return this.sessions[this.selectedSessionIdx];
  }

  getTasksForCurrentSession() {
    const session = this.getCurrentSession();
    if (!session) return [];
    return this.queueEngine.getTasks().filter(t => t.sessionId === session.id);
  }

  // Actions
  toggleHeadless() {
    const s = this.getCurrentSession();
    if (s) {
      s.headless = !s.headless;
      s.updatedAt = new Date().toISOString();
      this.saveSessions();
      log(`[TUI] Session ${s.id} headless: ${s.headless}`);
    }
  }

  /**
   * 提交任務到 QueueEngine，注入 sessionHistory 與 token 累積 callbacks。
   */
  async submitTask(sessionId: string, goal: string): Promise<string> {
    return this.queueEngine.addTask(sessionId, goal, {
      getSessionHistory: () => {
        const session = this.sessions.find(s => s.id === sessionId);
        return session?.sessionHistory ?? [];
      },
      onTokenUsage: (usage: TokenUsage) => {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        if (!session.stats) {
          session.stats = { tokens: 0, cachedTokens: 0, cost: 0, lastPromptTokens: 0 };
        }
        session.stats.tokens += usage.promptTokens + usage.completionTokens;
        session.stats.cachedTokens += usage.cachedTokens;
        session.stats.cost += estimateCost(usage);
        session.stats.lastPromptTokens = usage.promptTokens;
        session.updatedAt = new Date().toISOString();

        // 存檔 + 通知 TUI 更新 Header
        this.saveSessions();
        eventBus.emit('session:stats-updated', sessionId);
      },
      onSessionHistoryUpdate: (entry: string) => {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        if (!session.sessionHistory) session.sessionHistory = [];
        session.sessionHistory.push(entry);
        session.updatedAt = new Date().toISOString();
        this.saveSessions();
        log(`[AppState] Session ${sessionId} history updated (+1 entry)`);
      },
    });
  }

  addLog(message: string) {
    this.logs.push(message);
    if (this.logs.length > 50) this.logs.shift();
  }

  addToHistory(value: string) {
    if (this.inputHistory[0] !== value) {
      this.inputHistory.unshift(value);
    }
    this.historyIdx = -1;
  }
}
