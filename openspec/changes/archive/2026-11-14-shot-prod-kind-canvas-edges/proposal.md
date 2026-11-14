# Proposal

## Why

`shot-card-prod-kind` 已把分镜分成生图镜与出片镜，但画布仍有两处与工位不一致：

1. **参考**：生图镜右键仍可选上一镜/下一镜，且 Seedream 会解析邻镜 token；用户期望生图只吃角色/素材，邻镜只服务出片。
2. **顺序边**：镜与镜之间的硬切/转场/闪回/分支边，样式只按 `relation` 虚线（转场常为虚线），无法表达「两端都是出片镜 = 成片链」；用户要求 **两端皆 video 一律实线（含转场）**，任一侧为生图镜则 **虚线**。

## What Changes

- **生图镜**：右键参考菜单不列出上一镜/下一镜；`collectShotReferences`（Seedream）MUST NOT 使用 `shot-prev` / `shot-next`；已存 token 可保留但不参与出图（可选 UI 提示清理）。**出片镜**邻镜行为不变。
- **顺序边样式**：计算两端镜头的 `prodKind`（`effectiveProdKind`）；**两端均为 `video` → 实线**（`strokeDasharray` 无，含 `relation === transition`）；**否则 → 虚线**。关系仍由颜色区分，不再单靠转场虚线表达「未定稿」。
- **参考边**（角色/素材→镜）：本变更 **不** 改虚实（用户未要求）。
- 验收：`verify-shot-*` 或新脚本断言边 `data-` / class 与菜单项；`ShotEdge` / `shownEdges` 传两端 prodKind。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-still-image`：生图参考集不得含邻镜 token。
- `canvas-shots-workbench`：分镜顺序边按两端 `prodKind` 决定实线/虚线。
- `shot-video-prompt`：明确邻镜参考仅出片工位（与既有「连线解析」一致，补约束邻镜 UI 仅 video）。

## Impact

- `src/shotReferences.ts`、`src/App.tsx`（参考菜单、`collectShotReferences`）
- `src/ShotEdge.tsx`、`src/App.tsx`（`shownEdges` / edge `data` 带水合两端 prodKind）
- 回归：`verify-edge-menu.mjs`、`verify-shot-inspector.mjs` 若依赖转场虚线需更新
- 与已归档 `shot-card-prod-kind` 正交，依赖其 `prodKind` 字段

## 用户已确认

- 生图镜不需要上下镜参考；出片不受影响。
- 镜与镜之间：两端皆 video → 实线；含 image → 虚线。
- **转场边**在两端皆 video 时也 **强制实线**（不因 relation 单独虚线）。
