# Agent Instructions: AI Browser Agent (agent_surf)

此文件為自動化 Agent（如 Opencode）提供本專案的開發規範、指令與慣例。在執行任何任務前，請務必詳閱並遵守。

## 1. 開發環境與運行指令 (NixOS & Just)

本專案採用 NixOS 進行環境管理，並使用 `just` 作為任務自動化工具。禁止使用 `sudo apt` 或 `pip install` 等全域安裝指令。

### 核心指令 (Justfile)
- **環境初始化**: `nix develop` 或 `direnv allow`
- **安裝依賴**: `bun install`
- **程式碼檢查**: `just lint` (使用 Biome 或 ESLint)
- **運行測試**: `just test`
- **運行單一測試**: `just test <file_path>` 或 `bun test <file_path>`
- **建置專案**: `just build`

### 瀏覽器執行環境
- **Executable Path**: 必須從環境變數讀取 `PUPPETEER_EXECUTABLE_PATH`。
- **Sandbox**: 啟動時必須帶入 `--no-sandbox` 與 `--disable-setuid-sandbox`。

## 2. 程式碼風格規範 (Code Style)

### 一般準則
- **縮進**: 2 個空格。
- **分號**: 必須使用分號 (Always use semicolons)。
- **引號**: 字串使用單引號 (`'`), JSON 使用雙引號 (`"`)。
- **匯入 (Imports)**: 
  - 使用 ESM (`import`/`export`) 語法。
  - 排序順序：1. Node.js 內建模組, 2. 外部庫 (External), 3. 內部模組 (Internal)。
- **型別安全**: 優先使用 JSDoc 或 TypeScript 進行型別標註。

### 命名慣例
- **變數與函式**: `camelCase` (例如: `launchBrowser`, `targetElement`)。
- **類別與組件**: `PascalCase` (例如: `AuthHandler`, `ScraperService`)。
- **常數**: `UPPER_SNAKE_CASE` (例如: `MAX_RETRY_COUNT`)。
- **檔案名稱**: `kebab-case.js`。

### 錯誤處理與日誌
- 使用 `try/catch` 處理非同步錯誤，並附加上下文資訊。
- **Credential Masking**: 嚴禁在 Log 中記錄密碼、Token 或金鑰。
- **日誌**: 詳細記錄操作步驟（例如：`Clicked [Login] button`），但須對內容進行脫敏處理。

## 3. 瀏覽器自動化與防爬蟲策略 (Mandates)

### Stealth & Anti-Bot
- **插件**: 必須整合 `puppeteer-extra-plugin-stealth`。
- **隨機化**: 每次 Session 啟動需隨機化 `User-Agent`、`Viewport` 與 `Device Pixel Ratio`。
- **模擬人類行為**:
  - 點擊與輸入需加入隨機延遲 (Jitter)。
  - 模擬打字速度：每字間隔隨機 50ms-200ms。
  - 使用平滑滾動 (Smooth Scrolling)。

### DOM 解析與穩定性
- **Selectors**: 避免使用脆弱的完整 XPath。優先使用 `aria-label`、`role` 或文字內容屬性。
- **視覺上下文**: 當選擇器失效時，應考慮使用截圖交由 LLM 判斷座標。
- **狀態機**: 實作明確的 Agent 狀態（例如：`IDLE`, `LOGGING_IN`, `TASK_IN_PROGRESS`）。

## 4. 安全與 Git 規範
- **Secrets**: 禁止 Commit `.env`, `*.json` (含金鑰者), `antigravity-accounts.json`。
- **Commit Message**: 遵循 Conventional Commits (例如: `feat:`, `fix:`, `chore:`)。
- **Nix Config**: 系統級設定應建議在 `/etc/nixos/` 或 Home Manager 中管理。

## 5. 專案結構
- `guidelines/`: 核心開發準則。
- `src/`: 原始碼。
- `tests/`: 測試案例。
- `flake.nix`: NixOS 環境定義。
- `justfile`: 任務自動化定義。

---
*Last Updated: 2026-02-16*
