import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { BrowserAgent } from '../agents/browser';

export interface AgentTask {
  id: string;
  sessionId: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  url?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface SessionConfig {
  id: string;
  name: string;
  headless: boolean;
}

export class QueueEngine {
  private queue: PQueue;
  private tasks: Map<string, AgentTask> = new Map();
  private agents: Map<string, BrowserAgent> = new Map();
  private sessionConfigs: Map<string, SessionConfig> = new Map();
  private storagePath: string;
  private tasksFilePath: string;

  constructor(concurrency: number = 2) {
    this.queue = new PQueue({ concurrency });
    
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.storagePath = path.join(homeDir, '.local', 'share', 'invisibrow', 'storage');
    this.tasksFilePath = path.join(this.storagePath, 'tasks.json');
    
    this.loadTasks();
  }

  private loadTasks() {
    try {
      if (fs.existsSync(this.tasksFilePath)) {
        const data = fs.readFileSync(this.tasksFilePath, 'utf8');
        const parsedTasks: AgentTask[] = JSON.parse(data);
        parsedTasks.forEach(t => this.tasks.set(t.id, t));
        log(`[Queue] 已載入 ${parsedTasks.length} 個歷史任務`);
      }
    } catch (e) {
      log(`[Queue] 載入歷史任務失敗: ${e}`, 'error');
    }
  }

  private saveTasks() {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
      const data = Array.from(this.tasks.values());
      fs.writeFileSync(this.tasksFilePath, JSON.stringify(data, null, 2));
    } catch (e) {
      log(`[Queue] 儲存任務失敗: ${e}`, 'error');
    }
  }

  setSessionConfig(id: string, config: SessionConfig) {
    this.sessionConfigs.set(id, config);
  }

  async addTask(sessionId: string, goal: string) {
    const taskId = Math.random().toString(36).substring(7);
    const task: AgentTask = { 
      id: taskId, 
      sessionId, 
      goal, 
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    this.tasks.set(taskId, task);
    this.saveTasks();

    const config = this.sessionConfigs.get(sessionId);

    this.queue.add(async () => {
      task.status = 'running';
      this.saveTasks();
      log(`[Queue] 開始執行任務 ${taskId} (Session: ${sessionId})`);
      
      try {
        if (process.env.UI_TEST === 'true') {
          const sleepTime = Math.floor(Math.random() * 5000) + 2000;
          log(`[UI-TEST] 模擬執行中... (${sleepTime}ms)`);
          await new Promise(r => setTimeout(r, sleepTime));
          task.result = "這是一個 Mock 的任務結果，用來測試 TUI 的顯示效果。";
          task.url = "https://www.google.com/search?q=this+is+a+very+long+url+to+test+truncation+logic+in+the+tui&sca_esv=123456&source=hp&ei=abcdef";
        } else {
          let agent = this.agents.get(sessionId);
          if (!agent) {
            agent = new BrowserAgent(sessionId, config?.headless);
            this.agents.set(sessionId, agent);
          }
          const res = await agent.execute(taskId, goal);
          task.result = res.data.answer;
          task.url = res.data.url;
          if (res.status === 'failed') {
            throw new Error(res.message || 'Agent 執行失敗');
          }
        }
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        log(`[Queue] 任務 ${taskId} 完成`);
      } catch (error: any) {
        task.status = 'failed';
        task.completedAt = new Date().toISOString();
        task.error = error.message;
        log(`[Queue] 任務 ${taskId} 失敗: ${error.message}`, 'error');
      } finally {
        this.saveTasks();
      }
    });

    return taskId;
  }

  getTasks(): AgentTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}
