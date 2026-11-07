# Proposal

## Why

顶栏「3D」视图已独立，但列表仍沿用镜头表式的镜号、出场、场次列，blocking 工种只需看调度状态、代码、运镜和预演视频，剧本制表信息造成干扰且与镜头表重复。

## What Changes

- `Schedule3DBoard` 列表改为 **3D 原生列**：状态、代码摘要（`codeHash` 短码或「无代码」）、运镜（`motion_note`）、预演（`查看` 链到 `schedule_video`）、操作（打开）。
- **移除**表头与单元格中的镜号、出场、场次、画布圆点；镜号仍在打开后的 `SceneCodeWorkbench` 顶栏显示。
- 每行增加稳定 DOM 标识（如 `data-shot-id`），供验收与其它脚本按镜定位；行 `title` 可含镜号供 hover 辨认，**不作为可见列**。
- 更新相关 Playwright 验收：不再用镜号文本匹配行（如 `verify-3d-render-asset-flow.mjs`）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-blocking-3d`：补充 3D 调度视图列表的展示范围与列语义（只展示调度域字段）。

## Impact

- `src/Schedule3DBoard.tsx`：表结构与行渲染；删除仅服务于旧列的 `castOf` 等。
- `verify-schedule3d-workbench.mjs` 等：断言无旧列、保留打开/状态；按需加 `data-shot-id` 断言。
- `README.md`：3D 视图列表说明一句（可选，与实现同 PR）。
