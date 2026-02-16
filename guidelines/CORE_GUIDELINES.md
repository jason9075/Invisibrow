AI Browser Agent Development Guidelines
1. Environment & Runtime (NixOS Specific)
Executable Path: 必須使用環境變數 PUPPETEER_EXECUTABLE_PATH 指定 Chromium 位置，禁止讓 Puppeteer 自行下載二進位檔。

Sandbox Configuration: 在 NixOS 環境下，啟動瀏覽器時必須帶入 --no-sandbox 與 --disable-setuid-sandbox 參數。

Headless Mode: 預設使用 new 模式，但在開發偵錯階段應支援 headless: false 以便視覺化觀察。

2. Stealth & Anti-Bot Strategy
Plugin Integration: 必須整合 puppeteer-extra 及其 stealth 插件，以規避基礎的 WebDriver 偵測。

Fingerprint Obfuscation: 每次 Session 啟動時，需隨機化 User-Agent、Viewport 尺寸以及設備像素比 (Device Pixel Ratio)。

Human-like Interaction:

所有點擊與輸入動作應加入隨機的延遲時間 (Jitter)。

輸入文字時，模擬真實打字速度（每字間隔隨機 50ms-200ms）。

頁面滾動應使用平滑滾動而非瞬間跳轉。

3. Dynamic DOM & AI Parsing
Resilient Selectors: 避免使用過於脆弱的完整 XPath 或長串 CSS Selector。優先使用 aria-label、role 或包含特定文字內容的屬性。

Visual Context: 當傳統 Selector 失效時，支援將頁面截圖 (Screenshot) 或簡化後的 DOM Tree 傳給 LLM，由 AI 判斷目標節點的位置座標。

State Machine: 實作狀態機機制，確保 Agent 清楚目前處於「登入中」、「導覽中」還是「執行任務中」。

4. Automation Flow Control
Navigation Safety: 執行關鍵操作（如發送資訊、提交表單）前，必須再次檢查目標頁面是否加載完成（使用 networkidle2 或特定元素出現為準）。

Retry Logic: 實作 Exponential Backoff 重試機制。若遇到導航超時，應先嘗試重新整理頁面而非直接終止程式。

Concurrency Control: 嚴格限制同時執行的瀏覽器實例數量，避免 CPU 或記憶體資源耗盡導致 Session 崩潰。

5. Security & Data Handling
Session Management: 支援讀取與寫入 cookies.json 或 localStorage，以實現登入狀態持久化，避免頻繁觸發登入驗證。

Credential Masking: 密碼與金鑰嚴禁記錄在 Log 中。所有機密資訊應從環境變數 (.env) 讀取。

Logging: 詳細記錄操作步驟（例如：Clicked [Post] button），但對內容進行脫敏處理。

6. Project Structure (Go/Node.js)
Modularization: 將「瀏覽器控制」、「AI 指令解析」與「業務邏輯」拆分為獨立模組。
