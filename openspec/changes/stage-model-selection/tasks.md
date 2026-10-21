# Tasks

## 1. 设置数据模型与服务端文本解析

- [x] 1.1 在 `vite.config.ts` 与 `src/api.ts` 增加 `Stage` 类型和 `AppSettings.stageModels`；`normalizeSettings` 对缺失字段补空对象，`saveAppSettings` 合并 `stageModels`。验证：用旧设置（无 `stageModels`）调用 `GET /api/settings` 返回空对象且不报错；`PUT /api/settings` 写入后重新读取值一致。
- [x] 1.2 在 `vite.config.ts` 实现文本族解析：显式 `modelKey` 在 `text` / `textPro` 条目中精确查找，未知键或非文本键返回 400 `model-key-not-found`；族内没有任何模型时返回 400 `no-text-model`。验证：接口脚本分别用 textPro 键、不存在的键、空模型表调用 `/api/text`，结果符合预期且未知键不会发起上游请求。
- [x] 1.3 改 `/api/text` 响应，增加 `modelKey` 与 `modelLabel`；无 `modelKey` 的旧调用保持按 `defaults.text` / `defaults.textPro` 解析。验证：无键调用仍返回文本结果；显式键返回的 `model` 与所选条目的模型 ID 一致。
- [x] 1.4 新增 `verify-stage-models.mjs`（可用本地 mock 上游）覆盖 textPro 精确解析、未知键 400、无文本模型 400、无键兼容。验证：脚本退出码为 0，输出逐项通过。

## 2. 共享模型选择组件与 App 状态

- [x] 2.1 把 Inspector 内的 `ModelPicker` 提取到 `src/ModelSelect.tsx`，保留能力选择（image / view / video / audio），Inspector 改为引用共享组件。验证：Inspector 的配音/出图/出片下拉仍显示默认项与模型列表，选择后请求体中的 `modelKey` 不变。
- [x] 2.2 在 `src/ModelSelect.tsx` 增加 `StageModelSelect` 与环节解析辅助：列出 `text` + `textPro` 全部模型，首项显示「默认 · 解析结果」，并提供 `resolveStageModel` 按 手选 > stageModels > defaults.text > 族内第一条 解析。验证：构造不同设置/手选组合的页面，首项标签与实际解析键一致。
- [x] 2.3 App 增加 `stagePick` 状态与 `storyboard-stage-model-pick` 本地存储，向剧本/镜头表/提示词/角色板下发 `settings`、`stagePick`、`onPickStage`；Settings 保存后触发 `reloadSettings`。验证：刷新后手选仍在；在设置页改环节默认后回到工作台，默认标签立即更新。

## 3. 设置页与说明

- [x] 3.1 在 `src/Settings.tsx` 增加「生成环节默认模型」区域：剧本 / 角色 / 镜头表 / 提示词四个下拉，只列文本族模型，空值显示「未绑定 · 用文本默认」，保存进 `stageModels`。验证：四个下拉保存后 `GET /api/settings` 的 `stageModels` 与选择一致；清空后重新加载显示未绑定。
- [x] 3.2 在设置页补充说明：角色三视图使用「图像 · 角色三视图」默认，角色板可手选；环节手选只保存在本机。验证：设置页可见对应提示，文案不出现已下线的模型 ID 或 CLI 表述。
- [x] 3.3 更新 `README.md` 的能力说明，增加一句话描述四个环节的模型默认与手选。验证：README 搜索「环节模型」能找到说明，且命令示例未被改坏。

## 4. 四个环节接线

- [x] 4.1 `src/ScriptBoard.tsx`：删除 `lite/pro` 状态与下拉，改用 `StageModelSelect stage="script"`；`callText` 传解析后的 `modelKey`；成功提示显示 `modelLabel`。验证：拦截 `/api/text` 请求体，默认与手选分别传对键；刷新后手选保持。
- [x] 4.2 `src/ShotTable.tsx`：同样改用 `StageModelSelect stage="shot"`，拆镜请求传 `modelKey`，删除写死的 `model:'lite'`。验证：拦截请求体；选择 textPro 条目时请求键与所选条目一致，不再落到 text 默认。
- [x] 4.3 `src/PromptTable.tsx`：改用 `StageModelSelect stage="prompt"`，批量并行的每一批都带同一个 `modelKey`；成功提示显示 `modelLabel`。验证：多批请求体的 `modelKey` 一致；选择非默认模型后所有批次都使用它。
- [x] 4.4 `src/App.tsx` 的 `extractCharacters`：删除 `model:'pro'`，改用角色环节解析出的 `modelKey`。验证：拆角色请求体的 `modelKey` 与角色板选择一致；未绑定时使用文本默认。
- [x] 4.5 `src/CharacterBoard.tsx`：在角色板头部增加三视图模型选择（`CapModelSelect cap="view"`），通过 App 的 `modelPick.view` / `pickModelKey('view', ...)` 读写。验证：选择后三视图请求 `/api/seedream` 带对应 `modelKey` 且 `cap:'view'`；刷新后保持。
- [x] 4.6 `src/layoutGen.ts`：删除 `model:'lite'`，由 App 传入镜头表环节解析出的 `modelKey`。验证：3D 调度请求体使用镜头表环节模型；未绑定时使用文本默认。

## 5. 集成验证与回归

- [x] 5.1 运行 `npm run build`，确认 TypeScript 与构建通过。
- [x] 5.2 用 Playwright 覆盖：三个文本工作台与角色板的选择器列出文本族模型、默认标签正确、手选后请求体正确、刷新后保持；无效 stageModels 键显示不可用状态且生成失败有明确提示。
- [x] 5.3 重跑受影响的既有脚本（`verify-agent-plan.mjs`、`verify-providers.mjs`、`verify-script-knobs.mjs`、`verify-prompt-inject.mjs`），记录失败项并区分环境问题与本次回归。
- [x] 5.4 接口回归：确认无 `modelKey` 的旧调用仍工作；显式传入 `textPro` 键、`text` 键、未知键三种情况的响应与日志符合规范。

## Workflow follow-up

- 实现与验证完成后，使用 archive workflow 归档变更。
- 归档后确认 `openspec/specs/stage-model-selection/spec.md` 已生成，Purpose 不是占位文本。
