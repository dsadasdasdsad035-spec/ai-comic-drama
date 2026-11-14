# Spec Delta

## MODIFIED Requirements

### Requirement: 镜头语言库在出片卡 Inspector 配置

对 `prodKind === 'video'` 的镜头，系统 SHALL 在 Inspector **出片** Tab 的「运镜与语义」区块提供镜头语言库选用：`lexiconRefKey`、运镜参照预览，以及显式「作为运镜 reference_video」类动作（与 `camera-lexicon-presets` 一致）。用户勾选或选用库条目后，**出片** Tab 内附件与槽位清单 MUST 同步反映运镜视频参考（当作为 `reference_video` 时）。用户 MUST NOT 为配置运镜参考而依赖画布全局出图模式或生图镜 **画面** Tab 作为唯一入口。

#### Scenario: 出片卡上选运镜库

- **WHEN** 用户在出片镜 **出片** Tab 打开运镜与语义并选用 catalog 条目
- **THEN** `lexiconRefKey` 写回该镜，出片提示词拼装可读 catalog 术语

#### Scenario: 生图卡不配置运镜连线

- **WHEN** 用户选中生图卡
- **THEN** 不出现要求配置 `motionLexiconAsRef` 的主 UI，或仅只读说明引导使用出片卡

#### Scenario: 默认不自动连线

- **WHEN** 用户新选用运镜 catalog 条目
- **THEN** 系统仍默认不自动把预置视频连到画布素材卡，直至用户显式开启作为视频参考（或等效确认）

#### Scenario: 运镜库与附件联动

- **WHEN** 用户在出片 Tab 选用镜头语言库并开启作为视频参考
- **THEN** 出片 Tab 附件列表出现对应视频槽位项
