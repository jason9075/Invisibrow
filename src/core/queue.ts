import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { PlanerAgent } from '../agents/planer';

export interface AgentTask {
  id: string;
  sessionId: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
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
  private runningAborts: Map<string, AbortController> = new Map();
  private planer: PlanerAgent;
  private sessionConfigs: Map<string, SessionConfig> = new Map();
  private storagePath: string;
  private tasksFilePath: string;

  constructor(concurrency: number = 2) {
    this.queue = new PQueue({ concurrency });
    this.planer = new PlanerAgent();
    
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
        parsedTasks.forEach(t => {
          // 重置載入時仍處於 running/pending 的任務狀態為 failed 或待定
          if (t.status === 'running' || t.status === 'pending') {
            t.status = 'failed';
            t.error = '任務因系統重啟而中斷';
          }
          this.tasks.set(t.id, t);
        });
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

  async stopTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'running') {
      const controller = this.runningAborts.get(taskId);
      if (controller) {
        controller.abort();
        log(`[Queue] 已發送停止信號給任務 ${taskId}`);
      }
      task.status = 'cancelled';
      task.completedAt = new Date().toISOString();
      task.error = '使用者手動停止';
      this.saveTasks();
    }
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
    const controller = new AbortController();
    this.runningAborts.set(taskId, controller);

    this.queue.add(async () => {
      // 檢查是否在排隊期間被取消
      if (task.status === 'cancelled') {
        this.runningAborts.delete(taskId);
        return;
      }

      task.status = 'running';
      this.saveTasks();
      log(`[Queue] 開始執行任務 ${taskId} (Session: ${sessionId})`);
      
      try {
        if (process.env.UI_TEST === 'true') {
          const sleepTime = Math.floor(Math.random() * 5000) + 2000;
          log(`[UI-TEST] 模擬執行中... (${sleepTime}ms)`);
          
          // 模擬可中斷的 sleep
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, sleepTime);
            controller.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('User aborted'));
            });
          });

          task.result = "這是一個 Mock 的任務結果，用來測試 TUI 的顯示效果。";
          task.url = "https://www.google.com/search?q=this+is+a+very+long+url+to+test+truncation+logic+in+the+tui&sca_esv=123456&source=hp&ei=abcdef";
        } else {
          // 傳遞 signal 給 planer (需要 planer 支援)
          const res = await this.planer.execute(taskId, { 
            goal, 
            sessionId,
            headless: config?.headless ?? true,
            signal: controller.signal
          } as any);
          
          if (controller.signal.aborted) {
             throw new Error('User aborted');
          }

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
        if (error.message === 'User aborted') {
          task.status = 'cancelled';
          log(`[Queue] 任務 ${taskId} 已取消`);
        } else {
          task.status = 'failed';
          task.error = error.message;
          log(`[Queue] 任務 ${taskId} 失敗: ${error.message}`, 'error');
        }
        task.completedAt = new Date().toISOString();
      } finally {
        this.runningAborts.delete(taskId);
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
