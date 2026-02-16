# AI Browser Agent TUI 管理平台開發指南

## 1. 架構願景 (Architecture Overview)
將原本「單次觸發」的腳步轉型為「長駐式管理員」。
- **多會話 (Multi-session)**：每個 Session 擁有獨立的瀏覽器環境與登入狀態。
- **併發控制 (Concurrency Control)**：限制同時執行的瀏覽器數量，避免記憶體耗盡。
- **即時監控 (Real-time Monitoring)**：透過 TUI 觀察各個 Agent 的思考過程與當前截圖狀態。

## 2. 核心組件設計 (Core Components)

### A. Session 隔離機制
- 實作路徑：`src/core/session.ts`
- 關鍵技術：使用 `--user-data-dir` 參數。
- 邏輯：為每個 Session 分配唯一的資料路徑 `./user_data/session_<id>`。

### B. 任務隊列系統 (The Queue Engine)
- 實作路徑：`src/core/queue.ts`
- 功能指標：使用 `p-queue` 限制併發數 (預設 2)，支援任務優先級與狀態追蹤。

### C. TUI 渲染層 (The UI Layer)
- 實作路徑：`src/tui/App.tsx`
- 使用 **Ink** 進行渲染，包含 Sidebar (Session 列表)、Main Panel (任務進度) 與 Log Console。

## 3. 實作規範 (Implementation Standards)
- **資料結構化**：定義 `AgentTask` 介面，包含 `id`, `goal`, `status`, `sessionId`。
- **日誌重導向**：使用 `winston` 紀錄日誌，並透過 `EventEmitter` 將即時日誌推送到 TUI。
- **記憶體管理**：任務完成後必須執行 `page.close()`，並定期清理閒置 Session。

---
*Last Updated: 2026-02-16*
