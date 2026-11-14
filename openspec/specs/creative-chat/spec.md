# creative-chat Specification

## Purpose
定义创意工作室对话层的模型选择与绑定：对话主循环使用文本环节 `creative`，与能力托盘中的媒体能力绑定分离，行为与项目内其它工作台聊天一致。

## Requirements

### Requirement: 创意对话文本模型可在页面手选

系统 SHALL 在创意视图头部上下文区域提供文本模型下拉，对应环节 `creative`。手选 MUST 写入与其它工作台共用的本机环节手选存储；解析顺序 MUST 为手选 > 设置页 `stageModels.creative` > 「文本 · 常规」默认 > 文本族首条可运行模型。发送下一轮对话前更换模型 MUST 从下一轮生效；头部 MUST 显示当前解析结果，无可用模型时 MUST 以可读错误态提示去设置页绑定。

#### Scenario: 手选模型

- **WHEN** 用户在创意头部从下拉选择某一文本模型
- **THEN** 本机手选记录更新，下一轮对话请求使用该模型键

#### Scenario: 跟随环节默认

- **WHEN** 用户将下拉选回「默认」且设置页已绑定创意环节默认
- **THEN** 对话使用设置页 `stageModels.creative` 解析出的模型

#### Scenario: 无文本模型

- **WHEN** 模型表中没有可运行的文本族模型
- **THEN** 下拉不可用，头部标明未配置文本模型，发送入口保持禁用

### Requirement: 设置页提供创意环节默认

系统 SHALL 在设置页「生成环节默认」中提供「创意（对话助手）」一行，绑定 `stageModels.creative`。未选择时 MUST 在界面上说明跟随「文本 · 常规」默认；选择后 MUST 作为创意对话的环节默认（手选为空时）。

#### Scenario: 配置创意默认

- **WHEN** 用户在设置页为创意环节选择某文本模型并保存
- **THEN** 创意对话在手选为空时使用该模型

#### Scenario: 创意默认留空

- **WHEN** 用户未设置创意环节默认
- **THEN** 创意对话解析与发布等其它文本环节一样回退到「文本 · 常规」默认

### Requirement: 能力托盘不改变对话文本模型

创意能力托盘 SHALL 只绑定视觉、图像、视频、配音等媒体能力；更换托盘中的模型 MUST NOT 改变对话主循环的文本模型，对话文本模型 MUST 只通过头部下拉、创意环节默认或文本默认解析。

#### Scenario: 托盘换生图模型

- **WHEN** 用户在能力托盘更换图像模型
- **THEN** 头部显示的对话文本模型不变，仅生图工具使用新模型

### Requirement: 创意会话专家与自动技能目录双模式

创意工作室 SHALL 支持两种互斥的 Pi 约束模式：（1）**无专家**：默认自主发现技能，可选用顶栏「偏好」Agent 包，并可使用 `list_installed_skills`；（2）**有专家**：按 `creative-experts` 能力约束 system、技能与工具。用户 MUST 可通过顶栏专家下拉切回「无（技能目录）」恢复（1）。

#### Scenario: 无专家等同原自动模式

- **WHEN** 专家下拉为「无」
- **THEN** 使用 `buildCreativePiSystem` 与偏好技能逻辑，与未引入专家前行为一致

#### Scenario: 有专家覆盖自主壳

- **WHEN** 用户选择内置或自定义专家
- **THEN** 创意对话 MUST NOT 使用 `buildCreativePiSystemAutonomous` 拼接段落作为 system
