# Design

## Context

角色链路已经有一套可复用的模式：

```
CharacterBoard --(文本模型)--> project.characters --(图像模型)--> 三视图
       |                              |
       +-- 上画布（虚拟 char-* 节点）--+-- 镜头 refIds / cast 边
```

素材目前只有画布上的手工卡：

```
"+ 素材" --> asset 节点(title/kind/url, 画布 localStorage)
                  |
                  +-- 整表回写 --> project.assets(kind/title/url/note/tags)
```

`ProjectAsset` 虽然有 `note/tags`，但画布同步只映射 `kind/title/url`，实际会丢掉这两个字段；更关键的是回写采用**整表替换**，任何一张没上画布的素材都会被下一次同步删除。因此新板的“设定卡”不能直接存进 `assets`，否则用户拆完还没发布就会被画布同步清掉。

设置页已经有 `Stage`（script/character/shot/prompt）和四个可编辑规则包，`normalizeRules` 会把新默认合并进旧设置；这给“素材守则默认配置”提供了现成机制。

## Goals / Non-Goals

**Goals:**

- 场景/道具设定卡成为项目级一等数据，和角色一样“先设定、后发布”。
- 素材规则包默认启用且可在设置页改写；素材拆解有独立模型环节。
- 本集/全剧拆解按地点、道具名去重，关联镜号可追溯，重复拆解不覆盖手改。
- 场景空镜、道具多角度参考图有固定的生成约束，避免参考图污染镜头。
- 单卡/批量发布幂等，发布后的卡继续走现有素材参考链路。
- 项目切换、刷新、删除后重发都不产生重复卡或串项目数据。

**Non-Goals:**

- 不做布局图、场景平面图或单镜构图；单镜构图继续由现有 3D 调度负责。
- 不做自动把设定卡连到镜头；连线仍由用户在画布上建立。
- 不做场景/道具的视频生成或批量出图。
- 不重构现有 `assets` 的 note/tags 丢失问题；本次只保证发布卡需要的 `designId` 不丢。
- 不新增 `layout` 素材类型，`AssetKind` 仍是 scene / prop / image / video。

## Decisions

### 1. `designs` 独立一层，`assets` 只存已发布卡

新增项目级 `DesignSheet`：

```ts
type DesignKind = 'scene' | 'prop'

type DesignSheet = {
  id: string                 // 稳定 UUID，发布幂等靠它
  kind: DesignKind
  name: string
  refs: string[]             // E01-S03 / E01-S14
  summaryCn: string
  promptEn: string           // 生图锚点，跨镜头逐字复用
  keywords: string[]
  image?: string             // 当前图
  candidates?: string[]      // 2 张候选
  activeIdx?: number
}
```

`project.designs` 是新数组；`project.assets` 仍是“已发布/手工素材库”。发布时把 design 的当前图写成 asset 卡，并带上 `designId`。设定卡可以独立存在，不会因为还没上画布被 `assets` 的整表同步删除。

**理由**：这条边界和角色一致——角色设定在 `characters`，画布 char 节点只是视图；场景/道具设定在 `designs`，画布 asset 卡只是已发布的视图。两种数据生命周期不同：设定可以反复改、重新生成；发布卡是镜头实际引用的图片。

**替代方案**：扩 `assets` 增加 prompt/candidates/refs，并把画布同步改成按 id 合并。长期看是单一真相源，但本次要同时改同步语义、DB 列和已有卡迁移，风险明显更大；放弃。

**替代方案**：把结构化字段塞进 `assets.note` JSON。无需改表，但类型不可见、画布同步仍会丢，且后续查询/迁移困难；放弃。

### 2. 设置页新增 `asset` 环节与 `ASSET_RULES`

`Stage` 增加 `'asset'`，`STAGES` 增加一项；设置页“生成环节默认模型”增加“素材（拆场景/道具）”。未绑定 `stageModels.asset` 时沿用 `defaults.text`，不新增 Cap，也不改模型表结构。

`knowledge.ts` 增加 `ASSET_RULES`，`DEFAULT_RULES` 增加 `asset` 且默认启用：

- 场景按地点去重，refs 记录所有镜号；
- 场景图必须是空镜，不出现主要角色；
- 场景锚点写清地点、时间、天气/光源、环境特征，禁止“氛围感/高级感”；
- 只拆剧情关键道具，背景物不单列；
- 道具图用多角度参考表，中性背景、无手、无人物、材质与比例一致；
- 英文锚点定稿后逐字复用，画风锁与全片一致。

`prompts.ts` 增加 `ASSET_BASE`（固定 JSON 输出契约）和 `assetSys(rules)`（`withRule(ASSET_BASE, rules.asset)`）。设置页的 `RULE_META` 增加“素材守则”，来源标注 `script-to-manga / workrally / character-design-sheet`。

**理由**：素材拆解的输入、输出和约束与拆角色不同；复用 `character` 环节会让模型选择和规则包绑死。新增 Stage 是现有 `stageModels` 机制的自然扩展，旧设置自动回退文本默认。

**替代方案**：复用 `character` 环节。少一个设置项，但用户无法单独为素材选模型/改规则；放弃。

### 3. 拆解输入与合并

本集拆解：

- 当前集的项目场次（`episodes[].scenes`）；
- 当前集**全部**项目镜头摘要，不只 `cast` 或台词非空的镜头。现有 `digestShots` 会过滤无 cast/无台词的镜头，不能直接复用；新增一个 `digestAllShots` 或在现有函数上加选项，保持拆角色行为不变。

全剧拆解：

- `source` + 全部分集场次 + 全部镜头摘要；三者都为空时明确报错，不请求模型。

模型输出契约：

```json
{
  "scenes": [
    { "name": "地下井道", "refs": ["E01-S13", "E01-S14"],
      "summary_cn": "...", "prompt_en": "...", "keywords": ["..."] }
  ],
  "props": [
    { "name": "机械义体手臂", "refs": ["E01-S03", "E01-S14"],
      "summary_cn": "...", "prompt_en": "...", "keywords": ["..."] }
  ]
}
```

合并按 `kind + 规范化名称`（trim、压缩空白；中文按原文，英文按小写）匹配：

- 已有卡：`refs` 取并集；只补空字段；已有非空 `promptEn`、`image`、`candidates` 不动。
- 新卡：追加，`id` 用 `crypto.randomUUID()`。
- 本次没返回的旧卡：保留，不删除。

**理由**：和 `mergeCharacters` 的“保护手改”一致；用户改过的锚点/图不能被下一次拆解冲掉。`refs` 是后续人工连线的线索，不在本次自动建边。

**替代方案**：每次拆解全量替换。简单，但会丢手改和已生成图；放弃。

### 4. 两段式生成：先设定，再按卡出图

场景卡：

```
promptEn + SCENE_PLATE_SUFFIX + 项目画风
SCENE_PLATE_SUFFIX = "empty scene plate, no people, no main characters,
establishing wide shot, clean architecture and environment, 16:9"
```

道具卡：

```
promptEn + PROP_SHEET_SUFFIX
PROP_SHEET_SUFFIX = "prop turnaround sheet, front view, side view,
three-quarter view, isolated on neutral grey seamless background,
no hands, no characters, consistent material and scale, 1:1"
```

- 复用 `generateImage`，场景 `ratio='16:9'`，道具 `ratio='1:1'`，默认 `n=2`，`cap='image'`。
- 素材页只放一个“设定图模型”下拉（`image` 能力默认），不新增 Cap；角色三视图仍走 `view`。
- 场景/道具生图都不传角色参考图，避免角色长相或姿势被带进空镜/道具表。
- 项目 `style` 非空时作为画风锁追加；同一段文本在所有卡上复用。
- 生成结果写回 `image`、`candidates`、`activeIdx=0`；切换候选只改 `activeIdx` 和 `image`。
- 失败/无模型/锚点为空时卡上显示错误，不自动换模型或使用其他卡的图。

**理由**：场景图是“可复用的空间”，道具图是“可复用的物件”；两者都不该绑定某一镜的人物。把空镜/隔离写成固定后缀，比依赖模型自由发挥稳定。

**替代方案**：让 Seedream 直接画带人物的场景定调图。视觉更完整，但连到所有镜头会把人物带进每一帧；放弃作为默认，用户仍可手改锚点自行加人。

### 5. 发布：单卡 + 批量，不做常驻开关

App 维护：

- `onCanvasDesignIds`：从画布 asset 节点的 `designId` 派生。
- `pushDesigns(designs: DesignSheet[])`：过滤有 `image` 的卡；按 `designId` 查找已有 asset 节点。
  - 已存在：更新 `title/kind/url`，保留位置和其他 data。
  - 不存在：新增 `asset-${uid()}` 节点，`kind` 为 scene/prop，`url` 为当前图，`data.designId` 为设定 id。
  - 新卡默认放在画布上方的一条素材带（例如 `x=80 + (i%4)*260, y=-560 - floor(i/4)*180`），避开分镜栅格和角色卡；发布后 `fitView`。
- 单卡按钮和顶部“全部加入画布”都调用同一函数；批量返回新增/更新/跳过数量。
- 不做“素材上画布”常驻开关：asset 节点是真实节点，常驻开关会带来重复卡和“关闭是否删除”的歧义。角色是虚拟节点，所以适合开关；素材不适合。

**理由**：发布是一次明确的“把设定变成可引用素材”的动作，幂等 upsert 比开关更可控。删除画布卡不删除设定，用户可以从素材页重新发布。

**替代方案**：把设定卡渲染成虚拟 asset 节点（像 char-*）。不用复制数据，但现有 `collectRefImgs`、Inspector、连线都按真实 asset 节点工作，改造成本高；放弃。

### 6. 持久化与 API

新增 SQLite 表 `designs`（项目级）：

```sql
CREATE TABLE IF NOT EXISTS designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  design_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  refs TEXT DEFAULT '[]',
  summary_cn TEXT DEFAULT '',
  prompt_en TEXT DEFAULT '',
  keywords TEXT DEFAULT '[]',
  image TEXT DEFAULT '',
  candidates TEXT DEFAULT '[]',
  active_idx INTEGER,
  sort INTEGER DEFAULT 0,
  UNIQUE(project_id, design_id)
);
```

- `readProject` 返回 `designs`；`writeProject` 对 `designs` 做整体替换（用户编辑结果，不是 LLM 增量），与 characters 同语义。
- `/api/project` POST 接受 `designs`；错误消息补上该字段。
- `assets` 表通过 `ensureColumns` 增加 `design_id TEXT DEFAULT ''`；`ProjectAsset` 增加 `designId?`，读写包含它。
- 画布 asset 节点 `data.designId` 同步进 `project.assets`；项目加载时从 `assets` 恢复。
- `ProjectData` 增加 `designs?: DesignSheet[]`。
- 旧库无需回填：新表为空；旧 assets 的 designId 为空，按手工素材继续工作。

**理由**：`designs` 和 `characters` 都是“设定真相”，用整表替换符合当前项目写入语义；`assets` 仍是发布/手工素材库，只加一个关联字段。

**替代方案**：把 designs 存在 settings 或 localStorage。跨项目/跨设备不可靠，且画布删除会丢设定；放弃。

### 7. 素材页与路由

- `view` 增加 `'assets'`；顶栏在“角色”后增加“素材”。
- `AssetBoard` 内部两个页签：场景 / 道具；顶部“从本集拆”“从全剧拆”“全部加入画布”，以及素材环节模型、设定图模型。
- 素材页也显示集栏（`EpisodeBar`），因为“从本集拆”依赖当前集。
- 卡片显示：缩略图/候选点、名称、refs、中文摘要、英文锚点可编辑、关键词、生成/加入画布按钮。
- 空状态：没有项目、没有素材、没有图时分别给明确提示。
- `AssetBoard` 自己 `getProject(projectName)` 加载 designs/episodes/shots/style；用本地 epoch 丢弃切项目后的旧响应；编辑防抖保存 `patchProject({designs})`，避免首屏回写。
- 顶栏右侧在素材页显示“场景 / 道具”，不强行汇总数量，避免 App 再维护一份 designs 状态。

**理由**：素材页和角色页一样是“设定工作台”，不适合塞进画布 Inspector；单独页签能让拆解/生成/发布形成完整流程。

### 8. 失败与空状态

- 没有项目：拆解、生成、发布都提示先选项目。
- 本集/全剧没有可用素材：明确提示，不发模型请求。
- 模型没返回场景/道具：提示“模型没给出素材”，不修改现有 designs。
- 没有英文锚点：禁用生成并提示先补锚点。
- 没有当前图：禁用“加入画布”，不创建空素材卡。
- 项目切换时旧请求返回：按 epoch 丢弃，不写入新项目。

## Risks / Trade-offs

- **`designs` 与 `assets` 两份数据** → 通过 `designId` 关联，发布卡是快照；设定图重新生成后需要再次发布/更新。界面上明确“已在画布/更新”，避免用户误以为自动同步。
- **`designId` 在刷新后丢失导致重复卡** → 给 `ProjectAsset`/`assets` 表补 `designId`，加载时恢复；验证脚本覆盖刷新和切项目。
- **场景拆解把同一地点拆成多个名字** → 提示词要求 canonical 名称；合并按规范化名称；仍重复时允许用户手动删卡。不要为了自动合并而合并不同地点。
- **空镜场景图过于空旷** → 这是可复用参考图的取舍；用户可改锚点加环境细节，但不默认加人物。若某镜必须带人物，由角色卡和镜头提示词负责。
- **道具多角度图在 1:1 下细节不足** → 默认 2 张候选，用户可选；后续可加 4:3 或 2K 选项，不改数据模型。
- **批量发布位置重叠** → 新卡放在独立素材带并 `fitView`；已有卡保留原位置。用户仍可拖动。
- **数据库加法迁移** → 新表 `CREATE TABLE IF NOT EXISTS`、assets 仅补列；不改旧数据。部署前可备份 `storyboard.sqlite`，回滚代码后新增表/列不影响旧逻辑。

## Migration Plan

1. 先落数据层：新增 `designs` 表、assets 的 `design_id` 列、`ProjectData`/API 字段；旧项目读取时 designs 为空，assets 的 designId 为空。
2. 再落设置：`asset` Stage、`ASSET_RULES`、Settings 两个入口；`normalizeRules` 自动为旧设置补默认，不需要写迁移脚本。
3. 落素材页和拆解/生成；此时 designs 为空，现有画布/素材不受影响。
4. 落发布：只对用户主动发布的卡创建/更新 asset 节点；未发布设定不进入 assets。
5. 回滚：回退代码后，新增的 designs 表和 design_id 列保留但不再使用；现有 assets/画布仍可读。designs 数据不会自动删除，便于再次升级。
