# Spec Delta

## Purpose

让 3D 调度聊天以结构化消息和工具卡片展示 agent 的执行过程，而不是只渲染一段最终文本；用户能直接看到代码试运行、关键帧和验收结果。

## ADDED Requirements

### Requirement: 聊天使用结构化消息而不是纯文本拼接

聊天 UI SHALL 把助手消息渲染为结构化 parts，至少支持文本、工具调用、工具结果、代码摘要、关键帧和验收清单；MUST NOT 只把工具日志拼进一段 Markdown 文本。

#### Scenario: 文本消息

- **WHEN** 助手返回解释
- **THEN** 以正常消息文本渲染，支持 Markdown

#### Scenario: 工具消息

- **WHEN** agent 调用工具
- **THEN** 该工具以独立卡片或 part 出现在消息流中

#### Scenario: 混合内容

- **WHEN** 一次回答包含文本、工具、帧和清单
- **THEN** 按执行顺序分别渲染，不混成一段纯文本

### Requirement: 工具调用必须显示状态和结果

每个工具调用 SHALL 显示工具名称、参数摘要、running/done/error 状态和结果摘要；工具结果 MUST 通过调用 id 匹配到对应调用，MUST NOT 产生重复的孤立结果消息。

#### Scenario: 工具运行中

- **WHEN** `run_sandbox` 正在执行
- **THEN** 卡片显示运行中，聊天仍可滚动和取消

#### Scenario: 工具成功

- **WHEN** 工具返回成功
- **THEN** 同一卡片更新为完成并显示结果摘要

#### Scenario: 工具失败

- **WHEN** 工具返回错误
- **THEN** 卡片显示失败原因和错误状态

### Requirement: 代码只显示摘要并关联代码页签

聊天中的代码步骤 MUST 只显示代码哈希、行数和简短摘要；完整代码 MUST 显示在代码页签，不得把大段源码塞满聊天。只有沙箱试运行成功的代码才能成为可查看草稿。

#### Scenario: 提交代码

- **WHEN** agent 提交一段代码
- **THEN** 聊天显示代码摘要和“查看代码”入口

#### Scenario: 代码未通过

- **WHEN** 代码沙箱失败
- **THEN** 聊天显示错误摘要，不把失败代码设为当前草稿

#### Scenario: 查看代码

- **WHEN** 用户点击代码摘要
- **THEN** 代码页签显示对应完整代码

### Requirement: 关键帧必须以缩略图组展示

`capture_frames` 的结果 SHALL 以缩略图组展示，至少包含时间点或帧序号；点击缩略图 MUST 能查看较大帧，MUST NOT 只显示图片 URL。

#### Scenario: 抓帧成功

- **WHEN** agent 抓取 0/1/2/3/4 秒帧
- **THEN** 聊天显示带时间标签的缩略图组

#### Scenario: 帧缺失

- **WHEN** 某一帧抓取失败
- **THEN** 该位置显示缺失状态，其他帧仍显示

#### Scenario: 查看大图

- **WHEN** 用户点击关键帧缩略图
- **THEN** 显示较大的帧预览

### Requirement: 验收清单必须以可读状态展示

`review_frames` 的结果 SHALL 以通过/失败清单展示每一项，失败项 MUST 显示缺失原因；MUST NOT 只显示“通过/失败”一个布尔值。

#### Scenario: 全部通过

- **WHEN** 山体、两人、双剑、对打和环绕都通过
- **THEN** 清单显示所有通过项和总结

#### Scenario: 部分失败

- **WHEN** 缺少剑或一名人物不可见
- **THEN** 对应项显示失败和原因，其他项保留状态

#### Scenario: 无视觉模型

- **WHEN** 自动验收不可用
- **THEN** 清单显示“需人工检查”，不伪装为通过

### Requirement: 执行轨迹需要连续更新并可取消

聊天 SHALL 随工具执行逐步更新状态，MUST NOT 等整个 agent 结束后才一次性出现；用户 MUST 能取消正在运行的 agent，取消后 UI 进入已取消状态并保留已有轨迹。

#### Scenario: 步骤更新

- **WHEN** 第一个工具完成、第二个工具开始
- **THEN** 聊天立即显示两个步骤的不同状态

#### Scenario: 取消运行

- **WHEN** 用户点击取消
- **THEN** 正在运行的工具停止，后续步骤不出现，已有轨迹保留

#### Scenario: 取消后输入

- **WHEN** 已取消的 agent 结束
- **THEN** 输入框恢复可用，可发送新消息

### Requirement: 聊天不得展示隐藏推理

聊天 MUST NOT 渲染模型 chain-of-thought、内部系统提示或隐藏推理 token；只展示工具调用、参数摘要、工具结果、关键帧和清单。

#### Scenario: 模型推理

- **WHEN** 模型返回内部推理
- **THEN** 聊天不把它作为消息或工具卡片显示

#### Scenario: 工具参数

- **WHEN** 参数包含大段代码或图片
- **THEN** 只显示摘要或缩略图，不直接铺满消息流

### Requirement: 现有参考内容与输入框保持可用

聊天 SHALL 保留当前镜头的参考内容 chips、移除操作和输入框；发送消息前 MUST 使用当前选择，MUST NOT 因为换用聊天 UI 而静默加入未选素材。

#### Scenario: 已选 chips

- **WHEN** 用户打开聊天
- **THEN** 当前参考内容仍以 chips 显示并可移除

#### Scenario: 发送前移除

- **WHEN** 用户移除一个 chip 后发送
- **THEN** 本次 agent 上下文不包含该素材

#### Scenario: 输入框

- **WHEN** agent 未运行
- **THEN** 用户可输入并发送，支持键盘快捷键

### Requirement: 主题、窄屏和可访问性必须保持

聊天 UI MUST 使用现有日间/夜间主题 token，MUST NOT 引入与工作台冲突的独立默认主题；窄屏下工具卡片、缩略图和清单 MUST 不横向溢出；按钮、工具状态和缩略图 MUST 有可访问名称。

#### Scenario: 日间主题

- **WHEN** 切换到日间模式
- **THEN** 聊天卡片、输入框和工具状态可读

#### Scenario: 窄屏

- **WHEN** 工作台宽度 900px 或更窄
- **THEN** 聊天内容不横向溢出，工具卡片可堆叠

#### Scenario: 键盘

- **WHEN** 用户只用键盘操作
- **THEN** 输入框、发送、取消和工具卡片可聚焦，焦点可见

### Requirement: 失败和取消状态必须保留可恢复信息

聊天 SHALL 显示 agent 失败阶段、错误摘要和是否保留旧代码；失败后 MUST 允许用户修改 prompt 或重试，MUST NOT 清空已有轨迹和旧代码。

#### Scenario: 达到修复上限

- **WHEN** agent 多次修复仍失败
- **THEN** 聊天气泡显示失败阶段和重试入口，旧代码不变

#### Scenario: 工具超时

- **WHEN** 沙箱或模型超时
- **THEN** 显示超时步骤，用户可重试或改 prompt

#### Scenario: 保存失败

- **WHEN** 用户确认保存但项目写入失败
- **THEN** 聊天/代码页签保留草稿并显示保存错误

### Requirement: 验收测试必须覆盖聊天轨迹渲染

UI 验收 SHALL 覆盖 assistant 文本、工具调用状态、代码摘要、关键帧缩略图和验收清单；mock agent 测试 MUST 验证这些 parts 的出现顺序和状态更新，真实模型验收 MUST 人工确认关键帧/视频。

#### Scenario: mock 轨迹

- **WHEN** 运行 mock agent 验收
- **THEN** 页面出现上下文、代码、沙箱、抓帧、验收和结束步骤

#### Scenario: 真实模型轨迹

- **WHEN** 使用真实模型运行山/男女/双剑/环绕场景
- **THEN** 工具轨迹和最终帧/视频可人工检查

#### Scenario: 取消

- **WHEN** 在 mock 运行中点击取消
- **THEN** 取消状态可见，后续步骤不出现
