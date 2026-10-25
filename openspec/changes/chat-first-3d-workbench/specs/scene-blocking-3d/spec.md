# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 打开 3D 即准备生成，一键完成`
- TO: `### Requirement: 打开 3D 等待显式生成`

## MODIFIED Requirements

### Requirement: 打开 3D 等待显式生成

打开某镜的 3D 工作台时，如果没有 `sceneCode` 且没有 legacy 结构化数据，系统 MUST NOT 自动调用代码模型；SHALL 显示空状态，提供显式的“生成 3D 代码”和聊天入口。已有 `sceneCode` MUST 直接展示，不重复生成。只有 legacy 数据时 MUST 展示只读 legacy 预览和“生成代码版本”入口，不自动覆盖。视频渲染 SHALL 仍需用户显式触发。

#### Scenario: 首次打开空镜头

- **WHEN** 用户打开一个没有任何 3D 数据的镜头
- **THEN** 编辑器显示空预览和“生成 3D 代码”入口，不自动发起模型调用

#### Scenario: 已有数据

- **WHEN** 用户打开已有 sceneCode 的镜头
- **THEN** 直接显示代码预览，不自动发起模型调用

#### Scenario: 一键重生成

- **WHEN** 用户点击“生成 3D 代码”
- **THEN** 只触发一次代码生成，不要求分别生成空间和走位

#### Scenario: 聊天创建

- **WHEN** 用户在空状态直接发送聊天消息
- **THEN** 由聊天 agent 生成并试运行代码，不先自动生成一版
