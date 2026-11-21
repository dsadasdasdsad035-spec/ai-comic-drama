# Spec Delta: shot-clip-frame-assets

## Purpose

让分镜成片的首帧与尾帧可发布为画布素材卡，供出片与邻镜连续性参考；镜间连续通过物化素材卡与 `refIds` 表达，而非扩展邻镜 token 语义。

## ADDED Requirements

### Requirement: 从成片抽取首帧或尾帧

系统 SHALL 在用户触发时，从当前分镜已挂载的成片视频抽取第 0 帧或解码末帧，写入项目媒体并返回可用图片 URL。无成片或抽帧失败时 MUST 拒绝并给出可读原因；抽帧成功但帧近黑时 MUST 允许继续并给出非阻断提示（与转场边界帧语义一致）。

#### Scenario: 有成片抽首帧

- **WHEN** 分镜有成片且用户点「抽首帧 → 素材卡」
- **THEN** 系统生成首帧图片 URL 并进入发布素材卡流程

#### Scenario: 有成片抽尾帧

- **WHEN** 分镜有成片且用户点「抽尾帧 → 素材卡」
- **THEN** 系统生成末帧图片 URL 并进入发布素材卡流程

#### Scenario: 无成片

- **WHEN** 分镜没有成片且用户点抽帧
- **THEN** 不抽帧，提示先生成或挂载成片

### Requirement: 发布为画布素材卡

系统 SHALL 将抽取结果发布为 `kind` 为图片的素材卡：写入 `project.assets`、在画布创建或更新对应 `asset-<canvasId>` 节点，标题默认含镜号与「成片首帧」或「成片尾帧」。发布 MUST 记录溯源：`sourceShotId`（镜业务 id）与 `frameRole`（`head` 或 `tail`），并记录来源成片指纹（路径或等价指纹字段）。

#### Scenario: 首次发布尾帧卡

- **WHEN** 用户从镜 E01-S01 成片抽尾帧并发布
- **THEN** 画布出现一张图片素材卡，溯源为 E01-S01 + tail

#### Scenario: 参与出片参考

- **WHEN** 用户把该素材卡连到出片镜或写入其 `refIds`
- **THEN** `collectShotReferences` 将该图作为素材参考参与出片拼装

### Requirement: 溯源槽位自动覆盖

对同一项目、同一 `sourceShotId` 与同一 `frameRole`，系统 MUST 至多保留一张溯源素材卡。用户再次抽取或成片更新后再次发布时 MUST 更新该卡的图片 URL 与指纹，保留其 `canvasId` 与画布位置，MUST NOT 新增第二张同源卡。

#### Scenario: 成片重出后重抽

- **WHEN** 镜 E01-S01 重出片后用户再次「抽尾帧 → 素材卡」
- **THEN** 原 E01-S01·尾帧卡更新为新图，节点 id 不变

#### Scenario: 删除后重建

- **WHEN** 用户删除溯源素材卡后再次从同一镜同一角色抽帧发布
- **THEN** 创建新素材卡并分配新 `canvasId`；已删卡上的 `refIds` 不自动恢复

### Requirement: 引用上一镜尾帧

系统 SHALL 提供动作为当前分镜引用同集上一镜成片尾帧：若无上一镜或上一镜无成片 MUST 拒绝；若已存在上一镜 `tail` 溯源卡且指纹仍匹配 MUST 复用该卡；否则 MUST 抽上一镜尾帧并发布或覆盖其溯源卡。成功后 MUST 将对应 `asset-<canvasId>` 写入当前镜 `refIds`（若未引用）；MUST NOT 写入或修改 `shot-prev` token。

#### Scenario: 一键引用

- **WHEN** 用户在有上一镜且上一镜有成片的镜 B 点「引用上一镜尾帧」
- **THEN** 镜 B 的 `refIds` 含上一镜尾帧素材 token，出片参考可解析该图

#### Scenario: 首镜无上一镜

- **WHEN** 用户在集内第一镜点「引用上一镜尾帧」
- **THEN** 拒绝并说明无上一镜

#### Scenario: shot-prev 语义不变

- **WHEN** 镜 B 仅通过本动作引用尾帧、未勾选邻镜参考
- **THEN** `shot-prev` 不存在于 `refIds`，邻镜静帧参考行为与变更前一致