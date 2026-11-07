# Spec Delta

## ADDED Requirements

### Requirement: Agent 宿主探索不单独构成调度真相

3D 调度 agent 通过 `run_bash` 或 job 目录内文件工具产生的输出、临时渲染或拷贝的媒体 MUST NOT 自动写入镜头的 `sceneCode`、`schedule_video` 或更新调度输入指纹。只有用户显式保存工作台或 agent 经既有 `finish` 门禁采纳的结果 MAY 更新调度真相。

#### Scenario: shell 试运行不生效

- **WHEN** agent 在 full_host 下用 bash 在 job 目录生成了图片或视频，但未调用 `run_render` / `finish`
- **THEN** 3D 调度视图仍不把该产物当作当前镜的有效调度，不消除「未渲染」或「已过期」状态

#### Scenario: 门禁采纳后生效

- **WHEN** agent 经 `run_render`、验收与 `finish` 完成本轮且用户采纳
- **THEN** 调度状态与指纹按现有规则更新
