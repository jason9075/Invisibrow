import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { PlanerAgent } from '../agents/planer';
import type { TokenUsage } from './types';

export interface AgentTaskStep {
  /** 執行主體：planer 或 browser */
  agent: 'planer' | 'browser';
  /** 步驟編號（同 agent 內的 currentStep） */
  step: number;
  /** LLM 思考過程 */
  thought: string;
  /** 指令類型（browser/finish/wait 或 goto/click/type...） */
  command: string;
  /** ISO 時間戳 */
  timestamp: string;
  /** 本步驟 LLM 呼叫消耗的 token 與費用 */
  tokenUsage?: {
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    /** 預估費用（USD） */
    cost: number;
  };
}

export interface AgentTaskTokenUsage {
  /** prompt tokens（含 cached） */
  inputTokens: number;
  /** cached 命中的 tokens */
  cachedTokens: number;
  /** completion tokens */
  outputTokens: number;
}

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
  steps?: AgentTaskStep[];
  /** 本次任務累積的 token 用量 */
  tokenUsage?: AgentTaskTokenUsage;
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

  /**
   * 由 Agent 在每個執行步驟後呼叫，即時寫入持久化。
   */
  addStep(taskId: string, step: Omit<AgentTaskStep, 'timestamp'>) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (!task.steps) task.steps = [];
    task.steps.push({ ...step, timestamp: new Date().toISOString() });
    this.saveTasks();
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

  async addTask(
    sessionId: string,
    goal: string,
    opts?: {
      /** 取得此 session 的歷史任務摘要，注入 PlanerAgent */
      getSessionHistory?: () => string[];
      /** 每次 LLM 呼叫後累積 token 用量 */
      onTokenUsage?: (usage: TokenUsage) => void;
      /** 任務成功後，將新的摘要 append 到 session history */
      onSessionHistoryUpdate?: (entry: string) => void;
    },
  ) {
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

          // 隨機結果
          const mockResults = [
            '美元兌台幣匯率：1 USD = 32.45 TWD（資料來源：Google Finance）',
            '今日天氣：台北市晴時多雲，氣溫 18–24°C，降雨機率 10%',
            'NVIDIA (NVDA) 股價：$875.35，漲幅 +2.3%（今日收盤）',
            'GPT-4o API 定價：$2.50 / 1M input tokens，$10.00 / 1M output tokens',
            '台積電 (TSM) ADR 報價：$142.80，成交量 12.4M',
          ];
          const mockUrls = [
            'https://www.google.com/search?q=usd+twd+exchange+rate',
            'https://weather.gov.tw/forecast/taipei',
            'https://finance.yahoo.com/quote/NVDA',
            'https://openai.com/api/pricing',
            'https://finance.yahoo.com/quote/TSM',
          ];
          const idx = Math.floor(Math.random() * mockResults.length);
          task.result = mockResults[idx];
          task.url = mockUrls[idx];

          // 模擬 LLM token 用量（分多次呼叫累積，模擬 Planer + BrowserAgent 的多輪互動）
          const callCount = Math.floor(Math.random() * 4) + 2; // 2–5 次 LLM 呼叫
          task.tokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
          for (let i = 0; i < callCount; i++) {
            const inputTokens = Math.floor(Math.random() * 3000) + 500;
            const cachedTokens = Math.floor(Math.random() * inputTokens * 0.4); // 最多 40% cached
            const outputTokens = Math.floor(Math.random() * 500) + 100;
            task.tokenUsage.inputTokens += inputTokens;
            task.tokenUsage.cachedTokens += cachedTokens;
            task.tokenUsage.outputTokens += outputTokens;
            // 同步觸發 session-level token 累積
            opts?.onTokenUsage?.({
              promptTokens: inputTokens,
              cachedTokens,
              completionTokens: outputTokens,
              model: 'gpt-4o',
            });
          }
        } else {
          // 傳遞 signal 給 planer (需要 planer 支援)
          const res = await this.planer.execute(taskId, { 
            goal, 
            sessionId,
            headless: config?.headless ?? true,
            signal: controller.signal,
            onStep: (step: Omit<AgentTaskStep, 'timestamp'>) => this.addStep(taskId, step),
            onTokenUsage: (usage: TokenUsage) => {
              // 累積到 per-task tokenUsage
              if (!task.tokenUsage) {
                task.tokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
              }
              task.tokenUsage.inputTokens += usage.promptTokens;
              task.tokenUsage.cachedTokens += usage.cachedTokens;
              task.tokenUsage.outputTokens += usage.completionTokens;
              // 轉發給 session-level callback
              opts?.onTokenUsage?.(usage);
            },
            sessionHistory: opts?.getSessionHistory?.(),
            onSessionHistoryUpdate: opts?.onSessionHistoryUpdate,
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
