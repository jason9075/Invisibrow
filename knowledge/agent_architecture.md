# Invisibrow 多 Agent 協同架構 (Multi-Agent Architecture)

本文件描述了 Invisibrow 系統中各 Agent 的角色定位、協作流程與資料流向。

## 1. 系統架構圖 (Logical Flow)

```text
[User Goal] 
    │
    ▼
[QueueEngine] ──► [PlanerAgent] (大腦/調度)
                     │    ▲
                     │    │ 1. 檢索歷史 (SQLite)
                     │    │ 2. 獲取頁面狀態
                     │    │
                     ▼    │
               [BrowserAgent] (執行器/手腳)
                     │    ▲
                     │    │ 操作 Puppeteer
                     ▼    │
               [WatchdogAgent] (監控器/眼睛)
                     │
                     └── 偵測死循環、驗證碼、介入需求
```

## 2. Agent 角色定義

### A. PlanerAgent (大腦)
- **職責**: 負責任務的高層規劃與決策。
- **權限**: 
    - 讀取: 原始目標、歷史記憶、Browser 回傳的頁面狀態。
    - 寫入: 任務指令、最終總結、寫入 SQLite 記憶。
- **核心邏輯**: 
    - 啟動時先進行 **Recall** (記憶檢索)。
    - 將目標拆解為 `PlanerStep`，指揮 Browser 動作。
    - 任務結束時執行 **Memorize** (記憶存儲)。

### B. BrowserAgent (執行器)
- **職責**: 專注於網頁互動與 Puppeteer 控制。
- **權限**: 
    - **唯一**擁有 Puppeteer 實例 (`browserMgr`) 操作權限。
    - 執行 `goto`, `click`, `type`, `search`, `wait` 等原子操作。
- **特點**: 
    - 重構後不再負責高層邏輯。
    - 使用 `gpt-4o-mini` 模型以平衡成本與速度。
    - 負責「機器人偵測 (Bot Detection)」與引發「人工介入 (Verification Needed)」事件。

### C. WatchdogAgent (監控器)
- **職責**: 獨立觀察自動化流程，防止失控。
- **監控標的**: 
    - 是否陷入死循環 (Stuck)。
    - 是否需要人工介入 (Needs Intervention)。
- **觸發機制**: 由 `PlanerAgent` 在每個決策環節中調用，作為安全鎖。

## 3. 記憶與持久化 (Memory & Persistence)

- **MemoryService**: 封裝 `bun:sqlite` 的單例服務。
- **資料流**:
    1. **Goal 關鍵字提取**: 任務開始時，Planer 提取關鍵字。
    2. **歷史注入**: Planer 將歷史紀錄注入 Context，引導 Agent 進行比對。
    3. **經驗固化**: 任務成功後，Planer 將「任務目標 + 執行摘要 + 結構化數據 (Artifacts)」存回資料庫。

## 4. 錯誤處理與介入機制

- **Verification Event**: 當 `BrowserAgent` 偵測到驗證碼時，會發送 `verification_needed` 事件。
- **TUI 整合**: `BlessedApp` 接收事件後，暫停 Queue 執行，並引導使用者進入手動操作模式。
- **Watchdog Intervention**: 若 Watchdog 判定流程卡死，會回傳 `intervention` 狀態，促使 Planer 調整策略或中止任務。

---
*Last Updated: 2026-02-18*
