# Tasks

## 1. 全局项目上下文

- [x] 1.1 抽出 `ProjectSelect` 放到顶栏，移除 `ShotTable` 内的项目选择器；剧本/角色/镜头表/提示词/画布/设置都使用同一个 `projectName`。验证：Playwright 打开六个视图都能看到项目选择；切换后顶栏和当前视图使用新项目。
- [x] 1.2 在 `App` 增加 `projectEpoch`、`projectReady` 和项目切换加载器：切换时并行加载项目剧本/镜头/角色/素材/画布，旧响应按 epoch 丢弃，加载完成前禁止写回。验证：用临时项目 A/B 与延迟 mock 响应切换，A 的迟到响应不会覆盖 B；切换后各视图只读 B 数据。

## 2. 剧本项目前提

- [x] 2.1 `ScriptBoard` 在无项目时禁用/拦截生成和保存，`save()` 不再静默返回；通过 `scriptDirty` 把未保存状态报给 `App`，切换项目时先确认。验证：无项目时点生成/保存有明确提示；有项目保存后 source/episodes 落到该项目；有未保存分集时切项目出现确认。

## 3. 画布项目隔离

- [x] 3.1 画布 localStorage 改为项目级 key（如 `storyboard-canvas-v1:<project>`），并在切换时从 `project.shots` 按 `shotId` 水合节点；有项目时不再注入演示节点，完整保留调度视频/素材/stage 字段。验证：A/B 两个项目切换后画布只显示各自镜头；项目 `a` 的 52 镜（当前集 15 镜）能从 `project.shots` 进入画布。
- [x] 3.2 旧全局 `storyboard-canvas-v1` 一次性迁移：先备份 `legacy-backup`，只迁移含当前项目 `shotId` 或项目无 shots 的情况，不覆盖 `project.shots`。验证：旧画布只有演示/其他项目节点时不会写入项目；有项目 shotId 时迁移成功且可回退。
- [x] 3.3 画布写回 effect 加项目/`projectReady` 守卫，只同步当前项目带 `shotId` 的节点；素材卡/布局只写项目级 key。验证：在 B 画布移动/删除节点不会修改 A 的 shots 或画布；无项目时不写 localStorage。

## 4. 拆角色项目数据源

- [x] 4.1 全剧拆角色改用当前项目的 `source + episodes`；两者都为空时返回“先保存分集/没有剧本素材”，不调用模型。验证：项目 `a`（0 集/0 字）得到明确错误；有分集的项目正常拆出角色。
- [x] 4.2 本集拆角色改用当前项目当前集的 `shots`（cast/台词/keyframe_prompt），不再只依赖画布节点。验证：项目 `a` ep1 的 15 个镜头即使没推到画布也能拆出角色；当前集无镜头时返回明确提示。
- [x] 4.3 拆角色读取/写入只针对当前项目；未保存分集时先提示保存。验证：项目 A/B 切换后素材与角色只属于当前项目；未保存分集时点全剧拆角色出现保存提示，不按旧数据请求。

## 5. 回归与文档

- [x] 5.1 新增 Playwright 项目切换集成测试：创建临时项目 A/B，覆盖全局选择器、剧本保存守卫、画布隔离/迁移、全剧/本集拆角色，并确认 stage model 与调度视频参考字段未回退。验证：测试通过，A/B 数据无交叉。
- [x] 5.2 更新 README/架构说明，写清项目是唯一数据边界、画布项目级存储与旧画布迁移方式。验证：文档步骤与 UI 行为一致。
- [x] 5.3 用真实项目 `a` 回归：切到 `a` 后画布从项目镜头水合，镜头表 52 镜、当前集 15 镜；本集拆角色不再报“没有分镜”；全剧拆角色在未保存分集时给出可执行提示。验证：三项观察符合预期。
- [x] 5.4 运行 `npm run build` 与现有 `verify-providers.mjs` / `verify-tail.mjs` / `verify-schedule3d.mjs` 等受影响脚本。验证：构建通过，失败项有明确的环境或预期原因。

## Verification notes

- `node verify-project-scope.mjs`：全部通过（顶栏项目选择、A/B 切换、画布项目级 key、未保存剧本确认、有项目保存写回、全剧无剧本本地拦截、本集拆角色读项目镜头、A/B 角色隔离、旧画布备份/迁移/位置保留）。
- 真实项目 `a`：项目选择 `a · 52 镜`；画布项目 key 62 节点 / 52 个 shotId，当前集显示 23 个节点；全剧拆角色提示没有剧本素材；本集拆角色请求包含项目镜头（S02/陈默），用 mock 拦截未写入真实项目。
- 无项目状态（临时空库）：顶栏显示“（无项目）”，剧本生成/保存禁用，拆角色提示“先绑定一个项目”，不发起 `/api/text`，不写项目画布 key。
- 有剧本项目（临时项目 C）：全剧拆角色的 prompt 包含 `C 原文梗概` 和 `C beats 发生`。
- `npm run build`：通过。
- `verify-providers.mjs`：设置/ dryRun / 首帧/多参考断言通过；整体仍因标准方舟 Key 401 和缺少 UI 夹具失败（环境问题）。
- `verify-tail.mjs` / `verify-schedule3d.mjs`：都在读取 `recycle` 项目时因项目不存在提前失败（环境夹具问题，与本次改动无关）。
- 项目加载器依赖收窄为 `projectName`，避免 `setNodes/setEdges` 重复触发加载覆盖拆角色结果；A/B 与真实项目验证均通过。

## Workflow follow-up

- 实现与验证完成后，使用 archive workflow 归档变更。
- 归档后确认 `openspec/specs/project-context/spec.md` 与 `openspec/specs/character-extraction/spec.md` 已生成，Purpose 不是占位文本。
