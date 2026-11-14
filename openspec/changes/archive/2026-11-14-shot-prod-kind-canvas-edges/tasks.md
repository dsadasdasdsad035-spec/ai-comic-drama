# Tasks

## 1. 生图镜禁用邻镜

- [x] 1.1 `App.tsx` 参考菜单：`effectiveProdKind === 'image'` 时不渲染 `neighborReferenceItems`
- [x] 1.2 `collectShotReferences`：生图镜跳过 `shot-prev` / `shot-next` 解析
- [x] 1.3 手动或脚本：生图镜带邻镜 token 出图不包含邻镜 URL

## 2. 顺序边虚实

- [x] 2.1 `shownEdges`（或等价）为分镜边注入两端 `prodKind` 或 `sequenceSolid` 标志
- [x] 2.2 `ShotEdge`：双 `video` 时 `strokeDasharray` 为空；否则使用工位虚线样式，覆盖 relation 默认 dash
- [x] 2.3 转场 + 双 video 回归：边为实线，关系色仍为转场色

## 3. 验收与文档

- [x] 3.1 更新 `verify-edge-menu.mjs` / 相关断言（转场双 video 实线）
- [x] 3.2 `README` 画布一小节：顺序边虚实与邻镜仅出片
- [x] 3.3 `openspec validate shot-prod-kind-canvas-edges --strict`

## Workflow follow-up

- 实现后 `/opsx-apply`，完成后 archive 合并 delta。
