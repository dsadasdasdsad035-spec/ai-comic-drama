# Design

## Context

平台工具分三类：读工具、契约写工具（`submit_*`）、动作工具（`generate_*`、`create_project` 等）。三者由 `builtinPlatformToolNames()` 汇总，并由 `assertPlatformToolConsistency` 在启动时校验「清单 / 注册 / 专家默认白名单」三方一致——新增工具若漏登记任何一处，启动即抛错。

四条现状决定实现形状：

1. **参考连线就是镜头字段**。画布拖线把源节点 id 写进目标镜的 `refIds`，边由字段派生，没有独立边存储。所以「支持连线」等于「能写 `refIds`」。
2. **节点 id 不可猜**。角色是 `char-<角色 id>`（可读），素材是 `asset-<随机 uid>`。让模型传 id 等于让它编随机数。
3. **素材卡有两处落点**。`project.assets` 是持久列表，画布节点在项目级 localStorage 键里；加载时若画布已有节点就不再从 `project.assets` 生成。
4. **表情总图的指纹是身份指纹原文**，不是哈希；八格坐标固定，`cropUrl` 由浏览器 canvas 现场裁出并落盘。

## Goals / Non-Goals

**Goals:**

- 让 agent 能完成画布设置动作：连参考、建素材卡、给角色出外观图、指定运镜参照。
- 所有写入都走与界面相同的持久化路径，避免「界面有、重开就丢」。
- 新增工具在启动时的一致性校验里自然登记，不出现幽灵工具。

**Non-Goals:**

- 不让 agent 生成分镜成片或改产线字段。
- 不让 agent 写 `refExtras`（该字段是 URL 集合，语义与参考连线不同）。
- 不做「名字模糊匹配」——解析不到就报错。

## Decisions

### D1 三个新动作工具 + 一个新契约，不扩 `submit_shots`

新增 `link_shot_refs`、`set_shot_camera_lexicon`、`set_character_visual` 三个动作工具，新增 `assets-v1` 契约与 `submit_assets`，并新增 `generate_character_views`、`generate_expression_sheet` 两个成本工具。

**为什么**：`submit_shots` 是整表合并语义，放进 `refIds` 会让模型有机会用自造 id 覆盖整镜参考。动作工具是「对某个具体对象做一件事」，天然幂等、天然可回报具体结果。

**替代方案**：给 `submit_shots` 加可选 `refIds`。被否——整表写 + 随机 id 是两个风险相乘。

### D2 一切寻址用名字，宿主解析

`link_shot_refs` 收 `kind: character | asset` 与名字；`set_character_visual` 收 `url` 或素材标题；`set_shot_camera_lexicon` 收条目 key 或中文名。

**为什么**：模型能看到的是名字（`read_shots` 返回 `refIds` 里的 id，但 `read_asset_inventory` 返回的是标题）。只给名字这一条路，模型不会编造 id。

**代价**：同名素材卡无法区分。缓解：重名时报错并列出候选标识，由用户决定。

### D3 `assets-v1` 走契约通道，与 `submit_designs` 并列

新契约字段：`assets: [{ title, kind, url, designId?, characterName? }]`。写回时按 `designId` 或 `characterName + kind=expression-sheet` 去重。

**为什么**：素材卡是集合型数据，与 `submit_designs` 同构，用契约能直接复用校验与写回骨架。

**替代方案**：动作工具 `add_asset_card` 一次一张。被否——一次要放多张时会变成多次往返，且无法做整批去重。

**注意**：`assets-v1` 的写回必须同时更新 `project.assets` 与画布节点。画布节点缺失时会由 `composeShotCanvasNodes` 从 `project.assets` 兜底重建，但节点 id 会重新生成，导致引用该卡的 `refIds` 失效——所以新建卡必须经宿主回调写画布状态，而不是只写项目。

### D4 表情总图的三个值全部由系统算

`cells` 用固定布局生成，`fingerprint` 取角色当前 `identityFingerprint`，`columns`/`rows` 固定 4×2。工具的 schema 里不暴露这三个参数。

**为什么**：`isSheetUsable` 用 `sheet.fingerprint !== currentIdentity` 判失效。模型随手填个哈希，总图会「写入成功但永远不可用」，且界面上看不出原因。

**替代方案**：让模型传指纹。被否——它不知道指纹算法，也没有必要知道。

### D5 采纳媒体与生成媒体分成两个工具

`set_character_visual`（无成本）与 `generate_character_views` / `generate_expression_sheet`（有成本）分开。

**为什么**：成本确认是独立动作。把「采纳已有图」和「花钱生图」塞进一个工具，会让每次采纳都有被要求确认的成本，而每次生图都可能被当成免费操作。

### D6 写角色外观走「立即落库」通道

角色图片类字段有一个不走防抖的保存函数（`saveCharactersNow`）。新工具必须复用它，而不是走角色整表草稿的合并路径。

**为什么**：`mergeCharacters` 有意保留旧图片、只补空字段——它保护用户手选的图。用那条路写图片会被静默丢弃。

**代价**：工具与界面共用一条即时保存路径，失败时要在工具结果里报出来，而不是只弹一个 toast。

### D7 新工具登记四处，缺一即启动失败

`PLATFORM_ACTION_TOOL_NAMES`（或读写清单）、`createBuiltinPlatformTools` 的注册、`DEFAULT_EXPERT_PLATFORM_TOOLS`、`expertToolGroups` 的分类集合，四处同时加。

**为什么**：`assertPlatformToolConsistency` 会检查前三处，第四处决定专家设置页显示在哪个分组。漏第四处不会报错，但工具会掉进「其它」，用户找不到开关。

**替代方案**：把一致性校验扩到分类集合。可以做，但分类是展示层，缺了不致命；先用测试覆盖。

## Risks / Trade-offs

- **[画布状态与项目素材双写不一致]** 写卡成功但画布状态写失败时，重开项目卡片会由 `project.assets` 兜底重建，但 id 变了 → 工具在结果里报告「已写入项目素材，画布卡片将在重开后重建」，不谎报完全成功。
- **[表情总图裁剪依赖浏览器]** 工具只能在渲染进程执行 → 明确写入工具描述，避免被搬到服务端调用。
- **[采纳素材卡图当三视图产生耦合]** 角色外观会随素材卡删除而失效 → 采纳时把图片地址固化到角色上，不做引用；素材卡删除不影响已采纳的角色图。
- **[成本工具误用]** agent 可能连续生成多张 → 每个成本工具都要独立的成本确认，且描述里写明「先确认再调用」。
- **[重名素材卡]** 同名卡无法按标题寻址 → 报错并列出候选，让用户改名或改用地址。

## Migration Plan

- 无数据迁移：全部复用既有字段。
- 回滚：删除新工具与 `assets-v1` 注册即可；已写入的素材卡与角色图是既有结构，旧代码照常读取。
- 顺序：依赖 `storyboard-export-fidelity` 先落地 `lexicon_ref_*` 三个字段，否则 `set_shot_camera_lexicon` 无处可写。
