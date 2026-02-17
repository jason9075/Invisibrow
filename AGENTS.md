# Invisibrow TUI 管理平台開發指南

本文件為 Agent 提供「Invisibrow 長駐式 TUI 管理平台」的開發規範與架構說明。

## 1. 架構規範 (Architecture)

### A2A (Agent-to-Agent) 整合
- 遵循 A2A 標準實作 `IAgent` 介面。
- 每個 Agent 必須包含 `AgentCard` (名稱、版本、技能描述)。
- `execute(taskId, input)` 回傳統一的 `AgentResponse` 格式。

### 多會話與持久化 (Session & Persistence)
- 每個 Session 擁有獨立的 `userDataDir`: `./user_data/session_<id>`。
- 數據儲存於 `~/.local/share/invisibrow/storage/` (`sessions.json`, `tasks.json`)。

### 任務隊列 (Queue Engine)
- 使用 `p-queue` 實作，預設併發數 2。
- 支援 `WatchdogAgent` 協同作業：自動監控 `BrowserAgent` 流程，偵測死循環或需要人工介入 (CAPTCHA) 的狀況。

## 3. 目錄結構

- `src/core/`: 核心邏輯 (`types.ts` 定義 A2A, `browser.ts` 處理 Puppeteer, `queue.ts` 任務調度)。
- `src/agents/`:
  - `browser/`: 自主瀏覽 Agent。
  - `watchdog/`: 流程監控 Agent (負責監控 BrowserAgent)。

- `src/tui/`: `BlessedApp.ts` 介面邏輯。
- `src/utils/`: `clipboard.ts` (OSC 52), `logger.ts`, `config.ts`。

## 4. 安全與隱私
- 嚴格脫敏：禁止在 TUI 顯示敏感 Token。
- 驗證碼處理：優先引導使用者透過實體瀏覽器排除。

---
*Last Updated: 2026-02-17*
