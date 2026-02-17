# Agent 記憶管理系統設計 (Memory Management System)

本文件紀錄了 Invisibrow 引入 SQLite 記憶管理系統的設計考量、架構與實作細節。

## 1. 核心目標
讓 Agent 具備「跨會話 (Cross-session)」的記憶能力，能根據歷史數據進行比對（如價格趨勢、重複任務優化），從單次任務執行者轉向長期知識積累者。

## 2. 技術選型
- **Database**: `bun:sqlite` (效能優異，無需額外驅動)。
- **Storage**: `~/.local/share/invisibrow/storage/memory.sqlite`。
- **Retrieval**: 關鍵字檢索 (Keyword-based retrieval) 配合 GPT 標籤化。

## 3. 關鍵設計考量 (Knowledge Points)

### A. 關鍵字質量的提升
- **問題**: 使用者原始輸入包含大量贅詞，直接檢索效果差。
- **解決**: 由 `PlanerAgent` 在存儲前進行「標準化標籤 (Standardized Tags)」提取。
- **範例**: `幫我找看看有沒有便宜的幫寶適尿布` -> 標籤: `尿布`, `幫寶適`, `價格`。

### B. 記憶的精煉與摘要
- **問題**: 儲存完整的 DOM 或日誌會導致資料庫臃腫，且 Context 窗口無法容納。
- **解決**: 僅儲存 `summary` (精華摘要) 與 `artifacts_json` (結構化數據)。
- **權限**: 僅 `PlanerAgent` 具備寫入權限，確保儲存的是經過決策後的「事實」。

### C. Context 注入策略 (Recall)
- **Top-K 檢索**: 每次任務僅檢索最相關的 3-5 條紀錄。
- **時間感知 (Time-Awareness)**: 注入時明確標註「這是 X 天前的紀錄」，讓 Agent 能判斷資訊的時效性。
- **比對邏輯**: 在 System Prompt 中加入指令，強制 Agent 將當前發現與歷史記憶進行對照。

### D. 雜訊過濾
- 僅優先檢索 `status = 'success'` 的紀錄。
- 排除純手動操作 (MANUAL_LOGIN) 等無分析價值的紀錄。

## 4. 資料表結構 (Schema)

```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  goal TEXT,            -- 原始任務目標
  keywords TEXT,        -- 關鍵字標籤 (逗號分隔)
  summary TEXT,         -- 任務執行後的總結
  artifacts_json TEXT,  -- 結構化數據 (JSON 格式)
  status TEXT,          -- 任務狀態 (success/failed)
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 5. 安全與隱私
- **脫敏處理**: 在存入 `summary` 與 `artifacts_json` 前，過濾可能的 Token 或敏感個人資訊。
- **權限隔離**: `BrowserAgent` 唯讀頁面，`PlanerAgent` 處理記憶邏輯，`MemoryService` 負責實體讀寫。

---
*Created: 2026-02-18*
