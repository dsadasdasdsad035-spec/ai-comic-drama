# Design

## Context

- 顺序边：`ShotEdge` 用 `DASH[relation]`，`transition` 为 `'7 5'` 虚线。
- 邻镜：`refIds` 中的 `shot-prev` / `shot-next`，由右键菜单 toggle；`collectShotReferences` 与 `buildShotVideoRequest` 均会解析。
- `prodKind`：`effectiveProdKind(node.data)`，见 `shotProdKind.ts`。

## Goals / Non-Goals

**Goals:**

- 顺序边线型优先表达 **成片链**（双 video 实线），其次才是 relation 配色。
- 生图路径与邻镜解耦。

**Non-Goals:**

- 镜→镜物理参考连线（邻镜仍是无形的 token）。
- 角色/素材参考边样式按 prodKind 变化。
- 自动删除生图镜上的邻镜 token（可提示，不强制清库）。

## Decisions

### D1：顺序边 dash 优先级

```text
dash = (kindA === 'video' && kindB === 'video') ? undefined : PROD_KIND_DASH
```

`PROD_KIND_DASH` 建议 `'6 4'`（与 branch 同量级，或统一常量）。**覆盖** `DASH[relation]` 当双 video；单 video 或双 image 一律虚线。

`relation` 颜色、`data.active`、inactive/stale 逻辑 **保留**。

### D2：`ShotEdge` 输入

在 `App.tsx` `shownEdges` 为每条分镜边附加 `data.prodKindSource` / `data.prodKindTarget`（或 `sequenceSolid: boolean`），避免 `ShotEdge` 内查全图 nodes。

### D3：生图禁用邻镜

- `neighborReferenceItems` 调用处：若 `effectiveProdKind(target) === 'image'`，**不** map 邻镜项。
- `collectShotReferences`：若 `effectiveProdKind(node.data) === 'image'`，**跳过** adjacent 分支（即使 refIds 含 token）。
- 出片：`buildShotVideoRequest` / 菜单 **不变**。

### D4：转场实线

双 video 时 `transition` 与 `cut` 同为实线；用户在菜单/颜色上区分转场。文档说明旧「转场虚线 = 未定稿」由 **inactive/stale** 状态色承担。

## Risks

| 风险 | 缓解 |
|------|------|
| 回归脚本断言转场虚线 | 更新为双 video 实线 + relation 颜色 |
| 旧项目全 image 边全虚 | 符合规则；成片链需用户改出片镜或连线两端类型 |

## Migration

- 纯展示与参考解析，无 JSON 迁移。
