# Tasks

## 1. 真相源与计数

- [x] 1.1 `src/App.tsx` 的 `otherEpCounts` 改为按 `projectShots` 的 `episode` 聚合镜数并排除当前集；验证：清空画布后该项仍返回其他集的集号与镜数，不再恒为空
- [x] 1.2 新增当前集镜数与卡片数派生值（本集项目镜数、本集 `shotId` 节点数），供提示与菜单共用；验证：两值在清空前后分别反映项目镜数不变、卡片数归零

## 2. 重建动作

- [x] 2.1 实现 `rebuildEpisodeCards()`：本集无项目镜头时提示先导入或新增并返回，否则调 `hydrateCanvasShots(projectShots, { episode: epNo, fit: true })`；验证：清空后触发，本集卡片数量回到该集镜数，`project.json` 镜头数量与字段不变
- [x] 2.2 提示里的集切换改为 `focusEpisode(no)`：先切集号，仅当该集在画布上没有 `shotId` 节点才水合；验证：清空后点其他集能出现卡片，而已有卡片的集切换时不重建节点、卡片位置不变

## 3. 入口与可用性

- [x] 3.1 `src/BoardMenu.tsx` 新增重建项（`onRebuild` 与集号/镜数徽标），在「画布」分组内、适配视图之前；验证：菜单项文字带当前集与镜数，本集无镜头时禁用并给出原因标题
- [x] 3.2 画布空状态提示改为「本集项目有镜头但画布无卡片」时出现，含本集镜数与「重建本集卡片」按钮，其他集计数非空时一并列出；验证：清空后提示出现且按钮可重建；本集在项目里也无镜头时换成「先导入或新增镜头」且不渲染重建按钮

## 4. 文案与语义区分

- [x] 4.1 清空确认框改为说明移除的是画布卡片与连线、镜头数据不变、之后可用「重建本集卡片」恢复；验证：确认框文案不再出现「推」的表述，且不承诺位置恢复
- [x] 4.2 菜单清空项徽标由「不可撤销」改为「可重建」，标题注明只动画布；清空后 toast 说明镜头数据未改动并指向重建入口；验证：三处文案与实际行为一致，与删除选中的真删措辞不混用

## 5. 端到端验收

- [x] 5.1 新增 `verify-canvas-clear-restore.mjs`：进入有镜头的集 → 清空 → 断言提示出现且含本集镜数 → 点重建 → 断言卡片数等于镜数且顺序连线存在 → 刷新后卡片仍在；验证：脚本对 dev server 跑通并输出全绿
- [x] 5.2 同脚本覆盖「清空后不重建直接刷新仍为空」与「清空后切其他集能出现卡片」两条路径；验证：两条断言在脚本内通过
- [x] 5.3 回归既有画布验收 `verify-canvas.mjs`、`verify-assets.mjs`、`verify-refs.mjs`；验证：三个脚本全部通过，确认提示条件放宽与水合改动没有影响卡片渲染、素材连线与角色参考

## 6. 清空持久化（重新选集不得恢复）

- [x] 6.1 新增 `canvasClearedRef`，`enterBoardEpisode` 与 `focusEpisode` 在清空状态下只切集号、不水合；验证：清空后返回集列表再进同一集，卡片数仍为 0 且空状态引导在
- [x] 6.2 加载项目时按存档 `cleared` 同步标记，无项目分支重置；重建 / 新增 / 插入 / 导入让卡片重新出现时自动解除；验证：重建后存档 `cleared` 转 `false`，再切集恢复自动水合
- [x] 6.3 同步修正 spec 与 design 的清空语义（改「重新进入即恢复」为「保持为空，仅显式动作恢复」）；验证：`openspec validate canvas-clear-restore --strict` 通过
- [x] 6.4 扩展 `verify-canvas-clear-restore.mjs`：覆盖「重新选集仍为空」「切集不绕过清空」「重建后恢复自动水合」；验证：脚本全量断言通过

## 7. 清空改为真删（语义反转）

上一轮 1-6 组建立在"清空只动画布投影"上，真删之后其中「重建本集卡片」「`canvasClearedRef`」「存档 `cleared`」三套机制全部失效。本组负责实现真删并退休这些机制，已完成的历史保留不动。

- [x] 7.1 服务端在 `POST /api/project` 的 `deleteShotIds` 分支落镜头快照：先写临时文件再 rename，写失败则不删除并返回可读错误；快照落在不随项目删除清理的目录，文件名可区分镜头级；验证：`verify-shots-delete-snapshot.mjs` 断言快照文件存在、内容含被删镜头、且写失败时项目镜头未变
- [x] 7.2 `clearCanvas` 改为取当前集全部镜头 id → `planDeleteShots` → `persistProjectShots(next, deletes)`；验证：清空后项目里该集镜头为 0，其他集镜数与角色/素材/设定卡不变，画布只剩素材卡
- [x] 7.3 清空确认改用 `PromptDialog` 要求手打当前集号，输入不符时确认不可用，文案写明镜数、素材卡保留、其他集不受影响、不可撤销；验证：错误输入下项目镜头不变，正确输入才删除
- [x] 7.4 移除投影级清空的补丁：删 `canvasClearedRef` 及其 effect、存档不再写 `cleared`、加载不再传 `emptyShots`、移除 `rebuildEpisodeCards`、`focusEpisode` 去掉清空守卫；验证：`rg canvasClearedRef` 与 `rg emptyShots` 无残留，进集与切集照常水合
- [x] 7.5 `src/BoardMenu.tsx` 移除「重建本集卡片」，清空项改为表达范围与不可恢复（当前集 · N 镜），不再出现「可重建」；验证：`verify-boardmenu.mjs` 通过，菜单里无重建项
- [x] 7.6 空状态提示改为「这一集还没有镜头」+ 导入分镜表 / 新建镜头入口，其他集镜数仍从 `projectShots` 统计；验证：清空后提示出现且无重建按钮，切到有镜头的集能看到卡片
- [x] 7.7 重写 `verify-canvas-clear-restore.mjs` 为真删语义：清空后 `read_shots` 不返回该集、导出 md 无该集内容、刷新与重启 dev server 后仍为空、服务端快照存在、边界转场被清、素材卡保留；验证：脚本全绿
- [x] 7.8 连带回归 `verify-canvas.mjs`、`verify-creative-export.mjs`、`verify-storyboard-md-export.mjs`、`verify-agent-project-cache.mjs`、`verify-material-tools.mjs`；验证：全部通过，确认读工具与导出在新语义下无回归
- [x] 7.9 同步 proposal / spec / design 的真删语义并校验；验证：`openspec validate canvas-clear-restore --strict` 通过

## Workflow follow-up

- 归档前确认 `docs/creative-studio.md` 之外是否有画布操作说明需要同步（当前仓库无画布操作手册，若无则跳过）。
