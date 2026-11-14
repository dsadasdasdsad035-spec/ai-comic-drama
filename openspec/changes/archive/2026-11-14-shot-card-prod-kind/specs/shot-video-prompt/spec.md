# Spec Delta

## ADDED Requirements

### Requirement: 出片工位仅对出片卡开放

画布分镜的出片提示词面板、附件清单与「生成视频」主操作 MUST 仅对 `prodKind === 'video'` 的镜头提供。`prodKind === 'image'` 的镜头 MUST NOT 展示可提交的出片主工位。

#### Scenario: 出片卡打开面板

- **WHEN** 用户选中 `prodKind === 'video'` 的镜头
- **THEN** 出片提示词面板与生成视频主操作可用（在出片条件满足时）

#### Scenario: 生图卡无出片主工位

- **WHEN** 用户选中 `prodKind === 'image'` 的镜头
- **THEN** 不出现可提交的生成视频主操作

### Requirement: 镜头语言库在出片卡 Inspector 配置

对 `prodKind === 'video'` 的镜头，系统 SHALL 在 Inspector 视频工位（视频 Tab 或等价出片区）提供镜头语言库选用：`lexiconRefKey`、运镜参照预览，以及显式「作为运镜参考」类动作（与 `camera-lexicon-presets` 一致）。用户 MUST NOT 为配置运镜参考而依赖画布全局出图模式或画面 Tab 作为唯一入口。

#### Scenario: 出片卡上选运镜库

- **WHEN** 用户在出片卡视频 Tab 打开镜头参数并选用 catalog 条目
- **THEN** `lexiconRefKey` 写回该镜，出片提示词拼装可读 catalog 术语

#### Scenario: 生图卡不配置运镜连线

- **WHEN** 用户选中生图卡
- **THEN** 不出现要求配置 `motionLexiconAsRef` 的主 UI，或仅只读说明引导使用出片卡

#### Scenario: 默认不自动连线

- **WHEN** 用户新选用运镜 catalog 条目
- **THEN** 系统仍默认不自动把预置视频连到画布，直到用户显式确认作为运镜参考
