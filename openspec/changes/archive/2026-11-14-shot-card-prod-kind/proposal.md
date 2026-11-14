# Proposal

## Why

画布顶栏「出图 | 出片」是**全局**工位切换：同一时刻所有分镜卡共用一种 Inspector Tab 集合，导致运镜/镜头语言库 UI 只能挂在「画面」Tab，而出片用户必须先切回出图模式才能配置 `reference_video` 来源。与此同时，单张 `ShotData` 同时承载静帧产线（`refImage`、`gen*`）与出片产线（`videoUrl`、`vid*`），产品语义是「一镜两条流水线」，与已拆分的 Inspector 四页、卡上仅出图等改造方向冲突。

用户已确认：**生图卡与出片卡互斥**——创建时选定一种生产；**双轨遗留数据一律按出片卡**水合。

## What Changes

- 分镜实体增加 **`prodKind: 'image' | 'video'`**（持久化到项目镜头 JSON）；新建/插入镜头时 MUST 让用户选择「生图镜头」或「出片镜头」。
- **互斥主路径**：`prodKind === 'image'` 的镜头 MUST NOT 提供「生成视频」主操作（Inspector 视频 Tab 主底栏、卡上/批量出片对该镜禁用或隐藏）；`prodKind === 'video'` 的镜头 MUST NOT 提供「生成画面」主操作（卡头生成、画面 Tab 吸底 Seedream、批量出图对该镜排除）。
- Inspector Tab 与能力 **按当前选中镜的 `prodKind` 决定**，不再由顶栏全局 `canvasProdMode` 过滤整画布。
- **废弃或降级**顶栏 `出图 | 出片` 全局切换：实现时删除 `canvasProdMode` 对 Tab 的控制；若保留控件则仅作画布筛选/高亮（SHOULD NOT 改变单镜能力）。
- **镜头语言库**（白膜运镜 catalog、`lexiconRefKey`、`motionLexiconAsRef`）在 **出片卡** 的 Inspector「视频」侧暴露（镜头参数或运镜参考区），MUST NOT 要求先切全局出图再在画面 Tab 配置。
- **水合迁移**（打开项目时补字段，不写回除非用户保存）：
  - 有 `videoUrl` 或明显出片完成态 / `vid*` 痕迹 → `video`
  - **同时**存在静帧成果与出片痕迹 → 仍 **`video`**（画面字段保留作参考/首帧，非主出图路径）
  - 仅有静帧数据、无出片痕迹 → `image`
  - 空白镜缺字段 → 创建语义不适用；导入/Agent 写回缺字段时 **默认 `image`**，除非行内标明视频生产（后续扩展）
- **定帧 → 动镜**：默认同卡 Seedream→Seedance 不再成立；用户 **另建出片卡** 或 **显式转换类型**（本变更 spec 先要求拆卡连线；类型转换可作 follow-up task）。
- **不做**：改转场边、素材卡、角色卡的生产语义；不把 `prodKind` 绑到 Agent `shots-v1` 必填列（首期 Agent 落库走默认 `image` + 用户改类型）。

## Capabilities

### New Capabilities

- `shot-card-prod-kind`：分镜卡生产类型、`prodKind` 持久化、创建选择、互斥工位、遗留水合规则。

### Modified Capabilities

- `canvas-shots-workbench`：新增/插入镜头含类型选择；全局模式不再决定单镜能力。
- `shot-still-image`：静帧生成范围收窄为 `prodKind === 'image'`。
- `shot-video-prompt`：出片工位与运镜语言库范围限定为 `prodKind === 'video'`；出片卡上配置 lexicon。
- `storyboard-shot-card`（若已归档主 spec）：卡头生成与模式提示与 `prodKind` 一致。

### Supersedes / 接缝

- 进行中变更 `canvas-prod-modes-no-voice` 里的 **`canvas-prod-mode` 全局 Tab 显隐** 在本变更实施后 **作废**；保留其中「无声音 Tab、台词在更多、R2 播放」等与 `prodKind` 正交的部分，实施时按 tasks 合并或拆 PR。
- 与 `camera-moves-whitebox-lexicon` 对齐：运镜参考 **默认不连线** 不变，但 **配置入口迁到出片卡**。

## Impact

- **数据**：`ShotData` / `types.ts`、`project.shots[]` JSON；水合函数（`App` 或 `hydrate` 模块）。
- **前端**：`BoardMenu` / 新增镜头 UI、`Inspector.tsx`、`canvasProdMode.ts`（删除或改为筛选）、`ShotNode.tsx`、批量出图/出片队列、`visibleShotTabs` 改为 per-shot。
- **验收**：更新 `verify-shot-inspector.mjs`（去掉依赖全局 `prod-mode-toggle` 切换 Tab 的路径，改为按镜类型断言）；新增或扩展脚本断言互斥与迁移。
- **文档**：`README` 画布生产一节改为「按镜类型」。
- **BREAKING（行为）**：老项目双轨镜迁为出片卡后，主路径不再提供 Seedream；用户需新建生图卡或接受画面仅作参考。

## 用户已确认

- 生图 / 出片 **互斥**（一卡一种主生产）。
- 遗留 **双轨 → 出片卡**。
- 顶栏全局模式 **去掉或仅筛选**（与互斥一致，实施取「去掉 Tab 控制」）。
