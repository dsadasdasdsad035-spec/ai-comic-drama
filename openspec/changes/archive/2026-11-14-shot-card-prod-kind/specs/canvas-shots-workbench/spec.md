# Spec Delta

## MODIFIED Requirements

### Requirement: 画布增删插为正式镜头

画布 SHALL 提供新增镜头、在某镜之后插入与删除镜头。新增与插入 MUST 生成带集内唯一镜号的正式镜头并写入项目，MUST NOT 只建无业务 ID 的临时卡。新增与插入 MUST 在创建时让用户选定镜头的 `prodKind`（生图或出片），并把选定值写入该镜头。删除 MUST 先确认，确认后移除该项目镜头、画布节点与其连线，并清除指向它的 `transition_out`。

#### Scenario: 新增镜头

- **WHEN** 用户在画布新增镜头并选择生产类型
- **THEN** 项目出现新镜头且含对应 `prodKind`，画布出现对应卡片并接在序列中

#### Scenario: 在中间插入

- **WHEN** 用户从某一镜插入新镜并选择生产类型
- **THEN** 新镜紧跟在所选镜之后，镜号在集内唯一，且 `prodKind` 与选择一致

#### Scenario: 删除带转场的镜头

- **WHEN** 用户删除一镜且上一镜配置了指向它的转场
- **THEN** 该镜从项目与画布移除，上一镜的 `transition_out` 被清除

#### Scenario: 镜号冲突

- **WHEN** 新增或改动的镜号与集内已有镜号重复
- **THEN** 写入被阻止并指出冲突的镜号

## ADDED Requirements

### Requirement: 画布不以全局模式决定单镜能力

系统 MUST NOT 使用单一画布级「出图/出片」开关同时隐藏或禁用所有镜头的某一类 Inspector Tab 或主生成能力。若 UI 仍提供画布级筛选控件，该控件 MUST 仅影响节点展示或筛选，MUST NOT 改写任何镜头的 `prodKind`。

#### Scenario: 无全局 Tab 锁

- **WHEN** 画布上同时存在生图卡与出片卡
- **THEN** 用户选中生图卡可见画面 Tab，选中出片卡可见视频 Tab，无需切换顶栏模式

#### Scenario: 筛选不改数据

- **WHEN** 用户启用「仅看出片卡」类筛选（若实现）
- **THEN** 被隐藏的生图卡 `prodKind` 不变，取消筛选后仍为生图卡
