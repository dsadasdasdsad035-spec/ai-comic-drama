# Tasks

## 1. 效果预设与导出

- [x] 1.1 新增 `transitionPresets.ts`（presetId、中文名、xfade 名、分类）；扩展 `TransitionEffect` 与 `normalizeEffect`/`xfadeName`/`effectLabel`；非法 id 回退叠化。用 `verify-transitions.mjs` 断言至少 12 个预设映射与旧三型兼容。
- [x] 1.2 更新 `TransitionPanel` 效果区为预设选择 UI；持久化到 `transitionOut.effect.presetId`。跑 `node verify-transitions-ui.mjs` 或手动截图验收一项新预设。
- [x] 1.3 确认 `vite.config.ts` 导出接缝接受新 xfade 名；必要时用本机 ffmpeg 列表过滤无效项并记录在预设表注释。

## 2. 食谱索引（轻量）

- [x] 2.1 提交 `src/transitionRecipes.json`（Transitions + 少量 Camera，含 id/title/intent/tags）；提供只读 `listTransitionRecipes(category?)` 供 Agent 与测试使用。
- [x] 2.2 文档说明如何从 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 增量同步卡片摘要（脚本可选，不阻塞发版）。

## 3. 转场 Agent 建议

- [x] 3.1 实现建议接口或 Agent 工具：输入两镜 + 当前转场，输出结构化建议；服务端校验 `presetId` 与 mode。单元/契约测试覆盖非法 preset、generated 带 recipeIds。
- [x] 3.2 `TransitionPanel` 增加「智能建议」与预览应用流；应用时不覆盖 `videoPromptOverride`；应用后 `buildTransitionVideoPreview` 与自动衔接段行为符合 `shot-transition-continuity` delta。
- [x] 3.3 扩展 `verify-transitions.mjs`：模拟应用建议后 prompt 含衔接段；效果建议写入 presetId 后指纹含 effect 字段（若尚未包含则补指纹）。
