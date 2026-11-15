# Spec Delta

## ADDED Requirements

### Requirement: Agent 出首帧与画布共用参考解析

Agent 的首帧生成工具 MUST 与画布按钮生成使用同一个参考解析器（`collectShotReferences`），把该镜 `refIds` 指向的角色三视图、素材图片与表情参考作为多参考图送出，而不是只发提示词。参考图数量 MUST 按画布同一上限（10 张）截断，超出部分 MUST 在返回结果中说明。提示词 MUST 追加与画布一致的参考图说明，写明每张图对应哪个主体。

解析不出的显式参考 MUST 在成本确认之前让工具失败并说明原因，MUST NOT 静默丢弃后继续生成：角色已不在角色库、角色还没有三视图、素材卡不在画布上、素材不是图片，都属于此类。表情参考缺图、生图镜上的相邻镜残留 token 仍 MUST 静默忽略（与画布一致）。

工具 MUST NOT 因生成而修改 `refIds` 或创建素材卡。

#### Scenario: 角色参考进入请求体

- **WHEN** 镜 `S01` 的 `refIds` 含 `char-lan`，且「阿岚」有三视图
- **THEN** 发往生图接口的请求体 `refImages` 含该三视图地址，prompt 含「参考图说明」并标注该图对应阿岚

#### Scenario: 角色没三视图时拒绝并零消耗

- **WHEN** 镜 `S01` 连了「阿岚」，但角色没有三视图
- **THEN** 工具返回失败并说明「角色「阿岚」还没有三视图」，且不发起任何生图请求、不进入成本确认

#### Scenario: 素材卡不在画布上

- **WHEN** `refIds` 含 `asset-<uid>`，但画布上没有该节点（例如创意会话未挂载画布）
- **THEN** 工具返回失败并提示重新连线，MUST NOT 发一张不带该素材的图

#### Scenario: 相邻镜参考只在出片镜生效

- **WHEN** 生图镜的 `refIds` 残留 `shot-prev`
- **THEN** 首帧生成忽略该 token 且不报错

## MODIFIED Requirements

（无）

## REMOVED Requirements

（无）
