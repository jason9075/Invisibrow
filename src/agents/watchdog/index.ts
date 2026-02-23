import { getConfig } from '../../utils/config';
import type { IAgent, AgentResponse, AgentCard, TokenUsage } from '../../core/types';
import type { AgentTaskStep } from '../../core/queue';
import { memoryService } from '../../core/memory';
import { MessageLogger } from '../../utils/message-logger';
import { estimateCost } from '../../utils/pricing';
import OpenAI from 'openai';

export interface WatchdogInput {
  goal: string;
  state: {
    url: string;
    title: string;
    contentSnippet: string;
  };
  history: string[];
}

export interface WatchdogOutput {
  isStuck: boolean;
  needsIntervention: boolean;
  reason: string;
  botDetected?: boolean;
  /** 若 LLM 發現新的阻塞方式（keyword scan 未涵蓋），提供建議 keyword 供自學 */
  newBlockKeywords?: string[];
  /** 本次 LLM 呼叫消耗的 token（keyword scan 快路徑時為 undefined） */
  tokenUsage?: AgentTaskStep['tokenUsage'];
}

export class WatchdogAgent implements IAgent<WatchdogInput, WatchdogOutput> {
  readonly card: AgentCard = {
    name: 'Watchdog Agent',
    description: '監控瀏覽器 Agent 的執行狀態：偵測反機器人/登入牆，並防止死循環',
    version: '2.0.0',
    skills: [
      {
        id: 'bot_detection',
        name: 'Bot Detection',
        description: '偵測 CAPTCHA、登入牆等需要人工介入的阻塞情況，並自學新 keyword',
      },
      {
        id: 'dead_loop_detection',
        name: 'Dead Loop Detection',
        description: '根據執行歷史判斷是否陷入死循環',
      },
    ],
  };

  private openai: OpenAI;
  private model: string;
  public sessionId: string = 'default';
  private botKeywords: string[] = [];
  private keywordsLoaded = false;

  constructor(sessionId?: string) {
    if (sessionId) this.sessionId = sessionId;
    const config = getConfig();
    this.model = config.models.watchdogAgent;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  async execute(
    taskId: string,
    input: WatchdogInput,
    onTokenUsage?: (usage: TokenUsage) => void,
  ): Promise<AgentResponse<WatchdogOutput>> {
    const { goal, state, history } = input;

    try {
      // 第一層：fast keyword scan（無 LLM，直接從 SQLite 判斷）
      const keywordHit = await this.keywordScan(state);
      if (keywordHit) {
        return {
          status: 'intervention',
          data: {
            isStuck: false,
            needsIntervention: true,
            reason: keywordHit,
            botDetected: true,
          },
          message: keywordHit,
        };
      }

      // 第二層：LLM 同時判斷 bot/登入牆 + dead loop
      const watchdogMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: `你是一個 Watchdog 監控專員。請同時分析以下兩種狀況：

任務目標：${goal}

**1. needsIntervention（強制阻擋）**
頁面是否出現了「強制」阻擋，導致任務目標無法繼續執行？

判斷時必須同時滿足以下三點才能設為 true：
- 出現了 CAPTCHA、強制登入牆、帳號封鎖、或存取拒絕的訊息
- 這個阻擋使 Agent「無法繼續」完成任務目標（例如：核心內容被隱藏或跳轉到登入頁）
- 頁面的「主要內容區域」被阻擋（而非導覽列、頁首的可選登入按鈕）

以下情況「不應」設為 true：
- 頁面角落或 header 有「登入」按鈕，但主內容仍可瀏覽（如 Google 搜尋結果、新聞網站）
- 頁面顯示「建議登入以獲得更好體驗」，但不強制且不影響任務
- 社交媒體有軟性登入提示，但部分內容仍可繼續瀏覽
- 任何不影響完成任務目標的可選登入入口

若 needsIntervention 為 true，請在 newBlockKeywords 提供 1-5 個能代表此阻塞情況的關鍵字（英文或中文均可），
以便系統下次可以用 keyword scan 直接偵測，不需要呼叫 LLM。

**2. isStuck（死循環）**
根據執行歷史，Agent 是否反覆執行相同動作但頁面沒有進展？（例如：在同一個地方打轉超過 3 次）

回傳格式必須是 JSON：
{
  "isStuck": boolean,
  "needsIntervention": boolean,
  "reason": "簡短的判斷理由",
  "newBlockKeywords": ["keyword1", "keyword2"]
}

若無阻塞也無死循環，newBlockKeywords 回傳空陣列。`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            taskId,
            currentUrl: state.url,
            pageTitle: state.title,
            content: state.contentSnippet,
            recentHistory: history.slice(-5),
          }),
        },
      ];
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: watchdogMessages,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error('Watchdog Agent returned empty response');

      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const usage: TokenUsage = { promptTokens: inputTokens, completionTokens: outputTokens, cachedTokens, model: this.model };
      const tokenUsage = { inputTokens, cachedTokens, outputTokens, cost: estimateCost(usage) };

      MessageLogger.log({
        timestamp: new Date().toISOString(),
        session_id: this.sessionId,
        agent_type: 'watchdog/execute',
        model: this.model,
        messages: watchdogMessages,
        response: {
          content,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens },
        },
      }, onTokenUsage);

      const data = JSON.parse(content) as WatchdogOutput;

      // 若 LLM 發現新的阻塞方式，自學寫入 SQLite
      if (data.needsIntervention && data.newBlockKeywords?.length) {
        for (const kw of data.newBlockKeywords) {
          await memoryService.addBotKeyword(kw);
        }
        // 同時從 title/snippet 中萃取更多潛在 keyword
        await this.learnKeywordsFromState(state, data.reason);
      }

      return {
        status: data.isStuck || data.needsIntervention ? 'intervention' : 'success',
        data: { ...data, tokenUsage },
      };
    } catch (error: any) {
      return {
        status: 'failed',
        data: {
          isStuck: false,
          needsIntervention: false,
          reason: error.message,
        },
        message: error.message,
      };
    }
  }

  /**
   * Fast path：從 SQLite 讀取已知的 bot detection keyword，
   * 不呼叫 LLM，命中即回傳阻塞原因。
   */
  private async keywordScan(state: WatchdogInput['state']): Promise<string | null> {
    await this.ensureKeywordsLoaded();
    const snippet = state.contentSnippet.toLowerCase();
    const title = state.title.toLowerCase();

    for (const keyword of this.botKeywords) {
      const lowerKeyword = keyword.toLowerCase();
      if (snippet.includes(lowerKeyword) || title.includes(lowerKeyword)) {
        return `偵測到「${keyword}」相關提示`;
      }
    }

    if (state.url.includes('google.com/sorry/index')) {
      return '偵測到 Google Sorry 驗證頁面';
    }

    return null;
  }

  private async ensureKeywordsLoaded() {
    if (this.keywordsLoaded) return;
    this.botKeywords = await memoryService.getBotKeywords();
    this.keywordsLoaded = true;
  }

  /**
   * 從頁面 title / contentSnippet 中萃取潛在 keyword，補充進 SQLite。
   * 只在 LLM 確認 needsIntervention 時呼叫，避免污染 keyword 庫。
   */
  private async learnKeywordsFromState(
    state: WatchdogInput['state'],
    reason?: string,
  ) {
    const sources = [reason, state.title].filter(Boolean) as string[];
    for (const text of sources) {
      await memoryService.addBotKeywordsFromText(text);
    }
    // 重置快取，讓下次 keywordScan 讀到最新資料
    this.keywordsLoaded = false;
  }
}
