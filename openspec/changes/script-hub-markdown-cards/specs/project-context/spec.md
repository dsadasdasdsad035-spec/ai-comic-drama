# Spec Delta: project-context

## ADDED Requirements

### Requirement: 上次视图记忆包含剧本

系统 SHALL 将 `script` 纳入 `ViewId` 与「上次视图」持久化；从项目大厅打开项目时 MUST 能恢复到上次离开的视图（含剧本）。删除项目 MUST 清除该项目的上次视图记录（已有行为保持）。

#### Scenario: 离开在剧本后恢复

- **WHEN** 用户在项目 A 的剧本视图离开后再从大厅打开 A
- **THEN** 默认进入剧本视图而非强制概览

#### Scenario: 路由白名单

- **WHEN** 用户直接访问 `#/p/A/script`
- **THEN** 解析为合法项目视图，不回落为 overview