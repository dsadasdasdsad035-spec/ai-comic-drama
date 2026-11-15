# Pi Agent 参考连线与素材工具

## Why

画布上的「角色参考/素材参考」连线本质上就是目标镜的 `refIds`，素材卡是画布节点，角色的三视图与表情总图是镜头参考的真实来源，镜头语言则是运镜参照；Pi Agent 对这几项目前只有读工具，`generate_keyframe` 还明确「不创建素材卡、不改参考连线」。结果是 agent 能拆镜、能写提示词、能出片，却无法完成「把角色和素材连到镜头」「往画布加一张素材卡」「给角色出一套可用的外观参考」「给镜头指定运镜参照」这类画布设置。

## What Changes

### 参考连线

- 新增 `link_shot_refs`：对指定镜号**增删**参考连线，用**名字**寻址（`kind: character | asset` + 角色名/素材标题），MUST NOT 让模型传画布节点 id。
  - 宿主按角色名解析为 `char-<角色 id>`，按素材标题解析为对应素材卡节点 id；解析不到时 MUST 报错并列出候选，MUST NOT 写入猜测的 id。
  - 只改目标镜 `refIds`，不改 `refExtras`；重复连接幂等。
  - `submit_shots` 保持不接收 `refIds`，避免模型用自造 id 整表覆盖参考。

### 素材卡

- 新增 `assets-v1` 契约与 `submit_assets`：新增或更新画布素材卡，字段 `title` / `kind` / `url` / 可选 `designId` / 可选 `characterName`。
  - 同一 `designId`，或同一 `characterName + expression-sheet`，视为同一张卡，重复提交 MUST 更新而非新增。
  - `url` MUST 能在当前项目的媒体里解析；解析不到 MUST 拒绝并说明，MUST NOT 写死链。
  - 写入 MUST 同时落到画布状态与项目素材列表；只写一侧会导致重开项目丢卡。

### 角色当前图与表情总图

- 新增 `generate_character_views`（成本确认）：按角色英文锚点生成三视图，写回 `image` 并把结果插入 `candidates` 首位。
- 新增 `generate_expression_sheet`（成本确认）：按角色锚点生成 4 列 × 2 行八格总图，裁剪八格后写回 `expression_sheet`。
- 新增 `set_character_visual`（无成本）：把**当前项目里已有的媒体**指定为某角色的三视图或表情总图，`source` 记为 `uploaded`；媒体可以是项目内上传图、素材卡图片或设定卡当前图，按 `url` 或素材卡标题寻址；MUST 拒绝项目外地址与无法解析的路径。
- 总图的 `cells`、坐标、`fingerprint` MUST 由系统计算，MUST NOT 接受模型给的值：
  - `cells` MUST 由固定 4×2 布局生成；
  - `fingerprint` MUST 等于该角色当前 `identityFingerprint`，否则总图一写入即不可用。
- 八格裁剪 MUST 用既有裁剪路径；单格失败 MUST 保留总图并回报失败格，MUST NOT 编造 `cropUrl`。
- 三视图路径 MUST 是项目内本地相对路径；dataURL 不得写进项目（既有映射会丢弃），工具 MUST 走既有保存路径或拒绝。
- 写角色外观 MUST 立即落库，MUST NOT 等防抖；否则刷新即丢。
- 只改 `image` / `candidates` MUST NOT 让已可用的表情总图失效（身份指纹不含三视图）。
- 生成成功后 MUST NOT 自动把表情总图发布成画布素材卡，MUST NOT 自动连参考；发布与连线仍是显式动作。

### 镜头语言参照

`lexicon_ref_key` / `lexicon_ref_url` / `motion_lexicon_as_ref` 三个字段与其落库映射由 `storyboard-export-fidelity` 交付（该变更的 `运镜参照` 列依赖它们才能有数据）。本变更只负责让 agent 能操作它们。

- 新增 `set_shot_camera_lexicon`（无成本）：
  - 按条目 `key` 或中文名/英文名解析 catalog 条目，MUST 唯一匹配；匹配多条 MUST 报错并列出候选。
  - 绑定前 MUST 先把该条目的视频导入项目（复用既有 `/api/camera-lexicon/import`），再把项目内地址写入 `lexicon_ref_url`。
  - 解绑 MUST 清空三个字段；`motion_lexicon_as_ref` 解绑后 MUST 为关闭。
  - MUST NOT 自动把条目发布成画布素材卡（发布是独立动作）。
- 读侧沿用既有 `list_camera_lexicon` / `get_camera_lexicon`；本次不新增读工具。

### 工具可见性

- 上述工具挂到具备画布/素材/角色工作台权限的专家；只读技能 MUST NOT 获得。
- 每次写入 MUST 回报改了谁、连了几张、新增还是更新了哪张卡、哪些格裁剪失败、绑定或解绑了哪条运镜参照。

### 明确不做

- 不生成分镜成片、不改产线字段；不写 `refExtras`；不自动建卡、不自动连线、不自动发布素材卡。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `canvas-shots-workbench`: 参考边写入从「只有画布拖线」扩展为「画布拖线与 agent 工具写同一 `refIds`」；新增镜头语言参照随镜头落库的要求。
- `asset-canvas-publishing`: 素材卡除设定卡发布外可由 agent 显式新增/更新，并保持稳定标识与去重。
- `character-appearance`: 三视图与表情总图除界面操作外可由 agent 生成或采纳，且必须遵守既有的指纹、裁剪与失效规则。

## Impact

- 代码：`src/skills/contracts.ts`（`assets-v1`）、`src/skills/tools.ts`（工具 id）、`src/platform/projectDraft.ts`（契约写回）、`src/agent/builtinPlatformTools.ts`（连线、素材卡、角色外观、镜头语言工具）、`src/creative/expertToolGroups.ts`（可见性）、`src/App.tsx`（素材卡与角色的宿主回调）。
- 服务端：素材卡沿用 `shots.extra` 之外的既有 `assets` 存储；`camera-lexicon/import` 接口复用。
- 复用：`src/expressionSheet.ts`（布局与指纹）、`src/expressionCrop.ts`（八格裁剪）、`src/characters.ts`（`identityFingerprint`、`TURNAROUND_SUFFIX`）、`src/charMap.ts`（角色落库）、`src/cameraLexicon.ts`（条目解析）。
- 依赖：镜头语言三字段由 `storyboard-export-fidelity` 先落地。
- 约束：表情总图裁剪依赖浏览器 canvas，工具 MUST 在渲染进程内执行，不能挪到服务端。
- 规格：`canvas-shots-workbench`、`asset-canvas-publishing`、`character-appearance`。
