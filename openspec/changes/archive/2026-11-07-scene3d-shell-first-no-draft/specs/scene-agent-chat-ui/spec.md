# Spec Delta

## ADDED Requirements

### Requirement: 默认 full_host 须在界面可感知

3D 调度聊天 SHALL 在用户未改过权限档时按 full_host 运行；设置页与 3D 聊天区 MUST 提供简短风险提示（job 沙箱内 shell/写文件）。用户切换到 restricted MUST 后生效于下一轮运行。

#### Scenario: 首次打开 3D 工作台

- **WHEN** 项目使用默认 agent 宿主设置
- **THEN** 聊天侧栏可见 host 相关能力说明或协议标签，且工具协议与 full_host 一致

#### Scenario: 切到 restricted

- **WHEN** 用户在设置保存 restricted
- **THEN** 下一轮 3D agent 不展示 adopt/shell 依赖的工作流提示为默认路径

## MODIFIED Requirements

### Requirement: 工具调用必须显示状态和结果

每个工具调用 SHALL 显示工具名称、参数摘要、running/done/error 状态和结果摘要；工具结果 MUST 通过调用 id 匹配到对应调用，MUST NOT 产生重复的孤立结果消息。3D agent MUST NOT 再为 `begin_scene_draft` 等六个 scene-draft 工具注册专用 UI 卡片。

#### Scenario: 工具运行中

- **WHEN** `run_render` 正在执行
- **THEN** 卡片显示运行中，聊天仍可滚动和取消

#### Scenario: 工具成功

- **WHEN** 工具返回成功
- **THEN** 同一卡片更新为完成并显示结果摘要

#### Scenario: 工具失败

- **WHEN** 工具返回错误
- **THEN** 卡片显示失败原因和错误状态

#### Scenario: adopt 卡片

- **WHEN** agent 调用 adopt_scene_from_job
- **THEN** 聊天显示采纳路径与准入结果摘要，不展示整份源码
