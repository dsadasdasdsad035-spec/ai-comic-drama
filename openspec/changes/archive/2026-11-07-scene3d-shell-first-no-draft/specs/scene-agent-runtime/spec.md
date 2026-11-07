# Spec Delta

## MODIFIED Requirements

### Requirement: agent 工具集受控且最小化

运行时 SHALL 按配置的权限档向 agent 暴露工具。**full_host** 为默认档：SHALL 暴露上下文读取、job 沙箱内 `run_bash`/`read_file`/`write_file`/`list_dir`、**`adopt_scene_from_job`**、渲染试运行、抓帧、视觉验收与结束；MAY 保留 `set_scene_code` 作短代码捷径。**restricted** 档 SHALL 不暴露 shell 与 adopt，SHALL 保留 `set_scene_code` 提交代码。两档 MUST NOT 向模型暴露 `begin_scene_draft`、`append_scene_draft`、`read_scene_draft`、`patch_scene_draft`、`commit_scene_draft`、`discard_scene_draft`。不论档位，运行时 MUST NOT 提供任意未注册工具名的动态执行、跨镜头修改、对项目 `project.json` 的直接写入，MUST NOT 提供专用的任意外网 HTTP 工具。可采纳的场景代码与调度试运行仍 MUST 只通过 `run_render` 与相关门禁工具完成，MUST NOT 因 shell 或 adopt 成功 alone 视为已写入项目。

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

- **WHEN** 用户在设置中选择 restricted
- **THEN** agent 无 shell、无 adopt，可通过 `set_scene_code` 提交代码，且看不到 scene-draft 分片工具

#### Scenario: full_host 探索性 shell

- **WHEN** 用户使用默认或 full_host 且 agent 在 job 内 `run_bash` 或 `write_file`
- **THEN** 命令与写在服务端 job 目录完成，且不自动写入项目或调度字段

#### Scenario: 无 scene-draft 工具

- **WHEN** 模型查看可用工具列表
- **THEN** 不出现六个 scene-draft 分片工具名

### Requirement: 3D Agent 权限档可配置

系统 SHALL 在设置中提供 3D Agent 权限档选项 `restricted` 与 `full_host`，默认 MUST 为 `full_host`。切换档位后，新一轮 agent 运行 MUST 使用新档位注册的工具集；进行中的运行 MAY 沿用开始时档位。

#### Scenario: 默认 restricted

- **WHEN** 用户显式选择 restricted 且未改回默认
- **THEN** 3D 调度聊天不暴露 shell 与 adopt 工具

#### Scenario: 开启 full_host

- **WHEN** 用户使用出厂默认 full_host 或在设置中选择 full_host 并保存
- **THEN** 下次 3D agent 运行可调用宿主与 adopt 工具，并显示风险提示

## ADDED Requirements

### Requirement: 从 agent job 采纳场景代码

`adopt_scene_from_job` MUST 仅读取当前 agent job 目录内的相对路径文件，MUST 经静态准入后设为当前会话代码，MUST NOT 写入项目 `sceneCode` 或调度字段，MUST NOT 替代 `run_render`。路径逃逸 MUST 被拒绝。

#### Scenario: 采纳成功

- **WHEN** agent 在 full_host 下调用 adopt 且文件通过准入
- **THEN** 会话持有代码哈希与行数摘要，工作台代码尚未自动覆盖

#### Scenario: 采纳后试运行

- **WHEN** adopt 成功后调用 run_render 且渲染通过
- **THEN** 按既有规则更新工作台代码草稿

#### Scenario: 路径非法

- **WHEN** path 指向 job 外或使用 `..`
- **THEN** 工具拒绝并返回可读错误
