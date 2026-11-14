# Spec Delta

## Purpose

画布分镜 Inspector 按生图/出片工位组织分页与区块顺序，使用户在生成前能看见就绪状态、附件槽位与主操作，并减少跨 Tab 查找。

## ADDED Requirements

### Requirement: 就绪条展示出片阻塞摘要

对 `prodKind === 'video'` 的镜头，当用户位于 `出片` Tab 时，Inspector MUST 在滚动区顶部显示只读就绪条，包含当前出片模式标签（如多参考图 / 参考视频 / 原生音频）以及 `buildShotVideoRequest` 返回的首条 blocking 或若无 blocking 则首条 warning。无底栏主按钮禁用原因时，就绪条 MUST 仍显示可出片状态。

#### Scenario: 缺参考图

- **WHEN** 出片镜无合格图片参考且用户打开出片 Tab
- **THEN** 就绪条显示阻塞文案，底栏生成视频按钮禁用

#### Scenario: 可出片

- **WHEN** 出片镜满足出片条件
- **THEN** 就绪条显示模式标签且无错误色阻塞文案

### Requirement: 工位徽章与过滤状态 chip

分镜 Inspector 头部 MUST 显示当前镜头工位徽章（生图镜 / 出片镜）。状态 chip MUST 仅展示与当前 `prodKind` 相关的项：生图镜 MUST NOT 展示「视频未出」类 chip；出片镜 MUST NOT 将「画面 OK」作为必现 chip（可有可选预览角标，但 MUST NOT 与出片就绪混淆）。

#### Scenario: 生图镜 chip

- **WHEN** 用户选中生图镜
- **THEN** 头部 chip 不含视频成片状态

#### Scenario: 出片镜 chip

- **WHEN** 用户选中出片镜
- **THEN** 头部 chip 可含参考、提示词、成片状态，不含生图专用「生成画面」引导

### Requirement: 出片 Tab 区块顺序

对出片镜，`出片` Tab 内区块 MUST 按下列顺序自上而下排列：就绪条、附件与槽位（与出片提示词面板一体或紧邻）、本次出片提示词正文区、运镜与语义（含运动提示词与镜头语言库）、出片设置（模型与分辨率等）。附件与槽位区在默认首次进入时 MUST 为展开状态。

#### Scenario: 默认看见附件

- **WHEN** 用户首次选中出片镜并位于出片 Tab
- **THEN** 附件与槽位列表无需额外点击即可见（有附件或显式空态）

### Requirement: 音画 Tab 聚合表演与音频

对出片镜，`音画` Tab MUST 包含台词与音效、角色表演、表情参考开关与原生音频配置。原生音频 MUST NOT 仅存在于已折叠的出片设置深处而无音画 Tab 入口。

#### Scenario: 原生音频入口

- **WHEN** 用户选中出片镜并切换到音画 Tab
- **THEN** 可见原生音频配置区块

### Requirement: 镜头类型在溢出菜单

切换 `prodKind`（生图镜 / 出片镜）的控件 MUST 位于 Inspector 头部溢出菜单（⋯）内，且 MUST 在用户确认互斥工位规则后可执行。该控件 MUST NOT 仅出现在元数据 Tab 底部。

#### Scenario: 从菜单切换工位

- **WHEN** 用户在溢出菜单选择切换镜头类型
- **THEN** 可见 Tab 集合随 `prodKind` 更新

### Requirement: 生图参考文案不含出片指令

生图镜 `画面` Tab 内参考汇总区的说明 MUST 描述 Seedream 多参考（角色/素材），MUST NOT 指引用户为视频出片连线作为该区块的主说明。

#### Scenario: 生图镜参考说明

- **WHEN** 用户选中生图镜并展开参考区
- **THEN** 文案不出现「视频出片只认连线」作为该区块标题级说明
