# Tasks

## 1. 多选浮动条

- [x] 1.1 在 `src/App.tsx` 的 `selbar` 移除「出片」「配音」按钮；`runOnSelected` 对外仅保留 `image`（或删除 `video`/`voice` 分支与 `selKind` 相关 UI）；验证：`rg "runOnSelected\\('video" src/` 与 `rg "runOnSelected\\('voice" src/` 无画布调用

## 2. 画布操作菜单

- [x] 2.1 在 `src/BoardMenu.tsx` 移除「批量出片」「批量配音」项及相关 `title`；从 props 移除 `onGenVideoAll`、`onVoiceAll`、`vidBatch`、`vbatch` 及触发器上出片/配音进度文案；验证：`npx tsc --noEmit` 通过且 `App.tsx` 传参已对齐

## 3. 文档与验收

- [x] 3.1 更新 `README.md`：画布批量仅「生成画面」；单镜出片/配音在 Inspector；删除「多选条批量出片」表述；验证：README 含「画布批量」且不含「多选.*出片」矛盾句
- [x] 3.2 更新 `verify-voice.mjs`（及检索到的 `批量出片`/`selbar` 出片配音断言）：批量配音改为 Inspector「声音」Tab 或删除已无效的菜单点击；`verify-image-lifecycle.mjs` 仍通过；验证：相关脚本在本地 dev 下退出码 0 或 documented skip
- [x] 3.3 在 `verify-shot-inspector.mjs` 或 `verify-image-lifecycle.mjs` 增加断言：`.selbar` 无「出片」「配音」文案按钮；打开 BoardMenu 无「批量出片」「批量配音」；验证：脚本断言通过

## Workflow follow-up

- `openspec validate canvas-image-only-batch --strict`
- 建议在 `canvas-image-only-card` 归档后再归档本 change，合并主 spec `storyboard-shot-card`
