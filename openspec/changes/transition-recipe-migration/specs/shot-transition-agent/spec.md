# Spec Delta

## ADDED Requirements

### Requirement: 转场食谱收录可迁移字段

转场食谱索引 MUST 为每条卡提供可从当前提示词产线消费的字段：`whenToUse`（该用在哪类接缝）、`energy`（能量等级）、`durationHint`（建议秒数）、`principle`（视觉机制说明）、`pitfalls`（已知坑，可转为负向约束）、`seedanceHints`（可直接进提示词的完整句子）。字段 MUST 可选，缺失时消费方 MUST 降级到 `intent` 与 `taxonomy`，MUST NOT 因缺字段报错。

#### Scenario: 消费方读到完整卡

- **WHEN** Agent 读取一张已迁移的卡
- **THEN** 返回 `whenToUse`、`energy`、`principle`、`pitfalls` 与完整句子的 `seedanceHints`

#### Scenario: 未迁移卡仍可用

- **WHEN** Agent 读取一张只有 `intent` / `tags` / `taxonomy` 的旧卡
- **THEN** 返回成功，缺少的字段为空

### Requirement: 技法卡保留多式结构

本身不绑定单一接缝、内含多种做法的卡（如按能量落差选式的镜头交棒三式）MUST 建模为 `kind: technique` 并给出 `variants[]`，每个变体 MUST 含 `id`、`label`、`when`、`principle`。系统 MUST NOT 把多式技法卡压平成单条具体卡。

#### Scenario: 多式卡可逐式选型

- **WHEN** Agent 读取一张技法卡
- **THEN** 能看到全部变体及其各自的适用接缝与视觉原理

#### Scenario: 具体卡不需要变体

- **WHEN** 一张卡只描述单一手法
- **THEN** 其 `kind` 为 `concrete` 且 `variants` 为空

### Requirement: 禁止迁入实现参数

迁移上游食谱时 MUST NOT 收录与 Remotion 渲染绑定、对视频生成模型无意义的参数：帧数、缓动曲线、像素坐标与尺寸、弹簧 damping/stiffness、CSS 属性值。提示词素材 MUST 只描述观众可见的画面运动与变化。

#### Scenario: 迁移卡不含帧数

- **WHEN** 检查任一已迁移卡的 `principle`、`seedanceHints`、`pitfalls`
- **THEN** 不出现帧数、`bezier(...)`、`damping`、`stiffness` 或像素坐标

#### Scenario: 时长只保留秒

- **WHEN** 上游卡给出帧级时间轴
- **THEN** 迁移结果只保留总时长（秒）作为 `durationHint`

### Requirement: 提示词短句必须是可执行描述

`seedanceHints` 的每一条 MUST 是描述可见画面运动的完整句子，MUST NOT 是标签式词组。消费方写桥接正文时 MUST 优先使用这些句子，并把 `pitfalls` 转为负向约束、按 `energy` 选择运动质感措辞。

#### Scenario: 短句可直入正文

- **WHEN** Agent 用某张卡的 `seedanceHints` 写桥接提示词
- **THEN** 该句可直接作为正文中的一句画面描述，无需再扩写

#### Scenario: 坑转负向约束

- **WHEN** 某张卡的 `pitfalls` 提到「锚点必须是真圆」
- **THEN** Agent 写出的正文或负向约束中包含对应的禁止项
