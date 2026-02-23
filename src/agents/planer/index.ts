import { getConfig } from '../../utils/config';
import type { IAgent, AgentResponse, PlanerStep, BrowserResult, TokenUsage } from '../../core/types';
import type { AgentTaskStep } from '../../core/queue';
import { BrowserAgent } from '../browser';
import { log, eventBus } from '../../utils/logger';
import { memoryService } from '../../core/memory';
import { MessageLogger } from '../../utils/message-logger';
import { estimateCost } from '../../utils/pricing';
import OpenAI from 'openai';

export interface PlanerInput {
  goal: string;
  sessionId: string;
  /** 每個執行步驟後的回呼，由 QueueEngine 注入以即時持久化 */
  onStep?: (step: Omit<AgentTaskStep, 'timestamp'>) => void;
  /** 每次 LLM 呼叫後的 token 用量回呼，由 QueueEngine 注入以即時累積 session stats */
  onTokenUsage?: (usage: TokenUsage) => void;
  /**
   * 同 session 歷次成功任務的摘要（由 AppState 注入），
   * 注入 system prompt 讓 Planer 知道先前做了什麼。
   */
  sessionHistory?: string[];
  /**
   * 任務成功後，將本次任務摘要回傳給 AppState 以 append sessionHistory。
   */
  onSessionHistoryUpdate?: (entry: string) => void;
}

export interface PlanerOutput {
  answer: string;
  url: string;
}

export class PlanerAgent implements IAgent<PlanerInput, PlanerOutput> {
  readonly card = {
    name: 'PlanerAgent',
    description: '負責高層任務規劃與 Agent 協調',
    version: '2.0.0',
    skills: [
      {
        id: 'task_planning',
        name: '任務規劃',
        description: '將複雜目標拆解為可執行的步驟',
      },
      {
        id: 'memory_recall',
        name: '記憶檢索',
        description: '從 SQLite 檢索相關歷史紀錄以供參考',
      },
    ],
  };

  private openai: OpenAI;
  private model: string;
  private browserAgent: BrowserAgent | null = null;
  private sessionId: string = 'default';
  private taskId: string = '';
  private defaultHeadless: boolean = true;

  constructor() {
    const config = getConfig();
    this.model = config.models.planerAgent;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  private getBrowserAgent(sessionId: string, headless: boolean = true): BrowserAgent {
    if (!this.browserAgent || this.browserAgent.sessionId !== sessionId) {
      this.browserAgent = new BrowserAgent(sessionId, headless);
    }
    this.browserAgent.setHeadless(headless);
    return this.browserAgent;
  }

  async execute(
    taskId: string,
    input: PlanerInput & { signal?: AbortSignal; headless?: boolean },
  ): Promise<AgentResponse<PlanerOutput>> {
    const { goal, sessionId, headless, signal, onStep, onTokenUsage, sessionHistory, onSessionHistoryUpdate } = input as any;
    const normalizedHeadless = typeof headless === 'boolean' ? headless : true;
    this.sessionId = sessionId;
    this.taskId = taskId;
    this.defaultHeadless = normalizedHeadless;
    const browser = this.getBrowserAgent(sessionId, normalizedHeadless);

    // history 儲存 BrowserResult.summary，Planer 不持有任何 raw DOM
    const history: string[] = [];
    let currentStep = 0;
    const maxSteps = 15;
    // 最近一次 Browser 回傳的結果，作為 planNextStep 的決策依據
    let lastBrowserResult: BrowserResult | null = null;

    // 組建 session history context（同 session 先前成功任務的摘要）
    const sessionHistoryContext =
      sessionHistory && sessionHistory.length > 0
        ? `\n### 本 Session 先前完成的任務（供參考）：\n${sessionHistory.join('\n---\n')}`
        : '';

    log(`[Planer] 開始處理任務: ${goal} (Session: ${sessionId})`);

    try {
      // 1. 檢索歷史記憶
      const keywords = await this.extractKeywords(goal, onTokenUsage);
      const memories = await memoryService.search(keywords);
      const memoryContext =
        memories.length > 0
          ? `\n### 相關歷史記憶 (供參考)：\n${memories
              .map(
                (m) =>
                  `[${m.timestamp}] 目標: ${m.goal}\n總結: ${m.summary}\n數據: ${JSON.stringify(m.artifacts)}`,
              )
              .join('\n---\n')}`
          : '';

      while (currentStep < maxSteps) {
        if (signal?.aborted) throw new Error('User aborted');

        currentStep++;

        // Planer 根據上一步 BrowserResult（或初始狀態）決定下一步
        // 不呼叫 getPageState()，不接觸 raw DOM
        const { step, tokenUsage: stepTokenUsage } = await this.planNextStep(
          goal,
          lastBrowserResult,
          history,
          memoryContext,
          sessionHistoryContext,
          onTokenUsage,
        );
        log(`[Planer] Step ${currentStep}: ${step.thought}`);
        history.push(`Thought: ${step.thought}`);

        onStep?.({
          agent: 'planer',
          step: currentStep,
          thought: step.thought,
          command: step.command,
          tokenUsage: stepTokenUsage,
        });

        if (step.command === 'finish') {
          const summary = step.input.answer || lastBrowserResult?.summary || '任務完成';
          const artifacts = step.input.artifacts || lastBrowserResult?.extracted || {};

          // 2. 任務成功，儲存記憶
          await memoryService.save({
            id: taskId,
            goal,
            keywords,
            summary,
            artifacts,
            status: 'success',
          });

          // 3. 回傳本次任務摘要給 AppState，以 append sessionHistory
          const historyEntry = `[${new Date().toLocaleString('zh-TW')}] 目標: ${goal}\n結果: ${summary}`;
          onSessionHistoryUpdate?.(historyEntry);

          return {
            status: 'success',
            data: {
              answer: summary,
              url: lastBrowserResult?.url || '',
            },
          };
        }

        if (step.command === 'browser') {
          if (signal?.aborted) throw new Error('User aborted');

          const browserGoal =
            typeof step.input === 'string'
              ? step.input
              : step.input.goal || JSON.stringify(step.input);

          const browserRes = await browser.execute(taskId, browserGoal, onStep, onTokenUsage);

          if (browserRes.status === 'intervention') {
            if (currentStep > 0) currentStep--;
            await this.handleIntervention(browserRes, signal, browser, normalizedHeadless);
            continue;
          }

          if (browserRes.status === 'failed') {
            throw new Error(`Browser 執行失敗: ${browserRes.message}`);
          }

          // 儲存整理後的摘要，供下一個 planNextStep 使用
          lastBrowserResult = browserRes.data;
          history.push(`Browser Result: ${browserRes.data.summary}`);
        } else if (step.command === 'wait') {
          if (signal?.aborted) throw new Error('User aborted');
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 5000);
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new Error('User aborted'));
              },
              { once: true },
            );
          });
        }
      }

      throw new Error('達到最大步數限制');
    } catch (error: any) {
      log(`[Planer] 任務執行失敗: ${error.message}`, 'error');
      return {
        status: 'failed',
        data: { answer: '', url: '' },
        message: error.message,
      };
    }
  }

  private async handleIntervention(
    browserRes: AgentResponse<BrowserResult>,
    signal: AbortSignal | undefined,
    browser: BrowserAgent,
    defaultHeadless: boolean,
  ) {
    const reason = browserRes.message || 'Watchdog 需要人工介入';
    log(`[Planer] Watchdog 介入: ${reason}`, 'warn');
    eventBus.emit('verification_needed', {
      sessionId: this.sessionId,
      reason,
      url: browserRes.data.url,
    });

    await this.switchBrowserHeadless(browser, false);
    try {
      await this.waitForVerification(signal);
    } finally {
      await this.switchBrowserHeadless(browser, defaultHeadless);
    }
  }

  private async switchBrowserHeadless(browser: BrowserAgent, headless: boolean) {
    browser.setHeadless(headless);
    try {
      await browser.getPageState();
    } catch (error: any) {
      log(`[Planer] 切換 GUI 模式失敗: ${error.message}`, 'error');
    }
  }

  private waitForVerification(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onResolved = (data: { sessionId: string }) => {
        if (data.sessionId !== this.sessionId) return;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new Error('User aborted'));
      };
      const cleanup = () => {
        eventBus.off('verification_resolved', onResolved);
        signal?.removeEventListener('abort', onAbort);
      };

      eventBus.on('verification_resolved', onResolved);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async extractKeywords(goal: string, onTokenUsage?: (usage: TokenUsage) => void): Promise<string[]> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `你是一個關鍵字提取專家。請從使用者的目標中提取 3-5 個用於資料庫檢索的關鍵字。
回傳格式必須是 JSON：
{ "keywords": ["keyword1", "keyword2", ...] }`,
      },
      { role: 'user', content: goal },
    ];
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: 'json_object' },
    });
    MessageLogger.log({
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      agent_type: 'planer/extractKeywords',
      model: this.model,
      messages,
      response: {
        content: response.choices[0].message.content ?? '',
        usage: {
          input_tokens: response.usage?.prompt_tokens ?? 0,
          output_tokens: response.usage?.completion_tokens ?? 0,
          cached_tokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
      },
    }, onTokenUsage);
    const data = JSON.parse(response.choices[0].message.content!);
    return data.keywords || [];
  }

  /**
   * 根據上一步 BrowserResult 決定下一步指令。
   * Planer 只看 summary + extracted，不接觸 raw DOM。
   * lastResult 在第一步時為 null（任務剛開始，尚無 Browser 結果）。
   */
  private async planNextStep(
    goal: string,
    lastResult: BrowserResult | null,
    history: string[],
    memoryContext: string,
    sessionHistoryContext: string,
    onTokenUsage?: (usage: TokenUsage) => void,
  ): Promise<{ step: PlanerStep; tokenUsage: AgentTaskStep['tokenUsage'] }> {
    const context = lastResult
      ? { summary: lastResult.summary, extracted: lastResult.extracted, url: lastResult.url }
      : { summary: '任務剛開始，尚未有 Browser 執行結果', extracted: {}, url: '' };

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `你是一個高級規劃 Agent。你的目標是：${goal}
${sessionHistoryContext}
${memoryContext}

目前的執行歷史：
${history.join('\n')}

你的職責是根據 Browser Agent 回傳的摘要與歷史記憶，決定下一步該由 Browser Agent 執行什麼動作，或者是否已完成任務。
如果存在歷史記憶，請務必將目前的發現與歷史數據（如價格、資訊）進行對比，並在最終答案中告知使用者差異。

注意：你看到的是 Browser Agent 整理後的摘要，而非原始 HTML，請根據摘要判斷任務進度。

### 回傳格式必須是 JSON：
{
  "thought": "你的思考過程",
  "command": "browser" | "finish" | "wait",
  "input": {
    // 如果 command 是 browser，這裡放給 BrowserAgent 的完整指令字串（goal）。
    // 重要：若本 Session 先前任務或歷史記憶中已取得相關數據，
    // 必須在 goal 中明確列出已知數值，讓 BrowserAgent 只補充缺少的資訊，避免重複查詢。
    // 範例：「查詢人民幣對美元的匯率。已知資訊：1歐元=37.10台幣、1美元=32.5台幣（本 Session 先前結果）」
    // 如果 command 是 finish，這裡放 "answer"（包含比對結論）與 "artifacts"（結構化數據）
  }
}`,
      },
      {
        role: 'user',
        content: JSON.stringify(context),
      },
    ];
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: 'json_object' },
    });

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const usage: TokenUsage = {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      cachedTokens,
      model: this.model,
    };

    MessageLogger.log({
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      agent_type: 'planer/planNextStep',
      model: this.model,
      messages,
      response: {
        content: response.choices[0].message.content ?? '',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cached_tokens: cachedTokens,
        },
      },
    }, onTokenUsage);

    return {
      step: JSON.parse(response.choices[0].message.content!) as PlanerStep,
      tokenUsage: {
        inputTokens,
        cachedTokens,
        outputTokens,
        cost: estimateCost(usage),
      },
    };
  }
}
