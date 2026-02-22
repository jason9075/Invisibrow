set shell := ["bash", "-cu"]

# 初始化環境
init:
    bun install

# 啟動 TUI 管理平台
start:
    bun src/index.ts

# 啟動 UI 測試模式 (Fake Tasks)
test-ui:
    UI_TEST=true bun src/index.ts

# 新增任務 (CLI 接口)
add-task session goal:
    curl -X POST http://localhost:3000/tasks -d '{"session": "{{session}}", "goal": "{{goal}}"}'

# 執行程式碼檢查
lint:
    bun x biome check .

# 修正程式碼格式
fmt:
    bun x biome format --write .

# 執行測試
test:
    bun test

# 建置專案
build:
    bun build ./src/index.ts --outdir ./dist --target node
