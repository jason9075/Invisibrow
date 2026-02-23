export type { TokenUsage } from '../utils/message-logger';

export interface A2APart {
  kind: 'text' | 'image' | 'json';
  text?: string;
  json?: any;
}

export interface A2AMessage {
  role: 'user' | 'agent' | 'system';
  parts: A2APart[];
  timestamp?: string;
}

export type TaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'intervention';

export interface TaskStatus {
  state: TaskState;
  message?: A2AMessage;
  timestamp: string;
}

export interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  history: A2AMessage[];
  artifacts?: any[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  examples?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  skills: AgentSkill[];
}

export interface AgentResponse<T = any> {
  status: 'success' | 'failed' | 'intervention';
  data: T;
  message?: string;
}

export interface BrowserResult {
  summary: string;
  extracted: Record<string, any>;
  url: string;
}

export interface PlanerStep {
  thought: string;
  command: 'browser' | 'finish' | 'wait';
  input: any;
}

export interface IAgent<TInput = any, TOutput = any> {
  card: AgentCard;
  execute(taskId: string, input: TInput): Promise<AgentResponse<TOutput>>;
}
