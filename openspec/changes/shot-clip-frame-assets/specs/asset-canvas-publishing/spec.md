# Spec Delta: asset-canvas-publishing

## MODIFIED Requirements

### Requirement: 发布必须幂等

系统 SHALL 为每张设定卡保持稳定标识，同一标识在当前项目画布上最多对应一张素材卡；重复发布 MUST 更新已有卡的标题、类型和图片并保留其画布位置，MUST NOT 新增重复卡；用户删除素材卡后再次发布 MUST 重建一张。成片帧溯源卡 SHALL 以 `sourceShotId` 与 `frameRole`（`head` | `tail`）作为与 `designId` 同级的稳定标识：同一项目内同一对标识最多一张卡，重复发布 MUST 更新图片与指纹并保留 `canvasId` 与位置。

#### Scenario: 重新生成后再次发布

- **WHEN** 用户更换设定卡的当前图后再次点「加入画布」
- **THEN** 原素材卡更新为新图，画布上仍只有一张对应卡

#### Scenario: 删除后重新发布

- **WHEN** 用户从画布删除某张已发布素材卡，再回素材页点「加入画布」
- **THEN** 重新创建一张对应素材卡

#### Scenario: 手工素材卡不受影响

- **WHEN** 画布上存在没有设定标识的手工素材卡，用户发布设定卡
- **THEN** 手工素材卡的标题、图片和位置保持不变

#### Scenario: 成片尾帧重复发布

- **WHEN** 用户从同一镜成片再次发布尾帧素材卡
- **THEN** 更新已有溯源卡，不新增第二张同源尾帧卡