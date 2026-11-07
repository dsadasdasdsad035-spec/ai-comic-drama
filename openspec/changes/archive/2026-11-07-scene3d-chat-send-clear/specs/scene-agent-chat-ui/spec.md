# Spec Delta

## ADDED Requirements

### Requirement: 3D 技能不可用须可观察且不得静默锁死输入

3D 调度聊天在宿主技能 `scene3d` 无法加载时 MUST 向用户展示可读原因（例如技能校验失败、服务不可用），MUST NOT 在无提示的情况下将输入区无限期禁用。技能恢复可用后，新一轮发送 MUST 能正常启动 agent。

#### Scenario: 技能白名单失败

- **WHEN** 内置 scene3d 技能因声明未知工具等原因加载失败
- **THEN** 聊天区显示错误说明，用户能看到修复方向，输入可编辑或在发送时收到明确拦截说明

#### Scenario: 技能恢复

- **WHEN** 用户修正技能或刷新后 scene3d 成功加载
- **THEN** 显示技能来源与版本芯片，发送可启动 agent

### Requirement: 3D agent 聊天提供清空当前对话

3D 调度工作台 agent 聊天 SHALL 提供清空当前对话入口，行为与其他内容工作台清空一致：有消息须确认；清空 MUST 删除当前镜头的聊天持久化线程，MUST NOT 删除场景代码草稿、镜头参考选择或已保存调度视频。

#### Scenario: 清空保留 3D 产物

- **WHEN** 用户在 3D 工作台有多轮 agent 对话且镜头已有代码草稿，确认清空
- **THEN** 聊天消息为空，代码页签草稿与参考内容不变

#### Scenario: 运行中清空

- **WHEN** agent 正在运行，用户确认清空
- **THEN** 运行被取消，聊天为空，半截轨迹不写入持久化
