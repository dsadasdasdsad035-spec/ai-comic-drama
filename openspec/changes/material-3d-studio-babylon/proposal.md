# Proposal

## Why

素材页目前只有 2D 设定卡、视频库与镜头语言，缺少在浏览器里对场景/道具参考做**空间编排与机位预览**的入口；用户只能去创意会话的 Blender 三维专家做交互 3D，门槛高且与「项目级设定」心智分离。需要在素材侧提供基于 Babylon.js 的轻量三维工作台，与既有 Blender 成片管线正交分工。

## What Changes

- 在素材页（`AssetBoard`）新增 **「场景三维」** Tab，与角色/场景/道具/视频/镜头语言并列。
- 引入 `@babylonjs/core`、`@babylonjs/loaders`，**仅在进入场景三维时动态加载**，避免拖慢默认素材页启动。
- 在 `ProjectData` 增加项目级 **`material3dScenes`**：场景列表、场景内对象（立板 / GLB）、机位书签；经 `patchProject` 落库，切换项目隔离。
- MVP 能力：新建/打开/保存三维场景；从场景或道具设定卡（有当前图）生成立板；从 `project.assets` 选择 `.glb` / `.gltf` 导入；Arc 相机轨道交互；保存命名机位书签；可选导出当前视图为项目内 PNG 并登记为素材（不自动发布画布卡）。
- 更新素材 Tab 提示文案：编排与机位在「场景三维」；**成片 MP4 仍走创意 Blender 专家 / 白模**，本变更不替代 `SceneCodeWorkbench`。
- 新增验收脚本 `verify-material-3d-studio.mjs`（Playwright：打开 Tab、建场景、保存持久化、至少一个机位书签）。

不在本变更：

- 嵌入 Pascal Editor 或 IFC/BIM 能力。
- 浏览器内执行 Agent 生成的场景代码或出最终 MP4（`blender-render-host` 不变）。
- Pi Agent 读写三维场景工具（可后续 change）。
- 角色 GLB 绑定、骨骼动画、VGGT 自动写回。

## Capabilities

### New Capabilities

- `material-3d-studio`: 素材页场景三维工作台：项目级场景持久化、设定金立板、GLB 导入、机位书签、视口截图落盘。

### Modified Capabilities

- （无）本次不修改既有 spec 的规范性要求；仅 UI 文案与导航在实现层扩展，行为契约由新 capability 承载。

## Impact

- **前端**：`AssetBoard.tsx`、`src/material3d/*`、`api.ts`（`ProjectData` 类型）、样式与 lazy chunk。
- **依赖**：`package.json` 新增 Babylon 包；Vite 分包与 `studio-entry-latency` 关注点一致。
- **服务端**：复用 `/project-assets` 静态托管与既有 GLB MIME；无新 API（MVP）。
- **桌面**：Electron 壳 WebGL smoke 建议在验收中顺带覆盖。
- **文档/验收**：`verify-material-3d-studio.mjs`；素材 Tab 提示与 README 一句指向（若已有素材说明段落）。