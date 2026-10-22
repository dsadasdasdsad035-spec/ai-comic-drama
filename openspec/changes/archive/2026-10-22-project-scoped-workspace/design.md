# Design

## Context

当前 `App.tsx` 只有一份全局 `projectName`，但项目选择器只存在于 `ShotTable`。`ScriptBoard` 通过 `projectName` 读项目，却没有选择器；`save()` 在 `!projectName` 时静默 `return`。画布的 `nodes/edges/characters` 初始化自浏览器全局 `storyboard-canvas-v1`（`loadSaved`），不随 `projectName` 重载；项目镜头只存在于 `project.shots` 和镜头表，只有手动“生成到画布”才进入画布。

`extractCharacters` 的数据源也不一致：

- 全剧：`project.source + project.episodes`；
- 本集：当前画布节点中带 `shotId` 的镜头（cast/台词/画面）。

所以项目 `a`（52 镜、0 集、0 字原文、画布 0 个 shotId）会出现：全剧报“没有剧本素材”，本集报“没有分镜”，但镜头表里其实有 52 镜。

## Goals / Non-Goals

**Goals:**

- 一个全局项目上下文，所有视图同一套项目选择与数据重载。
- 项目切换是事务：旧项目的未保存状态不会静默写入新项目。
- 画布按项目隔离，并能从 `project.shots` 水合；旧全局画布可安全迁移。
- 剧本生成/保存必须有项目；拆角色明确使用项目剧本或项目镜头。

**Non-Goals:**

- 不改模型/渠道选择、拆镜/拆角色提示词或生成算法。
- 不引入服务端多用户/权限模型；仍是本地单用户项目。
- 不重做画布交互；保留镜头卡、素材卡、调度视频字段和 stage model 选择。
- 不自动把演示卡写入任何项目。

## Decisions

### 1. 顶栏统一项目选择，所有视图共享上下文

把 `ShotTable` 里的项目 `<select>` 抽成 `ProjectSelect`，放进顶栏；`ScriptBoard`、`CharacterBoard`、`ShotTable`、`PromptTable`、画布都只接收 `projectName`，不再各自维护选择器。无项目时显示“未选项目”。

**理由**：项目是全局数据边界，放在单个 tab 里会导致“剧本页无法选项目”和“切换项目后其他视图仍是旧上下文”。**替代方案**：每个视图各放一个选择器——状态重复、易分叉，放弃。

### 2. 项目切换用 `projectEpoch + projectReady` 做事务

`App` 维护 `projectEpoch`（每次切换自增）和 `projectReady`（项目数据加载完成）。切换时：

1. 检查剧本页是否有未保存分集（共享 `scriptDirty`），有则确认“切换会丢失/先保存”。
2. 递增 epoch，`projectReady=false`。
3. 并行加载 `getProject`、项目角色、素材和画布状态；每个异步回调校验 epoch，过期响应丢弃。
4. 设置 `projectName`、`epNo`（clamp 到有效集）、`characters`、`nodes`、`edges`，最后 `projectReady=true`。

所有写回 effect（角色、镜头、素材）都必须在 `projectReady` 且 `projectName` 匹配时执行。

**理由**：项目切换涉及多个异步请求和 localStorage；没有 epoch 守卫时，旧项目的 `getProject`/素材/角色响应会把新项目状态覆盖。**替代方案**：只依赖 React 清理函数——对 fetch 和 localStorage 写入不够，放弃。

### 3. 画布状态按项目持久化，并从 `project.shots` 水合

画布 key 改为 `storyboard-canvas-v1:<encodedProjectName>`，保存节点、连线、素材布局和 `cleared` 标记。切换项目时：

- 读项目级 key；有则用其布局/连线；
- 用 `project.shots` 作为节点业务字段的真相源，按 `shotId` 合并（项目里新增的镜头补节点，项目里没有的旧节点不写回项目）；
- 没有项目级 key 时，从 `project.shots` 构建节点（全部集，或当前集；画布仍按 `epNo` 过滤显示）；
- 项目没有镜头时画布为空，不注入演示节点。

写回时只同步当前 `projectName` 的节点，且只同步带 `shotId` 的业务节点；素材卡/布局留在项目级 key，不写入 `project.shots`。

**理由**：项目镜头是业务真相，画布是视图；全局 key 必然串项目。**替代方案**：完全由 `project.shots` 派生、不存布局——会丢节点位置/连线/素材卡，放弃。

### 4. 旧全局画布迁移：备份优先，只迁移能归属当前项目的节点

首次在选中项目时检测到 `storyboard-canvas-v1`：

- 先把旧值备份到 `storyboard-canvas-v1:legacy-backup`；
- 若旧画布含当前项目的 `shotId`，或当前项目没有 shots，则复制到项目级 key；
- 若旧画布只有演示/其他项目节点（0 个当前项目 shotId），不写入项目级 key，画布从 `project.shots` 开始；旧数据保留备份；
- 迁移只执行一次，写 `storyboard-canvas-migrated-v1` 标记；不覆盖 `project.shots`。

**理由**：项目 `a` 的全局画布是 15 个节点、0 个 shotId（演示/素材），直接迁移会把无关卡片塞进项目。**替代方案**：无条件迁移——会污染项目，放弃；弹窗让用户选择——可作为后续增强，不阻塞本次。

### 5. 剧本生成/保存绑定项目，脏状态共享

`ScriptBoard` 的生成/保存按钮在没有 `projectName` 时禁用并给出提示；`save()` 不再静默返回。`ScriptBoard` 通过 `onDirtyChange` 把 `dirty` 报给 `App`；项目切换时若有未保存分集，先确认。生成的分集只存在组件 state，保存后才进入项目；切换项目不携带。

**理由**：当前“能生成但保存静默失败”是用户以为剧本不需要项目的直接原因。**替代方案**：自动保存——会把半成品写入项目，放弃。

### 6. 拆角色按项目数据源取素材

- 全剧：`project.source + digestEpisodes(project.episodes)`；两者都空则返回“先保存分集/没有剧本素材”，不调用模型。
- 本集：`project.shots.filter(episode === epNo)`，映射为 `{no, cast, dialogue: dialogueToText, prompt: keyframe_prompt || desc}` 后走 `digestShots`；项目镜头存在时不再依赖画布节点。画布节点可作为补充，但不是唯一来源。
- 未保存分集：`scriptDirty` 为真时提示先保存，不按旧项目数据请求。
- 角色合并只写 `projectName` 对应的项目；`projectReady=false` 时不写。

**理由**：拆角色应围绕项目，不应被浏览器残留画布决定；全剧与`本集`的数据源要明确。**替代方案**：全剧也读 shots——会绕过剧本结构；只在无剧本时兜底可作为后续，不在本次。

### 7. 保留并行变更字段

`stageModels/stagePick`、`scheduleVideoReference`、素材卡和镜头同步字段原样保留；项目级画布 key 存整份节点数据，避免只存部分字段导致丢字段。迁移/水合按 `shotId` 合并，不重建业务字段。

## Risks / Trade-offs

- **切换时旧异步响应覆盖新项目** → epoch 守卫 + `projectReady`，所有写回 effect 双重校验。
- **旧画布迁移污染项目** → 先备份；只迁移含当前项目 shotId 或项目无 shots 的情况；项目 shots 永不覆盖。
- **演示节点写进项目** → 有项目时画布从 `project.shots` 水合，不注入 `initialNodes`；无项目才保留演示/空状态。
- **未保存分集丢失** → `scriptDirty` 切换前确认；保存按钮不再静默。
- **画布/项目 shots 双写冲突** → `project.shots` 为业务字段真相，画布只改布局/连线/素材；同步按 shotId 且只写当前项目。
- **大项目切换变慢** → 画布仍按 `epNo` 过滤，先加载当前集；项目级 key 只存布局，业务数据来自 shots。
- **并行变更回归** → 项目级存储保留完整节点字段；测试覆盖调度视频参考、stage model、素材卡。
- **没有项目时的空状态** → 顶栏“未选项目”，生成/保存/拆角色禁用或提示；画布不写 localStorage。

## Migration Plan

1. 抽 `ProjectSelect` 到顶栏，移除 ShotTable 内的项目选择器；所有视图接同一 `projectName`。
2. App 增加 `projectEpoch/projectReady/scriptDirty` 和项目切换加载器；写回 effect 加守卫。
3. 画布改为项目级 key，增加从 `project.shots` 水合、旧 key 备份/一次性迁移。
4. `ScriptBoard` 生成/保存项目前提与脏状态回调。
5. `extractCharacters` 改用项目 source/episodes 或项目 shots；无素材/未保存的明确提示。
6. 回归：两个临时项目 A/B 切换、画布隔离、剧本保存守卫、全剧/本集拆角色、旧画布迁移、调度/stage model 字段保留。
7. 回滚：恢复全局 `storyboard-canvas-v1` 与旧 App 读取逻辑；项目级 key 和备份保留，不涉及数据库 schema。

## Open Questions

无。
