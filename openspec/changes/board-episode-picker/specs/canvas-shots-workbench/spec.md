# Spec Delta

## ADDED Requirements

### Requirement: 画布集目录先于单集工作台

当用户通过左栏导航进入 `board` 视图时，系统 SHALL 先展示**集目录屏**（分集卡片列表），MUST NOT 直接展示单集 React Flow 分镜画布。仅当用户在集目录上**选择某一集**后，系统 SHALL 进入该集的**单集画布**并设置当前集 `epNo`。

#### Scenario: 左栏进画布见目录

- **WHEN** 用户从左栏点击「画布」
- **THEN** 主内容区显示集目录屏，不显示分镜节点画布

#### Scenario: 选集后进 Flow

- **WHEN** 用户在集目录点击 `E02` 卡片
- **THEN** `epNo` 为 2，主内容区显示单集分镜画布，且只展示该集正式镜头

#### Scenario: 上次集不自动跳过目录

- **WHEN** 用户曾在 `E03` 单集画布工作，随后离开画布再从左栏进入 `board`
- **THEN** 仍先显示集目录屏，不因 `localStorage` 或上次 `epNo` 直接进入 `E03` Flow

### Requirement: 集目录卡片与封面

集目录 SHALL 以卡片网格列出项目的每一集。每卡 MUST 显示集号（`E{两位}`）、镜数、分集标题（若有）与目标时长（若有）。封面 MUST 取该集镜头中**按镜号排序的第一条**可用画面：优先 `keyframe`；若无则该集第一条有成片的视频可用首帧或 poster；再无则显示统一占位并标明无首帧。

#### Scenario: 有首帧的封面

- **WHEN** 某集按镜号排序的第一条镜头有 `keyframe`
- **THEN** 该集卡片封面使用该图

#### Scenario: 无首帧有视频

- **WHEN** 该集无 `keyframe` 但第一条有成片的镜头有 `clip`
- **THEN** 该集卡片封面使用可展示的成片首帧或等价静帧

#### Scenario: 空集仍出现

- **WHEN** `episodes` 声明了某集但无镜头
- **THEN** 集目录仍显示该集卡片，封面为占位，镜数为 0

### Requirement: 从单集画布返回集目录

单集画布 SHALL 提供明确的「返回集列表」操作。用户触发后 MUST 回到集目录屏并 MUST NOT 清空 `epNo`（仍可供概览、Agent 等读取），但主内容 MUST 不再显示 React Flow。

#### Scenario: 返回后不再显示 Flow

- **WHEN** 用户在 `E01` 单集画布点击返回集列表
- **THEN** 界面回到集目录，分镜节点画布不可见

### Requirement: 画布内操作仅作用于当前已选集

导入、Agent 写回、集级摘要、补齐锚点、增删镜等画布能力 MUST 仅在**单集画布**阶段可用，且 MUST 作用于进入该屏时选定的 `epNo`。集目录屏 MUST NOT 挂载分镜 Agent 聊天或导入落库到未选定的集。

#### Scenario: 目录屏无导入

- **WHEN** 用户处于集目录屏
- **THEN** 画布导入入口不可用或引导用户先选集

#### Scenario: 单集内导入

- **WHEN** 用户已在 `E02` 单集画布打开导入并确认
- **THEN** 写入项目的镜头归属集 2，并水合当前画布

## MODIFIED Requirements

### Requirement: 画布承载分镜 Agent

系统 SHALL 在**单集画布**提供分镜助手的聊天面板，使用 `shotlist` 与 `prompt` 技能，经 `submit_shots`、`submit_prompts` 与 `submit_joins` 写回当前项目当前集。写回后 MUST 与导入走同一套落库与水合规则。线程范围 MUST 仍按项目与集。集目录屏 MUST NOT 展示该聊天面板。

#### Scenario: 聊天拆镜

- **WHEN** 用户在单集画布聊天要求拆本集
- **THEN** 草稿写回项目，画布出现本集镜头与顺序连线

#### Scenario: 只刷提示词

- **WHEN** Agent 只提交提示词更新
- **THEN** 分镜结构与画布节点不变，只更新提示词列

#### Scenario: 切集不串线程

- **WHEN** 用户从单集画布返回集列表并进入另一集
- **THEN** 聊天上下文随新集切换，不向其他集写入

### Requirement: 画布提供集级摘要与目标时长

单集画布 SHALL 在视图上下文带或画布工具条显示**当前集**镜数、总时长与目标时长的对比，并提供目标时长编辑。目标时长 MUST 写入该集元数据。集目录屏 MAY 在卡片上显示镜数与目标时长摘要，但 MUST NOT 显示单集工作台那条完整摘要条，直至用户进入该集。

#### Scenario: 超时提示

- **WHEN** 本集总时长超过目标时长
- **THEN** 摘要显示超出的秒数

#### Scenario: 修改目标时长

- **WHEN** 用户在单集画布修改当前集目标时长
- **THEN** 新值写入该集并立即更新摘要，其他集不受影响
