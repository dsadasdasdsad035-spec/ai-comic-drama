# Proposal

## Why

项目上下文目前只贯穿了一部分界面：镜头表有项目选择器并按项目读 `shots`，但剧本页没有选择器、未绑定项目时保存会静默返回；画布仍读写浏览器全局的 `storyboard-canvas-v1`，不会自动加载所选项目的镜头。结果是项目 `a` 明明有 52 个镜头，画布上却没有对应的 `shotId` 节点，拆角色（本集）报“没有分镜”，拆角色（全剧）又因为项目没有剧本场次而报“没有剧本素材”。多项目使用时还可能把 A 项目的画布内容同步进 B 项目。

## What Changes

- 在顶栏提供**全局项目选择器**，剧本、角色、镜头表、提示词、画布、设置页都可见；当前项目名始终可见。
- 切换项目时重新加载该项目的剧本、镜头、角色、素材和画布状态；未选择项目时进入只读/空状态，生成和保存按钮明确禁用或提示。
- 剧本页把项目作为硬前提：生成分集、保存分集都必须绑定项目；无项目时给出明确提示，不再静默 `return`。生成的分集在保存前只属于当前编辑态，不跨项目携带。
- 画布改为**项目级持久化**：布局/连线/素材卡按项目隔离；切换项目时从该项目的 `shots` 和项目级画布状态重载，禁止把上一项目的节点同步进新项目。
- **BREAKING**（本地存储）：现有全局 `storyboard-canvas-v1` 需要迁移到当前项目的项目级 key；迁移前不覆盖项目数据，提供一次性备份/回退路径。
- 拆角色统一读项目数据：
  - 从全剧拆角色：使用项目的 `source + episodes/scenes`；两者都为空时明确提示先保存剧本分集。
  - 从本集拆角色：使用该项目当前集的 `shots`（cast/台词/画面），不再只依赖画布节点；画布只作为可选的补充。
- 保留现有 `stageModelSelection` 与调度视频参考相关字段；本变更不改变模型选择逻辑。

## Capabilities

### New Capabilities

- `project-context`: 全局项目选择、项目切换与各视图的项目级数据重载；无项目时的只读/拦截规则。
- `character-extraction`: 从全剧剧本或本集镜头提取角色的数据来源、项目隔离与无素材时的明确错误。

### Modified Capabilities

无。

## Impact

- 代码：`src/App.tsx`（顶栏项目选择、项目切换、画布状态加载/迁移、同步守卫）、`src/ScriptBoard.tsx`（生成/保存项目前提）、`src/ShotTable.tsx`（选择器上移后的项目上下文）、`src/CharacterBoard.tsx` / `extractCharacters`（数据源与提示）、`src/charExtract.ts`（本集镜头摘要来源）。
- 存储：`storyboard-canvas-v1` 全局 key 迁移为项目级 key；不涉及 SQLite schema 变更。
- 验证：新增/更新 Playwright 项目切换与画布隔离测试、拆角色数据源测试、剧本保存守卫测试。
- 兼容：必须保留 `stage-model-selection` 的 `stageModels/stagePick` 和 `schedule-video-reference` 的调度视频字段；项目 `a` 这类“有镜头、无剧本”的数据不能被画布迁移覆盖。
