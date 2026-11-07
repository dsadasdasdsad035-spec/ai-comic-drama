# Spec Delta

## MODIFIED Requirements

### Requirement: 批量出片与卡上出图解耦

画布在空间视图中的批量生成 **MUST** 仅限画面（出图）：多选浮动条 MUST 提供批量出图且 MUST NOT 提供批量出片或批量台词配音；画布「操作」菜单 MUST 提供批量生成画面且 MUST NOT 提供批量出片或批量配音。单镜出片与单镜台词配音 MUST 仍可通过 Inspector 对应 Tab 触发。本条取代「多选浮动条 SHALL 继续提供批量出片」的语义。

#### Scenario: 多选仅出图

- **WHEN** 用户在画布选中多个分镜
- **THEN** 浮动条出现「出图」与「删除」，不出现「出片」或「配音」

#### Scenario: 操作菜单无批量出片配音

- **WHEN** 用户打开画布「操作」下拉菜单
- **THEN**「生成」分区含「批量生成画面」，不含「批量出片」或「批量配音」

#### Scenario: Inspector 单镜能力不变

- **WHEN** 用户选中单个分镜并打开 Inspector「视频」或「声音」Tab
- **THEN** 仍可使用底栏「生成视频」或「生成配音」，行为与移除画布批量入口前一致

## REMOVED Requirements

### Requirement: 批量出片与卡上出图解耦（旧版批量出片场景）

**Reason**：画布批量能力收敛为仅出图；批量出片改由产品其它视图承载或暂不提供。

**Migration**：对多镜出片逐镜使用 Inspector「视频」Tab；对多镜配音逐镜使用「声音」Tab 或保留既有 API 供未来工作台调用。

#### Scenario: 多选出片

- **WHEN** 用户在画布选中多个分镜并查找浮动条「出片」
- **THEN** 该入口不存在（旧行为已移除）
