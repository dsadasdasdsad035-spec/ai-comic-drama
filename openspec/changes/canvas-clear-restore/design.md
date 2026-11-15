# Design

## Context

镜头写入只有一条通道：`persistProjectShots(next, deletes)` → `mergeProjectShots(project, shots, deleteShotIds)` → 服务端 `POST /api/project`。服务端在该分支先 `mergeShots` 再 `deleteShots`，最后对整表跑 `pruneDanglingTransitions`，因此"显式删除 + 清悬空转场（含跨集边界）"已经是既有能力，删除不需要新写逻辑。

画布是 `project.json` 的投影，唯一水合入口是 `hydrateCanvasShots`。当前"清空"绕开这条链路，只改本地节点，于是产生了三处需要额外解释的状态：`canvasClearedRef`（运行态）、存档 `cleared`（持久态）、水合时的 `emptyShots` 分支。这三者是"数据还在但不能显示"的代价。

确认交互的约束：Electron 桌面端未实现 `window.prompt`，仓库已有 `PromptDialog` 作为唯一的手打输入弹窗（注释明确要求不要再引入 `prompt`）。项目删除的先例是"手打名字 + 服务端先落快照"，见 `server/project-lifecycle.mjs`。

## Goals / Non-Goals

**Goals:**

- 让"清空"的后果在四个消费面（画布、`read_shots`、Markdown 导出、集目录计数）上一致。
- 让清空的结果只依赖服务端数据，不依赖浏览器存档。
- 用二次确认与服务端快照承担不可恢复的风险。
- 把投影级补丁（`canvasClearedRef`、`cleared`、重建入口）整体移除，减少读者需要理解的状态数。

**Non-Goals:**

- 不引入镜头级撤销、回收站或"最近删除"。
- 不删除媒体文件，不清理镜头对话线程。
- 不处理跨集批量清空或全项目清空。
- 不改变删除选中、Inspector 删单镜、`delete_shots` 工具的行为。

## Decisions

### 1. 复用 `planDeleteShots` + `persistProjectShots`，不新写删除

`clearCanvas` 取当前集全部镜头 id，交给 `planDeleteShots` 得到 `{ next, deletes }`，再走 `persistProjectShots`。

备选是新增一个 `DELETE /api/project/shots` 专用接口。否决理由：`mergeProjectShots` 已经覆盖"显式点名删除 + 清悬空转场 + 返回最新镜头列表"，新接口会与它分叉；而分叉正是画布历史 bug 的来源。副作用是清空与"删除选中"共用同一条写回路径，行为自然一致。

### 2. 服务端落快照，且 fail-closed

在 `deleteShotIds` 分支里，删除前把将被删的镜头行写成快照；写失败直接抛错，不执行删除。沿用项目删除的顺序保证（先快照、后删除），并复用同一个不会被项目删除带走的目录，文件名区分镜头快照。

落地为 `server/project-lifecycle.mjs` 的 `writeShotsSnapshot(root, name, shots)`：写临时文件再 `rename`，文件名 `shots-<项目>-<时间>.json`，与项目快照同目录互不覆盖。

备选是客户端删除前调一次读接口自行保存。否决理由：客户端可能崩溃在中途，且用户可能绕过界面直接打接口；只有服务端在同一请求内"快照→删除"才说得上保证。

### 3. 确认用 `PromptDialog` 手打集号

要求输入当前集标签（如 `E01`），输入不匹配时确认按钮不可用。确认文案写明：本集将被删除 N 镜、素材卡保留、其他集保留、不可撤销、服务端留快照。

为此 `PromptDialog` 增加可选 `validate`：返回 `false` 时确认按钮禁用、回车也不提交（默认不传即保持旧行为，项目删除等现有调用不受影响）。

备选是加强版 `window.confirm`（两句警告）。否决理由：这是一个范围大一个量级的破坏动作，与"删除选中"仅靠确认强度区分不够；手打集号同时消除了"点错集"的可能。

### 4. 退休投影级清空的全部补丁

删除 `canvasClearedRef` 及其解除 effect；存档不再写入 `cleared`，读取时不再传给 `emptyShots`；移除 `rebuildEpisodeCards` 与菜单项、空状态里的重建按钮。

`focusEpisode` 保留（从提示里切集仍需水合目标集），但去掉清空守卫。

备选是保留这套机制并存（真删 + 投影级清空两个动作）。否决理由：两个"清空"会让当前这个困惑变得更糟，且用户已明确要真删语义。

### 5. 空状态提示只描述事实

当前集在项目里没有镜头时，提示写"这一集还没有镜头"，给导入分镜表、新建镜头入口；其他集镜数仍从 `projectShots` 统计，作为切集线索。不再出现"项目里还有 N 镜可重建"这类在真删语义下不成立的话。

### 6. 跨集边界转场交给服务端统一清理

服务端 `pruneDanglingTransitions` 作用在整表，因此其他集里指向被删镜头的 `transition_out` 会被清掉。这不需要前端参与，但必须在确认文案与验收里体现，否则用户会以为转场莫名其妙丢了。

## Risks / Trade-offs

- **不可恢复的误操作** → 手打集号确认 + 服务端快照 fail-closed；快照是唯一兜底，界面不提供恢复入口，需在文档与冒烟里说明快照位置。
- **边界转场被静默清除** → 服务端只 `cleared` 一个计数，前端无从得知清了几条。缓解：确认文案预先说明"指向本集的转场会被清空"；验收断言跨集转场确实被清。
- **旧存档带 `cleared: true`** → 忽略该字段后，这些项目下次进集会正常显示卡片（数据本来就在）。这是预期变化而非回归，但用户可能认为自己"被恢复了"，需在迁移说明里写清。
- **agent 历史对话引用旧镜号** → 清空后旧线程里让 agent 改 `S03` 会得到"第 N 集找不到镜号 S03"。这是正确报错，但需要让错误信息足够可读（已有"找不到镜号"文案）。
- **媒体文件成孤儿** → 删镜不删文件，长期占用空间且无入口清理。当前无引用计数，删文件风险更大，故列为非目标；如要处理，应做成独立的"孤儿媒体清理"能力。

## Migration Plan

无数据迁移。存档结构不变，仅停止写入与读取 `cleared`：旧存档里的 `cleared` 保留在原地但被忽略，下次进入该集按服务端镜头正常水合。回滚只需回退代码——被清空的镜头需要从服务端快照手动恢复，没有自动回滚路径。
