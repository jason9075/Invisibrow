import PQueue from 'p-queue';
import { log } from '../utils/logger';
import { BrowserAgent } from './agent';

export interface AgentTask {
  id: string;
  sessionId: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  url?: string;
  error?: string;
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

  constructor(concurrency: number = 2) {
    this.queue = new PQueue({ concurrency });
  }

  setSessionConfig(id: string, config: SessionConfig) {
    this.sessionConfigs.set(id, config);
  }

  async addTask(sessionId: string, goal: string) {
    const taskId = Math.random().toString(36).substring(7);
    const task: AgentTask = { id: taskId, sessionId, goal, status: 'pending' };
    this.tasks.set(taskId, task);

    const config = this.sessionConfigs.get(sessionId);

    this.queue.add(async () => {
      task.status = 'running';
      log(`[Queue] 開始執行任務 ${taskId} (Session: ${sessionId})`);
      
      try {
        if (process.env.UI_TEST === 'true') {
          const sleepTime = Math.floor(Math.random() * 7000) + 3000;
          log(`[UI-TEST] 模擬執行中... (${sleepTime}ms)`);
          await new Promise(r => setTimeout(r, sleepTime));
          task.result = "Fake task completed";
        } else {
          let agent = this.agents.get(sessionId);
          if (!agent) {
            agent = new BrowserAgent(sessionId);
            this.agents.set(sessionId, agent);
          }
          // 這裡可以傳入 config.headless
          const res = await agent.executeTask(goal);
          task.result = res.answer;
          task.url = res.url;
        }
        task.status = 'completed';
        log(`[Queue] 任務 ${taskId} 完成`);
      } catch (error: any) {
        task.status = 'failed';
        task.error = error.message;
        log(`[Queue] 任務 ${taskId} 失敗: ${error.message}`, 'error');
      }
    });

    return taskId;
  }

  getTasks(): AgentTask[] {
    return Array.from(this.tasks.values());
  }
}
