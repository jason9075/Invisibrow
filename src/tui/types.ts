import { AgentTask, SessionConfig } from '../core/queue';

export type UIMode = 'normal' | 'options' | 'execute' | 'rename' | 'verify';

export interface PersistedSession extends SessionConfig {
  createdAt: string;
  updatedAt: string;
  isVerifying?: boolean;
  stats?: {
    tokens: number;
    cost: number;
    contextSize: number;
  };
}

export type FocusPane = 'sidebar' | 'tasks';
