# Spec Delta

## MODIFIED Requirements

### Requirement: 聊天由多步工具循环驱动

3D 聊天 SHALL 由有状态的多步循环驱动，至少支持读取镜头上下文、提交代码、渲染运行、抓取关键帧、视觉验收和结束；每一步 MUST 产生可观察的开始/结束状态，MUST NOT 只返回最终文本。该循环 MUST 与其他聊天共用同一运行时，MUST NOT 提供可切换的第二引擎或文本动作协议。

#### Scenario: 正常多步执行

- **WHEN** 用户要求生成一个新场景
- **THEN** 聊天按顺序产生上下文读取、代码提交、渲染运行、抓帧和验收步骤

#### Scenario: 工具失败

- **WHEN** 某一步工具失败
- **THEN** 该步骤显示失败原因，后续步骤不假装成功

#### Scenario: 最终回答

- **WHEN** 循环正常结束
- **THEN** 聊天给出最终摘要，并保留完整工具轨迹

#### Scenario: 没有第二引擎

- **WHEN** 用户查看 3D 聊天与相关设置
- **THEN** 看不到引擎切换项，也没有可切换的文本动作回退路径

### Requirement: mock 与真实模型验收必须分开

测试 SHALL 提供不消耗真实模型的 mock 运行器验收，以及使用真实模型和本机 Blender 的手动/半自动验收。mock 验收 MUST 用桩渲染服务覆盖工具事件、抓帧、清单和代码应用，MUST NOT 依赖本机 Blender；真实模型验收 MUST 生成山/男女/双剑/环绕场景并保存关键帧、视频和清单。

#### Scenario: mock 图测试

- **WHEN** 在 CI 运行 mock agent 测试
- **THEN** 不发起真实模型调用、不启动 Blender，验证完整工具链和 UI 事件

#### Scenario: 真实模型验收

- **WHEN** 使用配置的代码模型和本机 Blender 运行验收场景
- **THEN** 保存代码、关键帧、4 秒视频和验收结果供人工确认

#### Scenario: 缺少 Blender

- **WHEN** 本机没有受支持的 Blender
- **THEN** 真实验收明确跳过并说明原因，mock 验收仍正常运行

### Requirement: 运行事件必须区分步骤、文本与工具调用

运行时 SHALL 把一次运行拆成三组可区分的事件：步骤生命周期、面向用户的文本消息生命周期、工具调用生命周期。文本消息 MUST 有稳定标识并支持开始/增量/结束；工具调用 MUST 有稳定标识并支持开始/参数增量/结束/结果。事件 MUST 按发生顺序提供，reasoning 或 thinking 增量 MUST NOT 进入事件流。

#### Scenario: 一次模型调用

- **WHEN** 运行时执行一次模型轮次并产出说明文字
- **THEN** 事件依次包含步骤开始、文本消息开始、若干文本增量、文本消息结束、步骤结束

#### Scenario: 一次工具调用

- **WHEN** 模型返回一个工具调用
- **THEN** 事件包含工具调用开始、参数增量、参数结束与结果，且结果可通过同一标识匹配到调用

#### Scenario: 推理增量

- **WHEN** 渠道返回 reasoning 或 thinking 增量
- **THEN** 事件流中不出现这些内容
