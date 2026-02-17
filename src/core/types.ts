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

export interface AgentResponse<T = any> {
  status: 'success' | 'failed' | 'intervention';
  data: T;
  message?: string;
}

export interface IAgent<TInput = any, TOutput = any> {
  name: string;
  execute(input: TInput): Promise<AgentResponse<TOutput>>;
}
