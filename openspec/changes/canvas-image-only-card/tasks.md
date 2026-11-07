# Tasks

## 1. 分镜卡 UI

- [x] 1.1 在 `src/ShotNode.tsx` 移除卡脚「出片」按钮、对 `!data.refImage` 的禁用逻辑，以及仅服务于该按钮的 `title` 文案；保留卡头「生成」、出图/出片运行叠加层与静帧·视频预览切换；验证：`npx tsc --noEmit` 通过
- [x] 1.2 在 `src/App.tsx`（及 `ShotNode` 类型）移除传给分镜卡的 `generateVideo` prop（若不再需要）；验证：`rg 'generateVideo' src/ShotNode.tsx` 无卡脚调用
- [x] 1.3 （可选）删除 `src/theme.css` 中未再使用的 `.shot-vid*` 规则；验证：构建无报错、卡面布局正常

## 2. 验收脚本

- [x] 2.1 更新 `verify-video.mjs`、`verify-video-prompt.mjs`、`verify-vid-ui.mjs`：出片操作改为 Inspector「视频」Tab 底栏（或批量条），不再点击 `.shot-vid`；验证：上述脚本退出码 0
- [x] 2.2 在 `verify-shot-inspector.mjs` 或新建 `verify-shot-card.mjs` 增加断言：画布上 `.shot-vid` 数量为 0，且卡头 `.shot-gen` 仍存在；验证：脚本退出码 0

## 3. 文档

- [x] 3.1 更新 `README.md`「画布参考与视频模式」与「分镜 Inspector」：写明单镜出片仅在 Inspector 视频 Tab（多选条批量出片保留）；验证：文档含「卡上不出片」表述

## Workflow follow-up

- 实现完成后运行 `openspec validate canvas-image-only-card --strict`
- 评审通过后归档并同步主 spec `storyboard-shot-card`
