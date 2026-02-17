# Invisibrow TUI 管理平台開發指南

本文件為 Agent（如 Opencode）提供「長駐式 TUI 管理平台」的開發規範。

## 1. 架構規範 (Architecture)

### 多會話隔離 (Multi-session)
- 每個 Session 必須擁有獨立的 `userDataDir`。
- 路徑格式：`./user_data/session_<id>`。

### 任務隊列與併發 (Queue & Concurrency)
- 使用 `p-queue` 實作生產者-消費者模型。
- **預設併發數**: 2。
- 任務狀態流轉：`pending` -> `running` -> `completed` | `failed`。

### TUI 渲染 (UI Layer)
- 使用 **Ink (React for CLI)** 進行介面開發。
- 必須包含：
  - **Sidebar**: Session 列表 (Online/Offline)。
  - **Main Panel**: 任務進度與狀態。
  - **Log View**: 脫敏後的執行日誌。

## 2. 核心指令 (Justfile)

| 指令 | 說明 |
| :--- | :--- |
| `just init` | 安裝依賴 |
| `just start` | 啟動 TUI 管理平台 |
| `just add-task <session> <goal>` | 透過 CLI 新增任務到運行中的平台 |
| `just build` | 建置專案 |

## 3. 程式碼風格與結構

### 命名慣例
- 核心組件：`PascalCase` (e.g., `SessionManager`, `TaskRunner`)。
- TUI 組件：`PascalCase` (e.g., `LogView`, `App`)。

### 目錄結構
- `src/core/`: 核心邏輯 (Agent, Queue, Session)。
- `src/tui/`: 介面組件。
- `src/utils/`: Logger, Config。

## 4. 安全與日誌
- 嚴格脫敏：禁止在 TUI 顯示密碼或 Token。
- 使用 `winston` 紀錄日誌，TUI 訂閱事件更新畫面。

---
*Last Updated: 2026-02-16*
