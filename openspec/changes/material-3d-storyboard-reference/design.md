# Design

## Context

场景三维以 `material3dScenes` 为布局真相源，`syncSceneFromDoc` 全量重建用户节点；Gizmo 拖拽已写回 `transform`。检视器嵌入 Babylon Inspector，运行时改动不进入 JSON。产品方向定为**分镜参考**：布局 + 机位 + 截图，成片在 Blender 专家。见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 选中对象的 transform 可通过数字面板编辑并与 Gizmo 一致落库。
- 分镜向元数据（显示名、锁定、立板尺寸）进 JSON，刷新可恢复。
- 场景预览环境可配置并落库，影响视口与 PNG 截图。
- 机位可导出 Markdown（剪贴板）与 JSON（下载），便于人类与 Blender 侧消费。

**Non-Goals:**

- Inspector 属性写入 project。
- 与 Blender 灯光/材质数值一致。
- 机位自动写入画布 `shots` 或 Agent 工具。

## Decisions

### 1. 数据模型扩展（向后兼容）

```typescript
type Material3dEnvironment = {
  background?: string          // #rrggbb
  ground?: { size?: number; color?: string; visible?: boolean }
  light?: { ambient?: number; directional?: number }  // 0–2 归一化倍数
}

// Material3dObject 公共可选字段
label?: string
locked?: boolean

// billboard only
billboardSize?: { width: number; height: number }  // 默认 3.2 / 1.8
```

缺省：无 `environment` 时使用当前 `createEngine.ts` 硬编码；无 `billboardSize` 用 3.2×1.8；`locked` 默认 false。

### 2. 变换面板与 Gizmo

- 面板挂在「层级」Tab，仅 `selectedId` 有值时启用。
- 编辑 `onBlur` 或防抖 300ms 写 `patchScene`；写后触发既有 `refreshMeshes` 或仅 `applyTransform` 到节点（优先**直写节点 + 落库**，避免整场景 reload 丢 Inspector 状态）。
- 旋转 UI 以**度**展示，存 JSON 仍为弧度（与 Babylon `rotation` 一致）。
- 快捷：「贴地」（立板保持现有 minY 规则；GLB 用包围盒底对齐地面 y=0，MVP 可对 root position.y 做简化估算）。

### 3. 预览环境

- `createEngine` 读后创建；`environment` 变更时增量更新 `clearColor`、地面 mesh、灯强度，不必重建 Engine。
- 第四侧栏 Tab「场景」：颜色选择器 + 数字滑块；不提供 HDRI。

### 4. 机位导出

- **Markdown**：标题、场景名、每条机位 `label` + alpha/beta/radius/target，对象表（label/kind/position 一行）。
- **JSON**：`{ schemaVersion: 1, purpose: 'storyboard-reference', sceneName, updatedAt, cameras, objectsSummary }`；`objectsSummary` 不含 assetUrl 亦可，但 SHOULD 含 kind 与 transform。
- 前端纯客户端生成，无新 API。

### 5. Inspector 文案

检视器区块上方固定一句：「高级调试，修改不保存到项目」。

## Risks / Trade-offs

- **[Risk] 数字改 transform 触发全量 sync** → 优先节点直写；全量 sync 仅在换资产 URL 等必要时。
- **[Risk] GLB 贴地无统一 bounding** → MVP 用 root 节点 y=0，文档注明不精确。
- **[Risk] 环境光与截图白平衡** → 接受「参考级」；文案不写「与成片一致」。

## Migration Plan

- 旧 `material3dScenes` 无新字段：读时默认，无需迁移脚本。
- 回滚：忽略新字段即可，数据保留在 JSON 中。

## Open Questions

- 是否在 JSON 导出中附带 `designRefs` 与设定卡名称（便于 Blender 专家对照）— 可在 tasks 中作可选任务。