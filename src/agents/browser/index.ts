import { z } from 'zod';
import { log } from '../../utils/logger';
import { BrowserManager } from '../../core/browser';
import type { IAgent, AgentResponse, BrowserResult, TokenUsage } from '../../core/types';
import type { AgentTaskStep } from '../../core/queue';
import { WatchdogAgent } from '../watchdog';
import { MessageLogger } from '../../utils/message-logger';
import { estimateCost } from '../../utils/pricing';
import OpenAI from 'openai';

const ActionSchema = z.object({
  thought: z.string(),
  action: z.enum([
    'goto',
    'click',
    'type',
    'search',
    'wait',
    'finish',
    'answer',
  ]),
  param: z.string().optional(),
  answer: z.string().optional(),
});

export type BrowserAction = z.infer<typeof ActionSchema>;

export class BrowserAgent implements IAgent<string, BrowserResult> {
  readonly card = {
    name: 'BrowserAgent',
    description: '負責自主瀏覽網頁、搜尋資訊、執行互動操作並整理結果摘要',
    version: '2.0.0',
    skills: [
      {
        id: 'web_navigation',
        name: '網頁導航',
        description: '前往指定 URL 並獲取頁面內容',
      },
      {
        id: 'web_interaction',
        name: '網頁互動',
        description: '點擊、輸入文字、搜尋等操作',
      },
      {
        id: 'data_extraction',
        name: '資料整理',
        description: '將頁面原始內容整理成結構化摘要回傳給 Planer',
      },
    ],
  };

  private openai: OpenAI;
  private browserMgr: BrowserManager;
  private watchdog: WatchdogAgent;
  public sessionId: string;
  private currentTaskId: string = '';

  constructor(sessionId: string, headless: boolean = true) {
    this.sessionId = sessionId;
    this.browserMgr = new BrowserManager(sessionId, headless);
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
    this.watchdog = new WatchdogAgent(sessionId);
  }

  public setHeadless(val: boolean) {
    this.browserMgr.setHeadless(val);
  }

  async execute(
    taskId: string,
    goal: string,
    onStep?: (step: Omit<AgentTaskStep, 'timestamp'>) => void,
    onTokenUsage?: (usage: TokenUsage) => void,
  ): Promise<AgentResponse<BrowserResult>> {
    try {
      if (goal === 'MANUAL_LOGIN') {
        await this.browserMgr.init();
        const page = this.browserMgr.getPage();
        log(`[${this.sessionId}] [${taskId}] 進入手動操作模式 (300 秒)`);
        if (page.url() === 'about:blank') {
          await page.goto('https://www.google.com');
        }
        await new Promise((r) => setTimeout(r, 300000));
        return {
          status: 'success',
          data: {
            summary: '手動操作結束',
            extracted: {},
            url: page.url(),
          },
        };
      }

      return await this.runAutomation(taskId, goal, onStep, onTokenUsage);
    } catch (error: any) {
      return {
        status: 'failed',
        data: { summary: '', extracted: {}, url: '' },
        message: error.message,
      };
    }
  }

  public async runAutomation(
    taskId: string,
    goal: string,
    onStep?: (step: Omit<AgentTaskStep, 'timestamp'>) => void,
    onTokenUsage?: (usage: TokenUsage) => void,
  ): Promise<AgentResponse<BrowserResult>> {
    await this.browserMgr.init();
    this.currentTaskId = taskId;
    let currentStep = 0;
    const history: string[] = [];

    while (currentStep < 15) {
      currentStep++;
      const state = await this.getPageState();

      // Watchdog：每步執行 keyword scan（fast）+ LLM（bot detection + dead loop）
      const watchdogRes = await this.watchdog.execute(taskId, {
        goal,
        state,
        history,
      }, onTokenUsage);

      if (watchdogRes.status === 'intervention') {
        log(
          `[${this.sessionId}] [${taskId}] Watchdog 介入: ${watchdogRes.data.reason}`,
          'warn',
        );
        return {
          status: 'intervention',
          data: {
            summary: '',
            extracted: {},
            url: state.url,
          },
          message: watchdogRes.data.reason,
        };
      }

      const { decision, tokenUsage: decisionTokenUsage } = await this.getDecision(goal, state, history, onTokenUsage);
      log(
        `[${this.sessionId}] [${taskId}] Step ${currentStep}: ${decision.thought}`,
      );
      history.push(`${currentStep}: ${decision.thought}`);

      // 合併 watchdog + getDecision 的 token 消耗到同一個 step
      const watchdogTokenUsage = watchdogRes.data.tokenUsage;
      const stepTokenUsage: AgentTaskStep['tokenUsage'] = {
        inputTokens: (watchdogTokenUsage?.inputTokens ?? 0) + decisionTokenUsage.inputTokens,
        cachedTokens: (watchdogTokenUsage?.cachedTokens ?? 0) + decisionTokenUsage.cachedTokens,
        outputTokens: (watchdogTokenUsage?.outputTokens ?? 0) + decisionTokenUsage.outputTokens,
        cost: (watchdogTokenUsage?.cost ?? 0) + decisionTokenUsage.cost,
      };

      onStep?.({
        agent: 'browser',
        step: currentStep,
        thought: decision.thought,
        command: decision.action,
        tokenUsage: stepTokenUsage,
      });

      if (decision.action === 'answer' || decision.action === 'finish') {
        // 任務完成：整理頁面資料，不把 raw DOM 傳給 Planer
        const result = await this.summarizePage(goal, state, decision.answer, onTokenUsage);
        return {
          status: 'success',
          data: result,
        };
      }

      await this.performAction(decision);
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    }

    throw new Error('達到最大步數限制');
  }

  /**
   * 任務完成時呼叫，用 mini model 將頁面內容整理成 BrowserResult。
   * Planer 只會看到這個摘要，不會接觸到 raw DOM。
   */
  private async summarizePage(
    goal: string,
    state: Awaited<ReturnType<typeof this.getPageState>>,
    rawAnswer?: string,
    onTokenUsage?: (usage: TokenUsage) => void,
  ): Promise<BrowserResult> {
    const model = 'gpt-4o-mini';
    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: `你是資料提取專員。根據任務目標，從頁面內容中提取關鍵資訊。

任務目標：${goal}

請回傳 JSON：
{
  "summary": "一段繁體中文自然語言摘要，說明頁面上與任務相關的重要內容",
  "extracted": { 任務相關的 key-value 結構化數據，例如價格、名稱、狀態等 }
}

只提取與任務目標直接相關的資訊，忽略廣告、導覽列等無關內容。`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            url: state.url,
            title: state.title,
            content: state.contentSnippet,
            agentAnswer: rawAnswer || '',
          }),
        },
      ];
      const response = await this.openai.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
      });

      MessageLogger.log({
        timestamp: new Date().toISOString(),
        session_id: this.sessionId,
        agent_type: 'browser/summarizePage',
        model,
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
      return {
        summary: data.summary || rawAnswer || '任務完成',
        extracted: data.extracted || {},
        url: state.url,
      };
    } catch (e: any) {
      log(`[${this.sessionId}] summarizePage 失敗，使用 fallback: ${e.message}`, 'warn');
      // fallback：確保流程不中斷
      return {
        summary: rawAnswer || '任務完成',
        extracted: {},
        url: state.url,
      };
    }
  }

  public async getPageState() {
    await this.browserMgr.init();
    const page = this.browserMgr.getPage();
    try {
      return await page.evaluate(() => {
        const selectors =
          'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
        const elements = Array.from(
          document.querySelectorAll(selectors),
        ).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

        return {
          url: window.location.href,
          title: document.title,
          interactiveElements: elements.slice(0, 100).map((el, i) => ({
            id: i,
            tag: el.tagName,
            text:
              (el as any).innerText?.trim().substring(0, 50) ||
              (el as any).placeholder ||
              (el as any).getAttribute('aria-label') ||
              '',
          })),
          contentSnippet: (document.body as HTMLElement).innerText.substring(
            0,
            1500,
          ),
        };
      });
    } catch (e: any) {
      log(`[${this.sessionId}] 獲取頁面狀態失敗: ${e.message}`, 'error');
      throw e;
    }
  }

  private async getDecision(
    goal: string,
    state: any,
    history: string[],
    onTokenUsage?: (usage: TokenUsage) => void,
  ): Promise<{ decision: BrowserAction; tokenUsage: NonNullable<AgentTaskStep['tokenUsage']> }> {
    const model = 'gpt-4o-mini';
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `你是一個專業的自主瀏覽器 Agent。你的目標是：${goal}
目前的歷史紀錄：
${history.join('\n')}

### 操作指南：
1. 觀察 URL 和 ContentSnippet 判斷是否成功跳轉。
2. 如果連續兩次執行相同 Action 且頁面狀態沒變，請嘗試點擊其他相關元素或使用不同的 Action。
3. 對於 X.com (Twitter) 等社交媒體，請優先尋找包含文字的區塊。
4. 如果發現被 Block (如出現驗證碼)，請立即回報。

請決定下一步動作。回傳格式必須是 JSON 物件：
{
  "thought": "你的思考過程",
  "action": "goto" | "click" | "type" | "search" | "wait" | "finish" | "answer",
  "param": "動作參數 (ID:文字 或 URL)",
  "answer": "最終答案"
}`,
      },
      { role: 'user', content: JSON.stringify(state) },
    ];
    const response = await this.openai.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
    });

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const usage: TokenUsage = { promptTokens: inputTokens, completionTokens: outputTokens, cachedTokens, model };

    MessageLogger.log({
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      agent_type: 'browser/getDecision',
      model,
      messages,
      response: {
        content: response.choices[0].message.content ?? '',
        usage: { input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens },
      },
    }, onTokenUsage);

    return {
      decision: JSON.parse(response.choices[0].message.content!) as BrowserAction,
      tokenUsage: { inputTokens, cachedTokens, outputTokens, cost: estimateCost(usage) },
    };
  }

  private async performAction(decision: BrowserAction) {
    const page = this.browserMgr.getPage();
    try {
      switch (decision.action) {
        case 'goto':
          if (decision.param)
            await page.goto(decision.param, {
              waitUntil: 'networkidle2',
              timeout: 30000,
            });
          break;
        case 'search':
          if (decision.param) {
            await page.goto('https://www.google.com', {
              waitUntil: 'networkidle2',
            });
            await new Promise((r) =>
              setTimeout(r, 1000 + Math.random() * 1000),
            );
            const searchInput = await page.$(
              'textarea[name="q"], input[name="q"]',
            );
            if (searchInput) {
              await searchInput.focus();
              await searchInput.click();
              await page.keyboard.type(decision.param, {
                delay: 150 + Math.random() * 200,
              });
              await new Promise((r) =>
                setTimeout(r, 500 + Math.random() * 500),
              );
              await page.keyboard.press('Enter');
              await page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: 45000,
              });
            } else {
              await page.goto(
                `https://www.google.com/search?q=${encodeURIComponent(decision.param)}`,
                { waitUntil: 'networkidle2' },
              );
            }
          }
          break;
        case 'click':
          if (decision.param) {
            const id = parseInt(decision.param);
            await page.evaluate((targetId: number) => {
              const selectors =
                'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
              const elements = Array.from(
                document.querySelectorAll(selectors),
              ).filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              const el = elements[targetId] as HTMLElement;
              if (el) {
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
                el.click();
              }
            }, id);
            await new Promise((r) => setTimeout(r, 2500));
          }
          break;
        case 'type':
          if (decision.param) {
            const [targetId, ...textParts] = decision.param.split(':');
            const text = textParts.join(':');
            const id = parseInt(targetId);
            await page.evaluate(
              (tid: number, txt: string) => {
                const selectors =
                  'a, button, input, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"], textarea';
                const el = Array.from(document.querySelectorAll(selectors))[
                  tid
                ] as HTMLElement;
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.focus();
                  el.click();
                  document.execCommand('insertText', false, txt);
                }
              },
              id,
              text,
            );
            await page.keyboard.press('Enter');
          }
          break;
        case 'wait':
          await new Promise((r) => setTimeout(r, 5000));
          break;
      }
      log(`[${this.sessionId}] 執行動作完成: ${decision.action}`);
    } catch (e: any) {
      log(`[${this.sessionId}] 執行動作失敗: ${e.message}`, 'error');
    }
  }

  async close() {
    await this.browserMgr.close();
  }
}
