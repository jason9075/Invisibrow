set shell := ["bash", "-cu"]

# 初始化環境
init:
    bun install

# 執行程式碼檢查
lint:
    bun x biome check .

# 修正程式碼格式
fmt:
    bun x biome format --write .

# 執行所有測試
test:
    bun test

# 執行特定測試檔案
test-file file:
    bun test {{file}}

# 建置專案
build:
    bun build ./src/index.ts --outdir ./dist

# 執行開發模式
dev:
    bun --watch src/index.ts

# 運行 Agent (參數: URL QUERY)
run url query='這個網頁在做什麼？':
    bun src/index.ts {{url}} "{{query}}"
