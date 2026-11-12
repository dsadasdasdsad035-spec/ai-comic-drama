# Spec Delta

## ADDED Requirements

### Requirement: 预置运镜与镜头语法来源

选择器 SHALL 提供「运镜库」与「镜头语法」分类，数据来自内置 catalog，不混入 `public/videos/` 项目成片扫描结果。

#### Scenario: 运镜库列表

- **WHEN** 用户打开选择器并切换到运镜库
- **THEN** 列表展示 `lexiconCategory=camera-move` 的条目（含 001–100 段），支持按 `cn`/`en`/`key` 搜索

#### Scenario: 镜头语法列表

- **WHEN** 用户切换到镜头语法
- **THEN** 列表展示 `lexiconCategory=shot-grammar` 的条目（101–132），并可按 `grammarGroup` 筛选

### Requirement: 预置视频预览与选用

运镜库与镜头语法条目 SHALL 支持与其他视频相同的 hover/选中预览与确认语义；确认后 MUST 将视频复制进当前项目并返回项目内 URL，`kind` 为 `video`。

#### Scenario: 确认选用预置推镜头

- **WHEN** 用户在运镜库选中 `01_dolly_in` 并确认
- **THEN** 素材卡 `kind` 为 `video`，URL 为项目内路径而非仅 `/presets/...`

#### Scenario: 取消不变更

- **WHEN** 用户关闭选择器未确认
- **THEN** 素材卡 MUST NOT 变化
