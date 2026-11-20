# Design

## Context

- 已实现：`material-3d-studio-babylon` — Tab、`material3dScenes`、薄工作台、`createEngine` / `syncSceneFromDoc`、机位书签、立板/GLB、懒加载 `@babylonjs/core` + loaders。
- 产品决策：**路线 C** — 纯浏览器编辑；**不**嵌桌面 Babylon Editor；**本阶段不**接 Blender。
- 用户需要**现成属性面板** → 采用 `@babylonjs/inspector` 嵌入属性区，而非从零写全属性表单。

## Goals / Non-Goals

**Goals:**

- P0：单选 + `GizmoManager`（position/rotation/scale）+ transform 回写 JSON。
- P0：Inspector 属性网格懒加载、嵌入侧栏宿主。
- 点选与 `metadata.material3dObjectId` 映射（已有 sync 标记）。

**Non-Goals:**

- 多选、编组、骨骼、动画时间轴。
- NME / 粒子 / GUI Editor（P2+）。
- Blender / SceneCode 导出。
- 将 `selectedObjectId` 持久化到项目（除非后续明确要求）。

## Decisions

### 1. Gizmo：`GizmoManager` + `BoundingBoxGizmo` 或 trs 统一 Gizmo

**选择**：`scene.createDefaultXRExperience` 不用；使用 `new GizmoManager(scene)`，`positionGizmoEnabled` / `rotationGizmoEnabled` / `scaleGizmoEnabled` 为 true。`gizmoManager.attachToMesh(mesh)` 对应当前选中用户 mesh；`onDragEndObservable` 读 `mesh.position/rotation/scaling` 写回 doc。

**理由**：官方路径，与 Inspector 共存性好。

**备选**：TransformNode 自研拖拽 — 维护成本高。

### 2. 选择：指针 Pick + 列表双向绑定

**选择**：`scene.onPointerObservable` 或 `mesh.actionManager` Pick 最上层带 `material3dObjectId` 的 mesh；React state `selectedId`。列表点击调用 `selectObject(id)` 并 `Inspector` select（若已开）。

### 3. 属性面板：`@babylonjs/inspector`

**选择**：

```ts
import { Inspector } from '@babylonjs/inspector'

await Inspector.Show(scene, {
  embedMode: true,
  showExplorer: false,
  showInspector: true,
  globalRoot: hostEl,
  overlay: false,
  enableClose: false,
})
```

进入工作台时 `showInspectorPane` 为 true 才动态 `import('@babylonjs/inspector')`；离开 workbench `Inspector.Hide()`。

**版本**：将 `@babylonjs/core` / `loaders` / `inspector` 对齐同一 minor（实现时 bump 到 mutually compatible set，例如统一 8.37.x 或升到 8.49+ 若需 V2 API）。

**Vite**：`manualChunks` 增加 `inspector` chunk。

### 4. sync 与 Gizmo 写回顺序

**选择**：Gizmo 拖动只改运行时 mesh；`onDragEnd` 更新 React `sceneDoc` → `onSceneChange(..., { immediate: true })`（沿用 Studio 即时 persist）。`syncSceneFromDoc` 全量刷新时保留当前 `selectedId`，若对象仍在则重新 `attachToMesh`。

**避免**：sync 中途 dispose 选中 mesh 未重挂 Gizmo — 在 `syncSceneFromDoc` 完成后 callback `reselect()`.

### 5. 文件布局

```
src/material3d/
  gizmoSelection.ts    # pick, attach, dragEnd -> transform
  inspectorPane.ts     # lazy Show/Hide
  Material3dWorkbench.tsx  # 布局：canvas | 侧栏(列表+检视器宿主)
```

## Risks / Trade-offs

- **[Risk] Inspector 体积** → 仅在工作台且用户展开检视器时加载；默认折叠亦可考虑。
- **[Risk] Inspector 改属性不触发 JSON 回写** → P0 以 Gizmo 为 transform 权威；Inspector 改 position 可选监听 `onAfterCheckInputsObservable` 同步（若实现成本高，P0 文档注明「位移请用 Gizmo」并在 spec 后续迭代）。
- **[Risk] React 双挂载 Inspector** → `Show` 前检查 host 子节点为空；unmount 必 `Hide`。

## Migration Plan

- 旧 `material3dScenes` 无 transform 细分字段 → 已有 `DEFAULT_TRANSFORM`，无需迁移。
- 无 API 破坏。

## Open Questions

- P0 是否默认展开检视器（建议默认折叠，按钮「打开检视器」）。
- Inspector 内改 transform 是否与 Gizmo 双向同步（建议 P0 仅 Gizmo→JSON，P0.1 再补 Inspector→JSON）。