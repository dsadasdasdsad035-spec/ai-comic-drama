# Design

## Context

动机见 `proposal.md`。现状要点：

- 素材页 `AssetBoard` Tab：`character | scene | prop | video`，叠加镜头语言 overlay；无 WebGL 依赖（`package.json` 无 three/babylon）。
- 成片 3D：`SceneCode` + 服务端 `blender-render-host`；`SceneCodeWorkbench` 在镜头语言白模，不属于素材 Tab。
- 角色「3D 预览」为八角度 2D 转盘（`character-preview-3d`），刻意不消费 GLB。
- 服务端已对 `.glb` / `.gltf` 设 MIME（`server/index.mjs`）。
- 项目延迟敏感：多处 change 强调 lazy 与分包（如 `studio-entry-latency`）。

## Goals / Non-Goals

**Goals:**

- Babylon.js 薄封装：`Engine` + `Scene` + ArcRotateCamera + 基础灯光/网格地面。
- `material3dScenes` 项目 JSON 为唯一真相源；工作台 UI 与持久化分离。
- 与 `DesignSheet`、`ProjectAsset` 只读引用，不复制图片二进制。
- `verify-material-3d-studio.mjs` 覆盖持久化与机位书签。

**Non-Goals:**

- Pascal Editor、BIM、IFC、点云。
- 执行用户/Agent 任意 JS 场景代码（区别于 `sceneCodeSanitize` 链路）。
- Blender 联机预览、浏览器 MP4。
- Phase 2：Pi `material3d` 工具、机位写回、角色 billboards（留后续 change）。

## Decisions

### 1. Babylon.js 而非复用 Three / 嵌 Pascal

**选择**：`@babylonjs/core` + `@babylonjs/loaders`，React 中用 ref 挂载 canvas，`useEffect` 管理 `engine.dispose()`。

**理由**：与已废弃的浏览器 Three 渲染链无关；glTF、Gizmo、Inspector 社区成熟；Pascal 域模型与 `ProjectData` 不对齐，嵌入成本过高。

**备选**：`@react-three/fiber` — 更贴 React，但仓库对 Three 有「成片废弃」历史叙事，Babylon 边界更清晰。

### 2. 数据模型挂在 `ProjectData.material3dScenes`

**选择**（TypeScript 示意）：

```ts
export type Material3dVec3 = { x: number; y: number; z: number }
export type Material3dBookmark = {
  id: string
  label: string
  alpha: number
  beta: number
  radius: number
  target: Material3dVec3
}
export type Material3dObject =
  | { id: string; kind: 'billboard'; designId: string; transform: ... }
  | { id: string; kind: 'gltf'; assetUrl: string; transform: ... }
export type Material3dScene = {
  id: string
  name: string
  designRefs: string[]
  objects: Material3dObject[]
  cameras: Material3dBookmark[]
  updatedAt: string
}
```

**理由**：与 `designs`、`lexiconWhitebox` 并列的项目级字段；`patchProject` 局部更新即可。

**备选**：每个 `DesignSheet` 内嵌三维片段 — 多场景难管理，且与「编排多个设定」冲突。

### 3. 立板实现

**选择**：`BABYLON.MeshBuilder.CreatePlane` + `StandardMaterial` + `Texture`；纹理 URL 走现有 `/project-assets`；`missing` Set 与 `onImageMissing` 一致拒绝。

**理由**：零 AI 成本，直接复用场景/道具设定图。

### 4. 懒加载与分包

**选择**：

- `AssetBoard`：`const Material3dStudio = lazy(() => import('./material3d/Material3dStudio'))`
- Babylon：`await import('@babylonjs/core')` 于 `Material3dWorkbench` mount 内
- Vite `manualChunks` 可选：`babylon` 单独 chunk（实现期在 `vite.config` 验证 bundle 报告）

**理由**：满足 spec「按需加载」。

### 5. 截图导出

**选择**：`Tools.CreateScreenshotUsingRenderTarget` 或 `engine.createScreenshot` → `fetch` POST 复用既有项目图片上传路径（与素材上传同一约束：png、大小上限），`patchProject` append `assets`。

**理由**：不新增 REST；与 `asset-media-ingest-hub` 心智一致（登记为项目素材，不自动画布卡）。

### 6. UI 结构

**选择**：

```
material3d/
  Material3dStudio.tsx      # 列表 + 新建/删除场景
  Material3dWorkbench.tsx # 画布 + 侧栏（对象/机位/导入）
  material3dTypes.ts
  createEngine.ts           # 初始化/销毁
  syncSceneFromDoc.ts       # JSON -> Babylon 节点
  captureViewport.ts
```

`AssetBoard`：扩展 `MaterialTab` 为 `... | 'studio3d'`，Tab 按钮与 `asset-tabs-hint` 文案更新。

## Risks / Trade-offs

- **[Risk] Babylon 包体积** → 仅 lazy + 独立 chunk；不在 App 根 import。
- **[Risk] WebGL 在 Electron 失败** → `verify-material-3d-studio.mjs` 在 `npm run dev` 跑；桌面手册注明需 GPU。
- **[Risk] 大图立板显存** → 纹理 max 尺寸与设定图现状一致；超大图可选 downscale（非 MVP）。
- **[Risk] 与 Blender 白模入口混淆** → Tab hint 与工作台顶栏固定一句分工说明。

## Migration Plan

- 旧项目无 `material3dScenes`：读作 `[]`，无需迁移脚本。
- 回滚：移除 Tab 与字段读取；已保存 JSON 保留在 project 文件中，不删用户数据。

## Open Questions

- 机位书签是否在 MVP 导出为 JSON 文件供手动粘贴到镜头备注（spec 未强制；任务可标可选）。
- 是否在场景卡列表加「在三维中打开」快捷按钮（UX 增强，MVP 可在工作台内选手动添加设计）。