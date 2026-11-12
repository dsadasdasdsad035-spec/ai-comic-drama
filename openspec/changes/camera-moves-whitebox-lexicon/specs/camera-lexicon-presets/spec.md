# Spec Delta

## Purpose

内置白膜运镜 catalog，为镜头语言提供可预览、可检索、可映射到项目枚举的标准视频参照。

## ADDED Requirements

### Requirement: 预置 catalog 可加载

系统 SHALL 从 `/presets/camera-moves-whitebox-132/manifest.json` 加载 catalog，并暴露全部 `entries` 的 `key`、`cn`、`en`、`url`、`section`、`sectionTitle`、`lexiconCategory`、`grammarGroup`（若存在）、`mapsToMove`、`mapsToSize`、`primaryForMove`、`primaryForSize`。

#### Scenario: 启动后读取 catalog

- **WHEN** 应用需要展示运镜库或镜头语法
- **THEN** 系统能解析 manifest 且 `count` 等于 132

#### Scenario: 条目 URL 可播放

- **WHEN** 用户预览任一条目的 `url`
- **THEN** 浏览器 MUST 能请求对应 MP4 且返回 200

### Requirement: 枚举主参照映射

对 `MOVES` 与 `SHOT_SIZES` 各枚举值，catalog MUST 提供至少一条 `primaryForMove` 或 `primaryForSize` 为 true 的条目（无对应运镜的枚举如「固定」MAY 使用镜头语法条目作为替代并在 UI 说明）。

#### Scenario: 查推镜头主参照

- **WHEN** 系统按 `move=推` 解析主参照
- **THEN** 返回 `key=01_dolly_in` 且 `primaryForMove` 为 true

#### Scenario: 查中景主参照

- **WHEN** 系统按 `size=中景` 解析主参照
- **THEN** 返回 `key=103_medium_push` 且 `primaryForSize` 为 true

### Requirement: 署名可见

展示预置运镜或镜头语法库的界面 MUST 显示 attribution「hong hou zi」，并提供指向 `ATTRIBUTION.md` 的说明或等价摘要。

#### Scenario: 素材页展示署名

- **WHEN** 用户打开镜头语言或运镜库浏览
- **THEN** 界面可见署名文案
