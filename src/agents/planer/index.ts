import OpenAI from 'openai';
import { getConfig } from '../../utils/config';
import type { IAgent, AgentResponse, PlanerStep } from '../../core/types';
import { BrowserAgent } from '../browser';
import { WatchdogAgent } from '../watchdog';
import { log } from '../../utils/logger';
import { memoryService } from '../../core/memory';

export interface PlanerInput {
  goal: string;
  sessionId: string;
}

export interface PlanerOutput {
  answer: string;
  url: string;
}

export class PlanerAgent implements IAgent<PlanerInput, PlanerOutput> {
  readonly card = {
    name: 'PlanerAgent',
    description: '負責高層任務規劃與 Agent 協調',
    version: '1.1.0',
    skills: [
      {
        id: 'task_planning',
        name: '任務規劃',
        description: '將複雜目標拆解為可執行的步驟'
      },
      {
        id: 'memory_recall',
        name: '記憶檢索',
        description: '從 SQLite 檢索相關歷史紀錄以供參考'
      }
    ]
  };

  private openai: OpenAI;
  private model: string;
  private browserAgent: BrowserAgent | null = null;
  private watchdog: WatchdogAgent;

  constructor() {
    const config = getConfig();
    this.model = config.models.planerAgent;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.watchdog = new WatchdogAgent();
  }

  private getBrowserAgent(sessionId: string): BrowserAgent {
    if (!this.browserAgent || this.browserAgent.sessionId !== sessionId) {
      this.browserAgent = new BrowserAgent(sessionId);
    }
    return this.browserAgent;
  }

  async execute(taskId: string, input: PlanerInput): Promise<AgentResponse<PlanerOutput>> {
    const { goal, sessionId } = input;
    const browser = this.getBrowserAgent(sessionId);
    const history: string[] = [];
    let currentStep = 0;
    const maxSteps = 15;

    log(`[Planer] 開始處理任務: ${goal} (Session: ${sessionId})`);

    try {
      // 1. 檢索歷史記憶
      const keywords = await this.extractKeywords(goal);
      const memories = await memoryService.search(keywords);
      const memoryContext = memories.length > 0 
        ? `\n### 相關歷史記憶 (供參考)：\n${memories.map(m => `[${m.timestamp}] 目標: ${m.goal}\n總結: ${m.summary}\n數據: ${JSON.stringify(m.artifacts)}`).join('\n---\n')}`
        : '';

      while (currentStep < maxSteps) {
        currentStep++;
        
        const pageState = await browser.getPageState();
        
        if (currentStep > 1) {
          const watchdogRes = await this.watchdog.execute(taskId, {
            goal,
            state: pageState,
            history
          });
          if (watchdogRes.status === 'intervention') {
            log(`[Planer] Watchdog 觸發介入: ${watchdogRes.data.reason}`, 'warn');
          }
        }

        const step = await this.planNextStep(goal, pageState, history, memoryContext);
        log(`[Planer] Step ${currentStep}: ${step.thought}`);
        history.push(`Thought: ${step.thought}`);

        if (step.command === 'finish') {
          // 2. 任務成功，儲存記憶
          const summary = step.input.answer || '任務完成';
          await memoryService.save({
            id: taskId,
            goal,
            keywords,
            summary,
            artifacts: step.input.artifacts || {},
            status: 'success'
          });

          return {
            status: 'success',
            data: {
              answer: summary,
              url: pageState.url
            }
          };
        }

        if (step.command === 'browser') {
          const browserRes = await browser.execute(taskId, step.input);
          if (browserRes.status === 'failed') {
            throw new Error(`Browser 執行失敗: ${browserRes.message}`);
          }
          history.push(`Action Result: ${browserRes.data.answer}`);
        } else if (step.command === 'wait') {
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      throw new Error('達到最大步數限制');
    } catch (error: any) {
      log(`[Planer] 任務執行失敗: ${error.message}`, 'error');
      return {
        status: 'failed',
        data: { answer: '', url: '' },
        message: error.message
      };
    }
  }

  private async extractKeywords(goal: string): Promise<string[]> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `你是一個關鍵字提取專家。請從使用者的目標中提取 3-5 個用於資料庫檢索的關鍵字。
回傳格式必須是 JSON：
{ "keywords": ["keyword1", "keyword2", ...] }`
        },
        { role: 'user', content: goal }
      ],
      response_format: { type: 'json_object' }
    });
    const data = JSON.parse(response.choices[0].message.content!);
    return data.keywords || [];
  }

  private async planNextStep(goal: string, state: any, history: string[], memoryContext: string): Promise<PlanerStep> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `你是一個高級規劃 Agent。你的目標是：${goal}
${memoryContext}

目前的執行歷史：
${history.join('\n')}

你的職責是根據目前的頁面狀態與歷史記憶，決定下一步該由 Browser Agent 執行什麼動作，或者是否已經完成任務。
如果存在歷史記憶，請務必將目前的發現與歷史數據（如價格、資訊）進行對比，並在最終答案中告知使用者差異。

### 回傳格式必須是 JSON：
{
  "thought": "你的思考過程",
  "command": "browser" | "finish" | "wait",
  "input": {
    // 如果 command 是 browser，這裡放給 BrowserAgent 的指令 (goal/action)
    // 如果 command 是 finish，這裡放 "answer" (包含比對結論) 與 "artifacts" (結構化數據)
  }
}`
        },
        { role: 'user', content: JSON.stringify(state) }
      ],
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content!) as PlanerStep;
  }
}
