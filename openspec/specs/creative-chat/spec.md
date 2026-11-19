# creative-chat Specification

## Purpose

定义创意工作室对话层的模型选择与绑定：对话主循环由宿主运行时驱动，模型由宿主设置解析并以设置页「创意（对话助手）」为回退；专家与无专家两种形态通过宿主 preset 表达。

## Requirements

### Requirement: 设置页提供创意环节默认

系统 SHALL 在设置页「生成环节默认」中保留「创意（对话助手）」一行，绑定 `stageModels.creative`。该值 MUST 作为创意会话的模型回退：宿主侧未保存显式选择时使用它；它本身为空时 MUST 回退到「文本 · 常规」默认。界面 MUST 说明该值是回退而非唯一来源。

#### Scenario: 配置创意默认

- **WHEN** 用户在设置页为创意环节选择某文本模型并保存，且宿主侧未保存显式选择
- **THEN** 创意会话使用该模型

#### Scenario: 创意默认留空

- **WHEN** 用户未设置创意环节默认
- **THEN** 创意会话回退到「文本 · 常规」默认

### Requirement: 创意会话专家与自动技能目录双模式

创意工作室 SHALL 通过宿主侧 preset 选择承担原来的专家与无专家双模式：选择某个专家 preset 时，运行时的 system、技能根与工具子集 MUST 由该 preset 决定；未选择专家时 MUST 使用默认 preset，该 preset MUST 允许自动发现技能根内全部技能并提供技能列举能力。两种模式 MUST 互斥，切换后下一轮生效。

#### Scenario: 无专家等同原自动模式

- **WHEN** 用户未选择专家 preset
- **THEN** 运行时使用默认 preset，技能根内技能可被发现与读取

#### Scenario: 有专家覆盖自主壳

- **WHEN** 用户选择某个专家 preset
- **THEN** system 与工具子集来自该 preset，不再拼接默认模式的通用说明

#### Scenario: 切回默认模式

- **WHEN** 用户从某专家 preset 切回不选专家
- **THEN** 下一轮恢复默认 preset 的技能发现与工具集

### Requirement: 创意会话模型由宿主设置解析

创意会话的文本模型 SHALL 在宿主设置中选择并持久化，发送下一轮对话前更换 MUST 从下一轮生效。解析顺序 MUST 为宿主显式选择 > 设置页 `stageModels.creative` > 「文本 · 常规」默认。创意视图 MUST NOT 再提供独立的文本模型下拉。解析不到可用模型时 MUST 以可读错误提示去设置页绑定。

#### Scenario: 宿主内更换模型

- **WHEN** 操作员在宿主设置中选择另一文本模型并保存
- **THEN** 下一轮对话使用新模型，界面不再出现第二处模型选择入口

#### Scenario: 无可用模型

- **WHEN** 三层解析都得不到可用文本模型
- **THEN** 界面显示可读的未配置说明，发送入口保持禁用
