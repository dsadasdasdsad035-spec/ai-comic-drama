# Spec Delta

## ADDED Requirements

### Requirement: 邻镜参考仅出片镜可配置

系统 MUST 仅在 `prodKind === 'video'` 的镜头上，于画布参考入口提供上一镜/下一镜（`shot-prev` / `shot-next`）选项。生图镜 MUST NOT 在该入口列出邻镜项。出片解析邻镜参考的行为 MUST 不变。

#### Scenario: 出片镜可选邻镜

- **WHEN** 用户右击出片镜打开参考菜单
- **THEN** 可见上一镜/下一镜项（在邻镜有画面时可选）

#### Scenario: 生图镜无邻镜项

- **WHEN** 用户右击生图镜打开参考菜单
- **THEN** 不出现上一镜/下一镜项，仅角色/素材等生图可用来源
