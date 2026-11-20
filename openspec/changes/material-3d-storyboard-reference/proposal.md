# Proposal

## Why

场景三维已能摆放立板/GLB 与保存机位，但产品定位是**分镜参考**（给人与 Blender 专家对齐布局），而非浏览器内成片。当前仅靠 Gizmo 与可选 Babylon 检视器，缺少**可落库的数字变换**、**预览环境**与**机位/场景导出**，检视器改动也不会进入 `material3dScenes`，容易让用户误以为「调了材质就保存了」。需要在不挑战 Blender 成片分工的前提下，补齐分镜交付物。

## What Changes

- 在「层级」侧为选中对象提供 **变换属性面板**（位置/旋转/缩放数字输入），与 Gizmo 双向同步并写入 `material3dScenes.objects[].transform`。
- 对象级分镜字段：`label`（列表显示名）、`locked`（禁止 pick/Gizmo）；立板可选 `billboardSize`（宽高，替代硬编码平面尺寸）。
- 场景级 **预览环境** `environment`（背景色、地面尺寸/颜色/显隐、环境光/主光强度），仅影响浏览器预览与截图，不与 Blender 灯光 1:1。
- 工作台新增 **「场景」** 侧栏分区（或与机位并列 Tab），编辑上述环境字段并持久化。
- **机位导出**：机位 Tab 提供 **复制 Markdown 摘要**（机位 + 对象清单）与 **下载 JSON**（`schemaVersion` + `purpose: storyboard-reference`），供粘贴镜头备注或供 Blender 专家/脚本读取。
- 可选：保存机位时提示「同时截视口 PNG」与现有一致（不强制）；Inspector 区标注 **会话内有效、不写入项目**。
- **不做**：Inspector 材质落库、动画/骨骼、机位自动写回画布 `shots`、浏览器 MP4。

## Capabilities

### New Capabilities

- （无）延续 change 系列中的 `material-3d-studio` 能力边界；本变更以 delta spec 扩展规范性要求（主规格尚未归档至 `openspec/specs/`）。

### Modified Capabilities

- `material-3d-studio`：新增变换属性面板、对象/场景分镜字段持久化、预览环境、机位 Markdown/JSON 导出之要求。

## Impact

- **前端**：`src/material3d/material3dTypes.ts`、`Material3dWorkbench.tsx`、侧栏子面板、`syncSceneFromDoc.ts`、`createEngine.ts`；可能新增 `transformPanel.ts` / `exportStoryboard.ts`。
- **数据**：`Material3dScene` / `Material3dObject` 向后兼容扩展；旧项目缺省字段按默认值解释。
- **验收**：扩展 `verify-material-3d-studio.mjs` 或新增脚本（数字改 transform 刷新仍在；导出 JSON 含 cameras）。
- **Non-Goals**：Blender 自动导入机位、Pi Agent 读写场景、画布镜头字段自动填充。