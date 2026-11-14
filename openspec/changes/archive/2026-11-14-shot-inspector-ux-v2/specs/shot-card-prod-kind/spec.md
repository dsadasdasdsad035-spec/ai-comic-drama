# Spec Delta

## MODIFIED Requirements

### Requirement: Inspector Tab 由当前镜类型决定

分镜 Inspector 可见 Tab MUST 由**当前选中镜头**的 `prodKind` 决定，MUST NOT 由画布全局「出图/出片」模式同时作用于所有镜头。

- `prodKind === 'image'` 时 MUST 仅显示 **`画面`** 与 **`叙事`** 两个 Tab。`叙事` Tab MUST 承载台词、表演等叙事字段，MUST NOT 承载视频出片、原生音频或运镜库主配置。
- `prodKind === 'video'` 时 MUST 仅显示 **`出片`**、**`音画`**、**`元数据`** 三个 Tab。`出片` Tab MUST 承载出片提示词、附件槽位、运镜与出片设置主路径；`音画` Tab MUST 承载台词、表演、表情参考与原生音频；`元数据` Tab MUST 承载手工参考 URL 与镜头只读标识信息。

底栏主操作 MUST 仅在 `画面`（生成画面）与 `出片`（生成视频）Tab 显示；`叙事`、`音画`、`元数据` Tab MUST NOT 占用生成主按钮位。

#### Scenario: 选中生图卡

- **WHEN** 用户选中 `prodKind === 'image'` 的镜头
- **THEN** 可见 Tab 为「画面」与「叙事」，无「出片」「音画」「元数据」

#### Scenario: 选中出片卡

- **WHEN** 用户选中 `prodKind === 'video'` 的镜头
- **THEN** 可见 Tab 为「出片」「音画」「元数据」，无「画面」

#### Scenario: 切换选中镜即切换 Tab 集合

- **WHEN** 用户从一生图卡选中切到一出片卡
- **THEN** Inspector Tab 集合立即随 `prodKind` 切换，且当前 Tab 回落到该工位默认 Tab（生图→画面，出片→出片）
