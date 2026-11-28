# Tasks

## 1. 数据与纯函数

- [x] 1.1 `subtitleCard.ts`：新增 `subtitleLlmSrtSystemPrompt` / 调整 user 提示；`parseSrtBlocks` + `isValidSubtitleSrt`；`migrateCuesToSrtBody`；验证：`node verify-subtitle-card.mjs` 覆盖校验与迁移
- [x] 1.2 `data.ts` / 类型：字幕资产增加 `srtBody?`，标记 `cues` 为遗留可选；验证：TypeScript `tsc` 无报错
- [x] 1.3 `server/db.mjs`：`writeProject` / 资产清洗读写 `srtBody`，迁移后不再持久化空 `cues`；验证：`node verify-subtitle-card.mjs` 或 `verify-asset-card-extra.mjs` 往返

## 2. 字幕卡 UI

- [x] 2.1 重写 `SubtitleAssetPanel`：移除 cue 列表与规则填充；`生成 SRT`（`callText` 非 JSON）+ `srtBody` 预览 textarea + `下载`；验证：面板内无 `data-subtitle-cues` / `data-subtitle-fill`
- [x] 2.2 生成失败保留旧 `srtBody`、未连线分镜拦截、无模型可读错误；验证：纯函数/组件级断言或扩展现有 verify 脚本

## 3. 集成与收尾

- [x] 3.1 更新 `verify-subtitle-card.mjs`：删除 cue 表用例，增加直出 SRT + 下载路径（可 stub `callText`）；验证：脚本 exit 0
- [x] 3.2 同步 `docs` 或 AGENTS 中字幕卡一句说明（若有用户向文档）；验证：人工扫一眼与规格一致
- [x] 3.3 `npm run build:server`（若动 `db.mjs`）；验证：bundle 时间晚于源码

## Workflow follow-up

- 与 `canvas-subtitle-card` 一并 review 后 archive；归档时合并 `canvas-subtitle-card` 规格与本 delta。