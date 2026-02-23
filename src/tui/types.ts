import { AgentTask, SessionConfig } from '../core/queue';

export type UIMode = 'normal' | 'options' | 'execute' | 'rename' | 'verify' | 'command_palette' | 'keyword_manager';

export interface SessionStats {
  /** session 累積 prompt + completion tokens（含 cached） */
  tokens: number;
  /** session 累積 cached 命中的 tokens（費率 50%） */
  cachedTokens: number;
  /** 預估累積成本（USD） */
  cost: number;
  /** 最後一次 LLM 呼叫的 prompt_tokens，用來計算 context window 佔用率 */
  lastPromptTokens: number;
}

export interface PersistedSession extends SessionConfig {
  createdAt: string;
  updatedAt: string;
  isVerifying?: boolean;
  stats?: SessionStats;
  /**
   * 同一 session 內歷次成功任務的摘要，注入 PlanerAgent system prompt，
   * 讓後續任務能理解先前已完成的工作（類似 coding agent 的 conversation history）。
   */
  sessionHistory?: string[];
}

export type FocusPane = 'sidebar' | 'tasks';
