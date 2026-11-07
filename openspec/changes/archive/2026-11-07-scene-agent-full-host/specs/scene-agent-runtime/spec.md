# Spec Delta

## MODIFIED Requirements

### Requirement: agent 工具集受控且最小化

运行时 SHALL 按配置的权限档向 agent 暴露工具。**restricted** 档（默认）SHALL 只暴露现有受控工具：读取当前镜头上下文、草稿读写、提交场景代码、渲染试运行、抓取关键帧、视觉验收和结束。**full_host** 档 SHALL 在上述工具之外额外暴露服务端执行的 `run_bash`、`read_file`、`write_file`、`list_dir`；这些工具 MUST 在隔离的 agent job 目录内运行，MUST NOT 写入项目文件或跨镜头数据。不论档位，运行时 MUST NOT 向 agent 提供任意未注册工具名的动态执行、跨镜头修改、对项目 `project.json` 的直接写入，MUST NOT 提供专用的任意外网 HTTP 工具。入库可采纳的场景代码与调度试运行仍 MUST 只通过 `run_render` 与相关门禁工具完成，MUST NOT 因 shell 成功即视为可写入项目。

#### Scenario: 允许的上下文读取

- **WHEN** agent 调用上下文工具
- **THEN** 只返回当前镜头、参考内容和当前代码的摘要

#### Scenario: 禁止越权

- **WHEN** agent 在任一权限档尝试修改其他镜头、读写 job 目录外路径或通过未注册工具名执行动作
- **THEN** 调用被拒绝并返回可读错误

#### Scenario: 不自动保存

- **WHEN** agent 完成代码和验收
- **THEN** 代码只作为草稿，保存仍需用户操作

#### Scenario: 不绕过渲染协议

- **WHEN** agent 需要让场景代码进入可采纳草稿或完成本轮
- **THEN** 必须通过 `run_render`（及既有抓帧/验收/ finish 链），不能仅依赖 shell 输出声称成功

#### Scenario: restricted 默认档

- **WHEN** 用户未开启 full_host
- **THEN** agent 看不到 `run_bash` 等扩展工具，行为与升级前一致

#### Scenario: full_host 探索性 shell

- **WHEN** 用户开启 full_host 且 agent 调用 `run_bash`
- **THEN** 命令在服务端 job 目录执行并返回退出码与截断输出，且不自动写入项目或调度字段

## ADDED Requirements

### Requirement: agent 宿主命令经服务端作业执行

`run_bash` 与配套文件工具 MUST 由应用服务端执行，浏览器 MUST NOT 在本机直接 spawn 进程。每次调用 MUST 关联当前项目名与镜头 id 用于审计；MUST 支持超时与用户取消，取消时 MUST 终止子进程。文件路径 MUST 限制在当前 agent job 目录子树内。

#### Scenario: 成功执行

- **WHEN** agent 在 full_host 下调用 `run_bash` 且命令在时限内结束
- **THEN** 返回退出码与 stdout/stderr 摘要，并记录作业标识

#### Scenario: 超时与取消

- **WHEN** 命令超时或用户在工具执行中取消
- **THEN** 子进程被终止，返回可读错误，且不修改项目数据

#### Scenario: 路径逃逸拒绝

- **WHEN** `read_file` 或 `write_file` 请求解析到 job 目录之外的路径
- **THEN** 工具拒绝执行

### Requirement: 3D Agent 权限档可配置

系统 SHALL 在设置中提供 3D Agent 权限档选项 `restricted` 与 `full_host`，默认 MUST 为 `restricted`。切换档位后，新一轮 agent 运行 MUST 使用新档位注册的工具集；进行中的运行 MAY 沿用开始时档位。

#### Scenario: 默认 restricted

- **WHEN** 用户未修改设置
- **THEN** 3D 调度聊天不暴露 shell 类工具

#### Scenario: 开启 full_host

- **WHEN** 用户在设置中选择 full_host 并保存
- **THEN** 下次 3D agent 运行可调用扩展宿主工具，并显示风险提示
