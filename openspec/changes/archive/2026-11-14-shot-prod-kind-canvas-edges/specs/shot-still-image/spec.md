# Spec Delta

## MODIFIED Requirements

### Requirement: 出图不自动成为画布素材或连线

静帧生成成功 MUST NOT 自动创建画布素材卡，MUST NOT 自动向该分镜 `refIds` 追加节点 id，MUST NOT 自动把生成图作为视频 `reference_image` 提交。**生图镜 MUST NOT 将 `shot-prev` / `shot-next` 邻镜 token 纳入 Seedream 参考集；即使用户曾勾选，出图请求 MUST 忽略该 token。**

#### Scenario: 无新素材卡

- **WHEN** 用户对一镜完成静帧生成且生成前画布上无对应新卡
- **THEN** 画布节点数量不因该次生成而增加素材卡

#### Scenario: refIds 不变

- **WHEN** 用户对一镜完成静帧生成且生成前 `refIds` 为空
- **THEN** 生成后 `refIds` 仍为空，直至用户手动连线

#### Scenario: 生图镜忽略邻镜 token

- **WHEN** 生图镜的 `refIds` 含 `shot-prev` 或 `shot-next` 且用户触发 Seedream
- **THEN** 请求参考图集合不包含邻镜画面，仅含角色/素材/构图等允许项
