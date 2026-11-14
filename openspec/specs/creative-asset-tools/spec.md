# creative-asset-tools Specification

## Purpose
让创意会话的 Pi agent 能盘点并钻取当前项目的全部物料：角色、场景、道具、素材卡（含视频与音频）以及项目级自定义白模，从而在不知道 id 的情况下也能正确引用项目已有内容。

## Requirements

### Requirement: 物料地图默认只返回分类计数

系统 SHALL 提供只读工具 `read_asset_inventory`，返回当前项目五个分类的条目计数：`characters`、`scenes`、`props`、`assets`、`whitebox`。`assets` 的计数 MUST 按素材 `kind` 细分。未选项目时 MUST 返回可读错误而不是空计数。

#### Scenario: 未要求明细时只回计数

- **WHEN** agent 调用 `read_asset_inventory` 且未设置 `includeRows`
- **THEN** 返回各分类计数与下一步提示，不返回任何条目明细

#### Scenario: 未选项目

- **WHEN** 顶栏未选项目时调用 `read_asset_inventory`
- **THEN** 返回 `ok: false` 并提示需要先选择项目

### Requirement: 物料地图可按分类列出轻量行

当 `read_asset_inventory` 收到 `category` 与 `includeRows: true` 时，系统 SHALL 返回该分类的轻量行。每行 MUST 包含 `category`、`key` 与可读标题；系统 MUST NOT 在该响应中包含白模代码正文、图片数据地址或视频数据地址。行数 MUST 受 `limit` 约束（默认 50，上限 200），被截断时 MUST 明确标记。

#### Scenario: 列出素材卡并细分类型

- **WHEN** agent 以 `category: "assets"`、`includeRows: true` 调用，且项目有 12 张视频素材卡
- **THEN** 返回的行中每一项都带 `key` 与视频标记，计数显示视频 12 张

#### Scenario: 按关键词与类型过滤

- **WHEN** agent 传入 `q` 与 `kind`
- **THEN** 只返回标题或类型匹配的条目

#### Scenario: 超过上限被截断

- **WHEN** 某分类条目数超过 `limit`
- **THEN** 响应标记截断，并返回该分类的总数

### Requirement: 单条记录按分类与 key 钻取

系统 SHALL 提供只读工具 `read_asset_detail`，按 `category` 与 `key` 返回单条完整记录。`key` MUST 原样取自 `read_asset_inventory` 返回的行，系统 MUST NOT 要求调用方自行拼接标识。key 不存在时 MUST 返回可读错误并说明可用分类。

#### Scenario: 取角色详情

- **WHEN** agent 用 inventory 返回的角色 `key` 调用 `read_asset_detail`
- **THEN** 返回该角色的完整记录，包括外观锚点与参考图路径

#### Scenario: key 不存在

- **WHEN** agent 传入一个不存在的 key
- **THEN** 返回 `ok: false` 且错误信息指明找不到该条目

### Requirement: 素材卡以 url 作为稳定键

由于 `project.assets` 的条目没有 id，系统 SHALL 以素材卡 `url` 作为其 `key`。同一 url 的素材卡 MUST 只出现一次。

#### Scenario: 素材卡 key 可用

- **WHEN** inventory 返回某素材卡行
- **THEN** 该行 `key` 等于素材卡的 `url`，并可直接用于 `read_asset_detail`

### Requirement: 白模代码必须显式请求并按上限截断

自定义白模的 `sceneCode.code` 是整段 Blender Python，系统 MUST 在 `read_asset_detail` 未传 `includeCode: true` 时省略代码正文，只返回标题、时长、运镜说明、是否有成片与代码指纹。传入 `includeCode: true` 时 MUST 返回代码，并在超过字符上限时截断且报告原始字符数。

#### Scenario: 默认不返回代码

- **WHEN** agent 以 `category: "whitebox"` 调用 `read_asset_detail` 且未设 `includeCode`
- **THEN** 响应不含代码正文，且包含代码指纹与是否有成片

#### Scenario: 显式请求代码

- **WHEN** agent 传入 `includeCode: true`
- **THEN** 响应包含代码正文；超长时代码被截断并报告原始字符数

### Requirement: 内置运镜库与项目白模分离

系统 SHALL 在物料地图中把内置运镜/镜头语法预置库只作为计数呈现，并提示改用 `list_camera_lexicon` / `get_camera_lexicon` 检索；`whitebox` 分类 MUST 只包含项目级自定义白模。

#### Scenario: 运镜预置库不计入 whitebox

- **WHEN** agent 调用 `read_asset_inventory`
- **THEN** 响应分别给出内置运镜库条数与项目白模条数，且 `whitebox` 明细只含项目白模

### Requirement: 既有细粒度读工具保持不变

系统 SHALL 保留 `read_characters`、`read_designs`、`list_camera_lexicon`、`get_camera_lexicon` 的现有行为与参数。新增工具 MUST NOT 改变它们的过滤语义或返回形状。

#### Scenario: 既有工具仍可批量过滤

- **WHEN** agent 调用 `read_designs` 并传入 `kind` 与 `names`
- **THEN** 行为与该能力引入前一致

### Requirement: 新工具纳入平台工具清单与专家白名单

系统 SHALL 把两个新工具列入平台内置工具名清单，使专家设置页、创意检查器与技能可声明工具集都能看到它们。默认专家工具集 MUST 包含这两个工具。

#### Scenario: 专家可选新工具

- **WHEN** 用户在专家设置页查看「读项目」分组
- **THEN** 分组中出现 `read_asset_inventory` 与 `read_asset_detail`

#### Scenario: 内置全能专家包含新工具

- **WHEN** 加载内置全能专家
- **THEN** 其工具白名单包含两个新工具

### Requirement: 创意会话提示先盘点再钻取

创意 Pi 的 system 提示 SHALL 指示：不确定项目里有何物料时，先调用 `read_asset_inventory` 取得 key，再按需 `read_asset_detail`。该提示 MUST 同时适用于自主发现模式与专家模式。

#### Scenario: 自主模式提示包含盘点指引

- **WHEN** 创意会话以无专家模式构造 system
- **THEN** system 中出现先盘点后钻取的调用指引

#### Scenario: 专家模式同样适用

- **WHEN** 创意会话以专家模式运行且该专家启用了新工具
- **THEN** 上下文说明同样指向先用盘点工具

### Requirement: 范围外数据不得混入

系统 MUST NOT 在 `assets` 分类中返回磁盘媒体目录或分镜成片；MUST NOT 改变 `read_shots` 的返回形状与截断策略。

#### Scenario: 素材分类不含分镜成片

- **WHEN** agent 列出 `assets` 分类
- **THEN** 结果只含 `project.assets` 条目，不含 `shot.clip` 或磁盘 `videos` 目录
