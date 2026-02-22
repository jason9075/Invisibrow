import blessed from 'blessed';
import { PersistedSession } from '../types';

export class Sidebar {
  widget: blessed.Widgets.ListElement;

  constructor(screen: blessed.Widgets.Screen, headerHeight: number, logHeight: number, commandBarHeight: number, width: number) {
    this.widget = blessed.list({
      parent: screen,
      top: headerHeight,
      left: 0,
      width: width,
      height: `100%-${headerHeight + logHeight + commandBarHeight}`,
      label: ' SESSIONS ',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'cyan', fg: 'black' }
      },
      tags: true,
      keys: false,
      vi: false
    });
  }

  update(sessions: PersistedSession[], selectedIdx: number, hasFocus: boolean) {
    // Sort sessions by updatedAt DESC
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Group sessions by date
    const today = new Date().toDateString();
    const groups: { [date: string]: PersistedSession[] } = {};
    
    sessions.forEach(s => {
      const dateStr = new Date(s.updatedAt).toDateString();
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(s);
    });

    const sortedDates = Object.keys(groups).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    // Build sidebar items with grouping
    const sidebarItems: string[] = [];
    let sessionCount = 0;
    let uiIdx = 0;

    sortedDates.forEach(dateStr => {
      const label = dateStr === today ? 'TODAY' : dateStr.toUpperCase();
      sidebarItems.push(`{center}{yellow-fg}--- ${label} ---{/}{/}`);
      
      groups[dateStr].forEach(s => {
        const prefix = sessionCount === selectedIdx ? '▶ ' : '  ';
        const mode = s.headless ? '(H)' : '(G)';
        const verifyTag = s.isVerifying ? ' {red-bg}{white-fg}[VERIFY]{/}' : '';
        sidebarItems.push(`${prefix}${s.name.padEnd(25).substring(0, 25)} ${mode}${verifyTag}`);
        
        if (sessionCount === selectedIdx) {
          uiIdx = sidebarItems.length - 1;
        }
        sessionCount++;
      });
    });

    this.widget.setItems(sidebarItems);
    if (sessions.length > 0) {
       this.widget.select(uiIdx);
    }
    this.widget.style.border.fg = hasFocus ? 'cyan' : 'gray';
  }
}
