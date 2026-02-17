import OpenAI from 'openai';
import { getConfig } from '../../utils/config';
import type { IAgent, AgentResponse, AgentCard } from '../../core/types';

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
}

export class WatchdogAgent implements IAgent<WatchdogInput, WatchdogOutput> {
  readonly card: AgentCard = {
    name: 'Watchdog Agent',
    description: '監控瀏覽器 Agent 的執行狀態，防止死循環並偵測需要人工介入的時機',
    version: '1.0.0',
    skills: [
      {
        id: 'execution_watchdog',
        name: 'Execution Watchdog',
        description: '監控自動化流程並確保其持續朝向目標前進'
      }
    ]
  };
  
  private openai: OpenAI;
  private model: string;

  constructor() {
    const config = getConfig();
    this.model = config.models.watchdogAgent;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async execute(taskId: string, input: WatchdogInput): Promise<AgentResponse<WatchdogOutput>> {
    const { goal, state, history } = input;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `你是一個 Watchdog 監控專員。你的任務是觀察一個瀏覽器自動化 Agent 的狀態，確保它沒有卡住或陷入死循環。
目標：${goal}

請分析以下狀況並判斷：
1. **isStuck**: 是否進入了死循環？（例如：反覆執行相同動作但頁面沒變、在同一個地方打轉超過 3 次）。
2. **needsIntervention**: 頁面是否出現了登入框、CAPTCHA 驗證碼、或者明顯需要人類介入的訊息？

回傳格式必須是 JSON：
{
  "isStuck": boolean,
  "needsIntervention": boolean,
  "reason": "簡短的判斷理由"
}`
          },
          {
            role: 'user',
            content: JSON.stringify({
              taskId,
              currentUrl: state.url,
              pageTitle: state.title,
              content: state.contentSnippet,
              recentHistory: history.slice(-5)
            })
          }
        ],
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message.content;
      if (!content) throw new Error('Watchdog Agent returned empty response');
      
      const data = JSON.parse(content) as WatchdogOutput;
      return {
        status: (data.isStuck || data.needsIntervention) ? 'intervention' : 'success',
        data
      };
    } catch (error: any) {
      return {
        status: 'failed',
        data: { isStuck: false, needsIntervention: false, reason: error.message },
        message: error.message
      };
    }
  }
}
