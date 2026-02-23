import type { TokenUsage } from './message-logger';

/** 各 model 的定價（USD per 1M tokens） */
export const MODEL_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-4o':                     { input: 2.50,  cachedInput: 1.25,  output: 10.00 },
  'gpt-4o-mini':                { input: 0.15,  cachedInput: 0.075, output: 0.60  },
  'gpt-4o-2024-11-20':          { input: 2.50,  cachedInput: 1.25,  output: 10.00 },
  'gpt-4o-mini-2024-07-18':     { input: 0.15,  cachedInput: 0.075, output: 0.60  },
};

/** 預估單次 LLM 呼叫成本（USD） */
export function estimateCost(usage: TokenUsage): number {
  const pricing = MODEL_PRICING[usage.model] ?? { input: 2.50, cachedInput: 1.25, output: 10.00 };
  const nonCachedInput = usage.promptTokens - usage.cachedTokens;
  return (
    nonCachedInput * pricing.input +
    usage.cachedTokens * pricing.cachedInput +
    usage.completionTokens * pricing.output
  ) / 1_000_000;
}

/** 格式化費用字串，例如 $0.0032 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(4)}`;
}
