import blessed from 'blessed';
import type { SessionStats } from '../types';

export class Header {
  widget: blessed.Widgets.BoxElement;

  constructor(screen: blessed.Widgets.Screen) {
    this.widget = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: { bg: 'blue', fg: 'white', bold: true }
    });
  }

  update(
    sessionCount: number,
    running: number,
    processed: number,
    total: number,
    stats?: SessionStats,
    contextWindowSize: number = 128_000,
  ) {
    const left = ` InvisiBrow TUI | Sessions: ${sessionCount} | ${running}/${processed}/${total} Tasks`;

    let right = '';
    if (stats && stats.tokens > 0) {
      const ctxPct = ((stats.lastPromptTokens / contextWindowSize) * 100).toFixed(1);
      const tokStr = stats.tokens >= 1_000
        ? `${(stats.tokens / 1_000).toFixed(1)}k`
        : `${stats.tokens}`;
      const cachedStr = stats.cachedTokens >= 1_000
        ? `${(stats.cachedTokens / 1_000).toFixed(1)}k`
        : `${stats.cachedTokens}`;
      right = `Tokens: ${tokStr} (cached: ${cachedStr}) | Cost: $${stats.cost.toFixed(4)} | Ctx: ${ctxPct}% `;
    }

    // 用空格填滿中間，使 right 靠右對齊
    const content = right.length > 0
      ? left + right.padStart(this.widget.width as number - left.length)
      : left;
    this.widget.setContent(content);
  }
}
