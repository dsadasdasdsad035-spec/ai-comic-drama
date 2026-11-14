# Spec Delta

## Purpose

分镜画布上每一张分镜卡在生产工位上互斥：创建时选定生图或出片，`prodKind` 决定 Inspector Tab、主生成按钮与批量队列是否包含该镜。

## ADDED Requirements

### Requirement: 每镜持久化生产类型

系统 SHALL 为每个项目镜头保存 `prodKind`，取值为 `image` 或 `video`。字段 MUST 写入项目镜头 JSON 并在重开项目后保留。缺省字段 MUST 在项目加载时按本 capability 的水合规则补齐；补齐后 MAY 在用户下次保存项目时持久化。

#### Scenario: 新建生图镜

- **WHEN** 用户在画布选择新建「生图镜头」并确认
- **THEN** 新镜头 `prodKind` 为 `image` 并写入项目

#### Scenario: 新建出片镜

- **WHEN** 用户在画布选择新建「出片镜头」并确认
- **THEN** 新镜头 `prodKind` 为 `video` 并写入项目

#### Scenario: 重开项目保留类型

- **WHEN** 用户保存含 `prodKind` 的项目后重新打开
- **THEN** 各镜 `prodKind` 与保存前一致

### Requirement: 生产类型互斥主路径

对 `prodKind === 'image'` 的镜头，系统 MUST 提供静帧生成（Seedream）主路径，MUST NOT 提供「生成视频」主操作（含 Inspector 视频 Tab 吸底、对该镜的批量出片）。对 `prodKind === 'video'` 的镜头，系统 MUST 提供视频出片主路径，MUST NOT 提供「生成画面」主操作（含卡头生成、画面 Tab 吸底 Seedream、对该镜的批量出图）。每种镜头 MAY 保留只读预览或参考字段（如出片卡上的 `refImage`），但 MUST NOT 将只读预览等同于已开通的主出图路径。

#### Scenario: 生图卡可出图不可主出片

- **WHEN** 用户选中 `prodKind === 'image'` 的镜头且画面提示词非空
- **THEN** Inspector 画面 Tab 显示生成画面主操作，且不显示视频 Tab 或视频 Tab 无生成视频主操作

#### Scenario: 出片卡可出片不可主出图

- **WHEN** 用户选中 `prodKind === 'video'` 的镜头且出片条件满足
- **THEN** Inspector 视频 Tab 显示生成视频主操作，且画面 Tab 不出现生成画面主操作，卡头不触发 Seedream

#### Scenario: 批量队列尊重类型

- **WHEN** 用户多选包含生图卡与出片卡的镜头并触发批量出图
- **THEN** 仅 `prodKind === 'image'` 的镜头进入队列

### Requirement: Inspector Tab 由当前镜类型决定

分镜 Inspector 可见 Tab MUST 由**当前选中镜头**的 `prodKind` 决定，MUST NOT 由画布全局「出图/出片」模式同时作用于所有镜头。`image` 镜头 MUST 仅显示 `画面` 与 `更多`；`video` 镜头 MUST 仅显示 `视频` 与 `更多`。

#### Scenario: 选中生图卡

- **WHEN** 用户选中 `prodKind === 'image'` 的镜头
- **THEN** 可见 Tab 为画面与更多

#### Scenario: 选中出片卡

- **WHEN** 用户选中 `prodKind === 'video'` 的镜头
- **THEN** 可见 Tab 为视频与更多

#### Scenario: 切换选中镜即切换 Tab 集合

- **WHEN** 用户从一生图卡选中切到一出片卡
- **THEN** Inspector Tab 集合立即随 `prodKind` 切换，无需顶栏模式切换

### Requirement: 遗留镜头水合规则

项目加载时，对缺少 `prodKind` 的镜头，系统 MUST 按下列规则推断并用于 UI（双轨优先出片）：

1. 若存在 `videoUrl` 或表明出片进行中/已完成的 `vid*` 状态 → `video`
2. 若 (1) 与静帧成果（`refImage`、候选图、`gen*`）同时存在 → 仍为 `video`
3. 若仅静帧痕迹且无 (1) → `image`
4. 若完全空白 → `image`

#### Scenario: 仅静帧遗留

- **WHEN** 旧镜头有 `refImage` 且无 `videoUrl` 与出片状态
- **THEN** 水合为 `image`

#### Scenario: 双轨遗留为出片卡

- **WHEN** 旧镜头同时有 `refImage` 与 `videoUrl`
- **THEN** 水合为 `video`，静帧字段保留作参考

#### Scenario: 仅出片遗留

- **WHEN** 旧镜头有 `videoUrl` 且无静帧成果
- **THEN** 水合为 `video`

### Requirement: 定帧到动镜不复用同卡双主路径

系统 MUST NOT 默认同一 `prodKind === 'image'` 镜头在完成静帧后自动变为可主出片。用户 MUST 通过新建 `prodKind === 'video'` 的镜头并以连线、上传或邻镜方式提供参考，才能完成定帧到动镜流水线。

#### Scenario: 生图完成后仍需出片卡

- **WHEN** 用户在生图卡上生成画面成功
- **THEN** 该卡仍为 `image`，用户需另建出片卡或（若产品提供）显式转换类型才能主出片
