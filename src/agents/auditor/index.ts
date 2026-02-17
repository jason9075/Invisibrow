import OpenAI from 'openai';
import { getConfig } from '../../utils/config';
import type { IAgent, AgentResponse } from '../../core/types';

export interface AuditInput {
  goal: string;
  state: {
    url: string;
    title: string;
    contentSnippet: string;
  };
  history: string[];
}

export interface AuditOutput {
  isStuck: boolean;
  needsIntervention: boolean;
  reason: string;
}

export class AuditorAgent implements IAgent<AuditInput, AuditOutput> {
  readonly name = 'AuditorAgent';
  private openai: OpenAI;
  private model: string;

  constructor() {
    const config = getConfig();
    this.model = config.models.auditorAgent;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async execute(input: AuditInput): Promise<AgentResponse<AuditOutput>> {
    const { goal, state, history } = input;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `你是一個流程審計專員。你的任務是觀察一個瀏覽器自動化 Agent 的狀態，判斷它是否遇到了問題。
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
      if (!content) throw new Error('Auditor Agent returned empty response');
      
      const data = JSON.parse(content) as AuditOutput;
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
