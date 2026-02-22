import fs from 'fs';
import path from 'path';
import { QueueEngine } from '../../core/queue';
import { log } from '../../utils/logger';
import { PersistedSession, UIMode, FocusPane } from '../types';

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
