# Proposal

## Why

`shot-card-prod-kind` 已按镜分出生图镜 / 出片镜，但右侧 Inspector 仍按旧「画面 / 视频 / 更多」堆字段：出片镜把运动提示词、出片提示词、原生音频、运镜库、出片设置挤在同一 Tab；「更多」混有台词表演与镜头类型。用户难以在出片前一眼看到 **附件是否齐、阻塞在哪**；生图镜参考区仍带视频出片措辞。需要在 **不改生成协议与数据模型** 的前提下，按工位重做信息架构。

## What Changes

- **出片镜 Tab**：`出片` · `音画` · `元数据`（取代「视频 / 更多」二分）。
- **生图镜 Tab**：`画面` · `叙事`（「叙事」取代「更多」中的台词/表演；元数据并入 ⋯ 或 `叙事` 末段折叠）。
- **固定头部**：工位徽章（生图 / 出片）、**就绪条**（模式 + 首条 blocking/warn）、状态 chip **按 prodKind 过滤**（生图镜不展示「视频 未出」等）。
- **出片 Tab 分区顺序**：就绪条 → **附件与槽位（默认展开）** → 本次出片提示词 → 运镜与语义（运动提示词 + 镜头语言库 + 景别/时长折叠）→ 出片设置（折叠）。
- **音画 Tab**：台词音效、表演、表情参考、**原生音频**（自出片设置迁出）。
- **镜头类型**：迁入头部 **⋯ 菜单** 首项（带简短说明），不再埋在页底。
- **生图镜**：参考区文案仅描述 Seedream；分区为 当前画面 → 画面提示词 → 参考 → 出图设置 → 构图标注。
- **底栏**：仍每 Tab 一个主操作（生成画面 / 生成视频）；`元数据` Tab 无底栏主按钮。

## Capabilities

### New Capabilities

- `shot-inspector-layout`：分页结构、就绪条、工位徽章、区块顺序、chip 过滤、镜头类型入口、折叠默认值（与 prodKind 对齐）。

### Modified Capabilities

- `shot-card-prod-kind`：更新 Inspector 可见 Tab 集合与标签名。
- `shot-video-prompt`：出片面板的附件区在 Inspector 中的默认可见性与层级（仍用同一拼装器）。

## Impact

- 前端：`Inspector.tsx`、`inspectorLayout.ts`、`canvasProdMode.ts`（Tab 定义）、`theme.css`；`OutgoingVideoPromptPanel` 可选 props（就绪条联动）。
- 数据：仅 `localStorage` 偏好（Tab id 迁移：`video`→`outgoing`，`more`→`meta`/`narrative`）。
- 验收：扩展 `verify-shot-inspector.mjs`（Tab 集合、chip 过滤、附件区展开、镜头类型菜单位置）。
- **不做**：素材卡 Inspector、批量 Inspector、移动端抽屉；不改 `buildShotVideoRequest` 语义。

## 默认假设（可 review 后改）

- 出片镜三分 Tab；生图镜「更多」改名为「叙事」。
- 镜头类型仅在 ⋯ 菜单切换（非就绪条旁下拉）。
- 配音/口型工位若仍存在于代码，音画 Tab 预留说明行，本变更不恢复已移除能力。
