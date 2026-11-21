# Tasks

## 1. 数据与导入

- [x] 1.1 导出 `isNarratorSpeaker`（复用 `NARRATOR` 正则）到 `src/narration.ts`，单测：旁白/os/vo 大小写与角色名区分
- [x] 1.2 修改 `intake/rows.ts`：旁白行写入 `dialogue` 数组，不再仅追加 `desc`；跑 `tests/storyboard-markdown.ts` 与导入相关用例断言旁白在 dialogue
- [x] 1.3 扩展 `project.json` 类型与读写：`narratorVoice { modelKey, voiceId }`；无字段时生成入口禁用

## 2. 旁白声线配置

- [x] 2.1 在项目或设置 UI 增加旁白模型+音色配置并写入当前项目；未选音色时保存阻止或清空
- [x] 2.2 配置变更后已有旁白 `voiceMeta` 标 stale（仅 `scope===narration`）；手测切换音色提示重生成

## 3. 合成与写回

- [x] 3.1 实现 `extractNarrationLines` + `buildNarrationPayload` + `generateNarrationOne`（基于 `generateVoice`）；多旁白行用项目 `modelKey`
- [x] 3.2 写回 `voiceUrl`/`voiceSeconds`/`voiceMeta`（`scope: 'narration'`）与旁白专用 fingerprint；失败不改 `voiceUrl`
- [x] 3.3 在 `App.tsx` 挂接 `generateNarrationOne` 并同步 project shot；成本确认若全局要求则与出图一致

## 4. Inspector UX

- [x] 4.1 `Inspector.tsx` 叙事/音画 Tab：旁白行计数、「生成旁白」、running/error、固定说明不进连播/导出
- [x] 4.2 有 `voiceUrl` 时 `<audio controls>` + 下载链接；stale 提示与「重新生成」
- [x] 4.3 可选 `ShotNode` 角标「旁白音」；时间线若展示 voiceUrl 加 tooltip「仅试听」

## 5. Agent（可选）

- [x] 5.1 `generate_narration` 工具：镜号/集号、与按钮同写回逻辑；Agent 冒烟一条旁白镜

## 6. 验证与文档

- [x] 6.1 新增或扩展脚本：mock TTS 生成旁白、`scope` 写回、Preview 导出 payload **不含** voiceUrl 音轨
- [x] 6.2 更新 README 旁白试听段；`npx tsc --noEmit` 与上述脚本退出码 0

## Workflow follow-up

- 评审通过后 `/opsx:sync` 合并 `shot-narration-tts` 与 `workbench-text-intake` delta，再归档变更。