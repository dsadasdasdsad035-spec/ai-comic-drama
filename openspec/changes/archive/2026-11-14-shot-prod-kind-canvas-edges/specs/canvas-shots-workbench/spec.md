# Spec Delta

## ADDED Requirements

### Requirement: 顺序边按两端工位决定虚实

画布上相邻分镜之间的**顺序边**（硬切、转场、闪回、分支，不含角色/素材参考边）MUST 根据源镜与目标镜的 `prodKind` 决定是否为实线：

- 当**两端**均为 `video` 时，边 MUST 绘制为**实线**（无 dash），**包括** `relation === transition` 的转场边。
- 当任一端为 `image` 或 `prodKind` 缺失且水合为生图镜时，边 MUST 绘制为**虚线**。

关系的语义（转场/闪回等）MUST 仍通过颜色或其它非 dash 样式区分，MUST NOT 仅依赖转场虚线表达成片链。

#### Scenario: 出片链硬切实线

- **WHEN** 两镜均为出片镜且以硬切相连
- **THEN** 连线为实线

#### Scenario: 出片链转场实线

- **WHEN** 两镜均为出片镜且以转场相连
- **THEN** 连线为实线（不因转场关系单独使用虚线）

#### Scenario: 含生图镜则虚线

- **WHEN** 硬切或转场连接的一端为生图镜、另一端为出片镜
- **THEN** 连线为虚线

#### Scenario: 双生图镜虚线

- **WHEN** 两镜均为生图镜且有序列边
- **THEN** 连线为虚线
