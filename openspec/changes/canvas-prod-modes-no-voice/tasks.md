# Tasks

## 1. 画布模式与 Image Dock

- [ ] 1.1 在 `App.tsx` 增加 `canvasProdMode` 状态与持久化；画布工具条增加「出图 | 出片」切换；验证：刷新后模式保留
- [ ] 1.2 新增 `ShotImageDock.tsx` 并挂载到画布（出图模式 + 单选分镜）；接入既有 `generateOne`、prompt、ratio、candCount、modelPick、`collectShotReferences` 摘要；验证：`npx tsc --noEmit` 通过
- [ ] 1.3 出片模式隐藏 Dock；出片模式下禁用或隐藏卡头 `.shot-gen`；验证：Playwright 或手测切换模式可见性

## 2. Inspector 去声音与迁台词

- [ ] 2.1 `inspectorLayout.ts`：移除 `audio` Tab 类型与配音 chip；`SHOT_TABS` 随 `canvasProdMode` 过滤；验证：`verify-shot-inspector.mjs` 更新为无第四 Tab「声音」
- [ ] 2.2 `Inspector.tsx`：删除声音 Tab 内容与吸底配音；台词/表演/表情参考开关迁入 `更多`；移除 `onVoice` 吸底；验证：选中镜无「生成配音」按钮
- [ ] 2.3 更新 `CharacterCard.tsx` 脚注：镜头台词不再指向 Inspector 声音；验证：文案不含「Inspector 声音」

## 3. 连播与导出 R2

- [ ] 3.1 `Preview.tsx`：段音频不再使用 `voiceUrl`；`assembleAnimatic` payload 不传 TTS voice；验证：`verify-preview-captions.mjs` 改为 video-only 夹具
- [ ] 3.2 `Timeline.tsx`：移除依赖 `voiceUrl` 的配音轨展示或改为纯文案提示；验证：无 TTS 轨 UI
- [ ] 3.3 服务端 assemble（`vite.config.ts` 或等价）：文档化并断言忽略孤儿 voice 段；`verify-export.mjs` 不期望 TTS 混音

## 4. 文档与验收

- [ ] 4.1 更新 `README.md` 连播/配音/Inspector 章节（R2、双模式、无声音 Tab）；验证：无「镜头 TTS」主路径描述
- [ ] 4.2 删除或重写 `verify-voice.mjs` 为「无批量/无 Inspector 配音 + 可选角色试音」；`verify-image-lifecycle.mjs` 与新模式 coexist；验证：相关脚本退出码 0 或明确 skip 说明
- [ ] 4.3 新增断言：模式切换 Tab 显隐、Dock 出现；`openspec validate canvas-prod-modes-no-voice --strict`

## Workflow follow-up

- 先归档 `canvas-image-only-card`、`canvas-image-only-batch` 并同步 `storyboard-shot-card`，再归档本 change
- 主 spec 合并：`canvas-prod-mode`、`shot-playback-audio`，并收窄 `voice-synthesis` Purpose
