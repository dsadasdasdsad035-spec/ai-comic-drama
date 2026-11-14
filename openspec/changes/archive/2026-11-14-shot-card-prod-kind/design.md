# Design

## Context

```text
现状:
  顶栏 canvasProdMode (localStorage) ──► visibleShotTabs() ──► 整画布 Inspector Tab
  ShotData 一节点 ──► refImage/gen* + videoUrl/vid* 双轨
  ShotLexiconRefBlock ──► effectiveTab === 'visual' && 常需出图模式

目标:
  ShotData.prodKind ──► 单镜 Tab + 主按钮 + 批量队列
  出片卡 ──► 视频 Tab 内镜头语言库 / 运镜参考
```

相关模块：`src/canvasProdMode.ts`、`src/Inspector.tsx`、`src/BoardMenu.tsx`、`src/App.tsx`（`addShot`）、`src/ShotNode.tsx`、`src/shotReferences.ts`、`src/videoPrompt.ts`。

## Goals / Non-Goals

**Goals:**

- 每镜一个 `prodKind`，创建时必选；Inspector/卡脚/批量只暴露对应主产线。
- 水合规则可重复、可测；双轨遗留 → `video`。
- 运镜 catalog 在出片卡可编辑，与 `shot-video-prompt` 拼装一致。

**Non-Goals:**

- 首期不做「生图卡一键转出片卡」向导（tasks 可留可选）；首期不做 Agent 自动拆双卡。
- 不迁移/删除遗留静帧字段；出片卡上的 `refImage` 只读展示或作构图输入说明，不触发主 Seedream。
- 不修改转场边、素材卡 prod 语义。

## Decisions

### D1：`prodKind` 字段

- **选择**：`prodKind?: 'image' | 'video'`，缺省由水合推断；写入项目后与镜号同级持久化。
- **UI 展示**：画布节点 `data` 或角标可选「图」「片」弱化标识（非必须首期）。

### D2：创建镜头 UX

- **选择**：`BoardMenu` 新增子项或小型对话框：「生图镜头」「出片镜头」；`insertShotAfter` 继承相同交互，默认类型 **与上一镜相同**（减少连点）。
- **备选**：创建后 Inspector 首屏强制选类型 — 否决（易漏、与「正式镜头」规则冲突）。

### D3：Inspector Tab

- **选择**：`visibleShotTabs(prodKind)` 取代 `visibleShotTabs(canvasProdMode)`；`coerceShotTab` 读当前镜 `prodKind`。
  - `image` → `画面 | 更多`
  - `video` → `视频 | 更多`
- **声音 Tab**：仍不出现（与 `canvas-prod-modes-no-voice` 一致）。

### D4：全局 `canvasProdMode`

- **选择**：删除对 Inspector 的控制；删除 localStorage 键或保留键名仅当实现「筛选」时复用。
- **筛选（可选）**：顶栏改为「全部 | 仅生图 | 仅出片」只影响画布节点 opacity/列表，不写 `prodKind`。

### D5：互斥与批量

- 批量出图：跳过 `prodKind === 'video'`。
- 批量出片 / 多选条：跳过 `prodKind === 'image'`。
- `ShotNode` 卡头生成：`prodKind === 'video'` 时 disabled + tooltip（已有类似逻辑，改为读镜字段）。

### D6：水合（迁移）

优先级从高到低：

1. `videoUrl` 或 `vidState` 为完成/进行中 → `video`
2. 否则若 `refImage` 或候选图或 `genState` 有痕迹且无 (1) → `image`
3. 完全空白 → `image`（与 Agent 默认一致）

**双轨**（(1) 与 (2) 同时）：**`video`**。可选 UI：出片卡「更多」或视频 Tab 提示「画面成果仅作参考」。

### D7：镜头语言库

- **选择**：`ShotLexiconRefBlock` 迁到出片 Inspector（视频 Tab 内「镜头参数」或运镜参考折叠区）；`motionLexiconAsRef` 仅对 `video` 可编辑。
- 生图卡：不展示运镜连线开关（或只读说明「请使用出片镜」）。

### D8：定帧 → 动镜

- **选择**：文档 + 空态文案引导「从生图卡连线到出片卡」；不自动 `insertShotAfter` 出片卡。
- **Follow-up**：`convertProdKind` API（image→video 保留 prompt 映射）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 验收脚本大量 `prod-mode-toggle` | 本变更 tasks 含脚本改写 |
| 与未完成的 `canvas-prod-modes-no-voice` 冲突 | proposal 标明 supersedes；合并 R2/声音迁移到同一 PR 或先 rebase |
| 用户误以为出片卡不能看图 | 卡预览仍显示 `refImage`；文案区分「参考」与「主出图」 |
| 导入表格无类型列 | 默认 `image`；有 `video_prompt` 无图时可选手工改出片卡 |

## Migration Plan

1. 部署后首次加载项目：内存水合 `prodKind`，保存项目时写回字段。
2. 不在单次打开时批量 rewrite 全库（避免未保存惊跳）；可选「项目设置 → 重写全部 prodKind」调试入口非必须。

## Open Questions

- Agent `submit_shots` 是否后续增加 `prod_kind` 列（本期默认 image）。
- 顶栏是否保留筛选控件（产品默认：不保留，减少概念）。
