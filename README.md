# Invisibrow 🚀

這是一個基於 Puppeteer 與 OpenAI 的自動化瀏覽器 Agent，旨在模擬人類行為進行網頁分析與導覽。

## 🌟 核心特性

- **NixOS Native**: 完美整合 Nix Flakes，自動處理 Chromium 依賴與路徑。
- **Stealth Mode**: 內建 `puppeteer-extra-plugin-stealth` 與行為隨機化，降低被偵測風險。
- **AI Brain**: 使用 OpenAI GPT-4o 分析網頁內容，理解動態頁面結構。
- **Modern Stack**: 使用 Bun 執行環境，極速開發與測試。
- **TUI Management**: 提供基於終端機的使用者介面，方便管理多個 Agent 任務。
- **Session History**: 同一 Session 內的歷次成功任務摘要會自動注入後續任務的 context，讓 PlanerAgent 具備跨任務的記憶能力。
- **Token & Cost Tracking**: 即時追蹤每次 LLM 呼叫的 token 用量（含 OpenAI Prompt Cache 命中數），並依 model 定價估算累計成本，顯示於 TUI Header。

## 🛠 快速開始

### 1. 環境準備
確保您的系統已安裝 Nix 且啟用了 Flakes。

```bash
nix develop
```

### 2. 設定密鑰
編輯 `.env` 填入您的 `OPENAI_API_KEY`。

### 3. 初始化專案
使用 `just` 指令安裝所有依賴：

```bash
just init
```

### 4. 運行 TUI 管理平台
啟動主要的 TUI 介面：

```bash
just start
```

## ⚙️ 進階配置 (Model Adjustment)

本專案採用多 Agent 協同架構，您可以在 `~/.config/invisibrow.json` 中自定義各個 Agent 使用的模型：

```json
{
  "models": {
    "planerAgent": "gpt-4o",
    "browserAgent": "gpt-4o-mini",
    "watchdogAgent": "gpt-4o-mini"
  }
}
```

- **PlanerAgent**: 負責任務拆解與邏輯規劃，建議使用 `gpt-4o`。
- **BrowserAgent**: 負責網頁互動與資料提取，若發現執行動作不準確，可升級至 `gpt-4o`。
- **WatchdogAgent**: 負責異常監控，建議維持 `gpt-4o-mini` 以節省成本。

## 📊 TUI 介面說明

### Header（頂部狀態列）

執行任務時，Header 右側會即時顯示目前 Session 的資源消耗：

```
InvisiBrow TUI | Sessions: 2 | 1/3/5 Tasks    Tokens: 24.5k (cached: 8.1k) | Cost: $0.0087 | Ctx: 19.2%
```

| 欄位 | 說明 |
| :--- | :--- |
| `Tokens` | Session 累積 prompt + completion tokens 總量 |
| `cached` | 其中命中 OpenAI Prompt Cache 的 tokens（費率為正常的 50%） |
| `Cost` | 依 model 定價估算的累計成本（USD） |
| `Ctx` | 最後一次 LLM 呼叫佔用的 context window 百分比 |

### Session Info（任務清單上方）

顯示目前 Session 的 token 統計與已完成的 session history 條目數：

```
Tokens: 24,500 (cached: 8,100) | Cost: $0.0087 | History: 3 tasks
```

## 📜 常用指令 (Justfile)

| 指令 | 說明 |
| :--- | :--- |
| `just init` | 初始化環境 (`bun install`) |
| `just start` | 啟動 TUI 管理平台 |
| `just test-ui` | 啟動 UI 測試模式 (Fake Tasks) |
| `just lint` | 執行程式碼檢查 (Biome) |
| `just fmt` | 修正程式碼格式 |
| `just test` | 執行測試 |
| `just build` | 建置專案 |
| `just add-task <session> <goal>` | 新增任務 (CLI 接口) |

## 📁 專案結構

- `src/agents/`: 各類 Agent 實作 (Browser, Planer, Watchdog)。
- `src/core/`: 核心邏輯 (Browser 控制, Queue, Types)。
- `src/tui/`: TUI 介面實作 (BlessedApp, Components)。
- `src/utils/`: 工具函式庫 (Config, Logger, MessageLogger)。
- `flake.nix`: NixOS 環境定義與 Chromium 自動路徑設定。
- `Justfile`: 任務自動化腳本。
- `AGENTS.md`: 提供給 AI Coding Agents 的開發指南。

### 持久化儲存 (`~/.local/share/invisibrow/storage/`)

| 檔案 | 說明 |
| :--- | :--- |
| `sessions.json` | Session 設定，含 `stats`（token/cost 累計）與 `sessionHistory`（跨任務摘要） |
| `tasks.json` | 任務歷史紀錄（含逐步 thought log） |
| `memory.sqlite` | 長期記憶（跨 Session 的任務摘要 + bot keywords） |
| `message/<session>/<agent>/` | 每次 LLM 呼叫的完整 input/output 落地，含 `cached_tokens` 欄位 |

## 🛡️ 安全規範
- 禁止在 Commit 中包含 `.env` 或任何 credentials。
- 所有的瀏覽器操作皆帶有 `--no-sandbox` 以符合 NixOS 隔離環境。
