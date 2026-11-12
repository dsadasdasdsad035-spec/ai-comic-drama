# Tasks

## 1. 统一水合与写回

- [x] 1.1 从 `App.tsx` 抽出 `hydrateCanvasShots(shots, { episode, fit })`，内部只用 `buildShotNodes` + `chainEdges` / `repairTransitionEdges`，按 `shotId` 复用节点与位置，保留其他集节点与素材卡；用 esbuild 打包后断言同一批 shots 连续水合两次得到相同节点 id 与位置
- [x] 1.2 项目加载 effect 改调 `hydrateCanvasShots`，删除重复的节点构建分支；验证 `verify-canvas.mjs` 通过，且切换两个项目后画布只显示各自镜头
- [x] 1.3 删除 `pushShotsToCanvas` 与页脚「生成到画布」按钮；验证 `rg "pushShotsToCanvas|生成到画布" src` 无结果且 `npm run build` 通过

## 2. 画布导入即落库

- [x] 2.1 把 `IntakeDialog` 的宿主从 `ShotTable` 迁到画布，输入改为 App 的项目快照（`shots` / `episodes` / `chars`）；验证新增 `verify-canvas-intake.mjs`：画布点导入、上传 CSV、预览出现、确认后画布出现卡片
- [x] 2.2 实现 `applyShotImport(result)`：镜号唯一校验 → `mergeProjectShots` → 更新项目快照 → 水合 → `fitView`；失败时不改快照与节点并保留对话框；验证 `verify-canvas-intake.mjs` 用 mock 500 断言画布与项目都不变
- [x] 2.3 保证导入幂等：同一文件连续导入两次后镜数与画布节点数不变；验证 `verify-canvas-intake.mjs` 的重复导入用例
- [x] 2.4 更新 README 的「导入已有文本」章节：入口、落库与水合语义改为画布；验证文档中的操作步骤按实际界面走一遍

## 3. 空首帧只拦生成

- [x] 3.1 水合路径不再读取首帧空白统计，只有 `keyframe_prompt` 的镜头也生成节点与顺序边；验证 `verify-canvas-intake.mjs` 导入仅含镜号与描述的表后，节点数等于该集镜数
- [x] 3.2 保留生成入口拦截：对空首帧镜头点出图仍被阻止并提示；验证 `verify-shot-inspector.mjs` 的空提示词用例通过

## 4. 画布挂载分镜 Agent

- [x] 4.1 用 `board-with-chat` + `WorkbenchChatAside`（`surface: 'shots'`、`data-shots-chat`）+ `SkillChat` 在画布挂载分镜助手；验证 `verify-workbench-chats.mjs` 中镜头表段落改指画布后通过
- [x] 4.2 实现画布 shots adapter：`ownDraft` 读当前集镜头，`applyDraft` 走 `mergeShotsDraft` / `mergePromptDraft` / `applyJoinsToShots` 后落库并水合，`saveMode` 改为立即落库；验证 `verify-agent-draft.mjs` 与 `verify-workbench-builtin-actions.mjs` 通过
- [x] 4.3 线程键保持项目 + 集，切集后恢复对应线程且不写入其他集；验证 `verify-workbench-chats.mjs` 的切集用例
- [x] 4.4 更新 README 的工作台聊天章节：镜头表改为画布，写明保存语义从「显式保存」改为「写回即落库」；验证文档描述与聊天回执文案一致

## 5. 集级摘要、目标时长与补齐锚点

- [x] 5.1 App 增加 `episodes` 状态（项目加载时保存），画布用 `WorkbenchBar` 显示镜数、总时长 vs 目标、缺首帧与缺锚点计数；验证新增 `verify-canvas-shots-bar.mjs` 断言切集后摘要更新
- [x] 5.2 目标时长编辑经 `setEpisodeTargetSeconds` + `patchProject` 写入当前集；验证 `verify-canvas-shots-bar.mjs` 重读项目断言只有该集变化
- [x] 5.3 把画布「补齐锚点」动作接到既有 `auditKeyframePrompt` 补齐逻辑，只作用于当前集并回报镜数；验证 `verify-canvas-shots-bar.mjs` 断言提示词追加锚点且 `handEdited` 增加
- [x] 5.4 更新 README 的镜头表章节：删除表格内编辑与保存描述，改写为画布单镜、集摘要与 Agent；验证文档中没有「镜头表」作为编辑入口

## 6. 正式镜头增删插

- [x] 6.1 `addShot` 改为生成带 `E{集}-{镜号}` 的正式镜头并落库水合；验证新增 `verify-canvas-shots-crud.mjs`：新增后 `project.json` 与画布各多一镜
- [x] 6.2 支持在某镜之后插入，镜号取下一个未占用值并重建该集顺序边；验证 `verify-canvas-shots-crud.mjs` 插入用例
- [x] 6.3 删除镜头走确认 + `mergeProjectShots(..., deleteShotIds)`，同步移除节点、边与 `syncedRef` 快照，并清除上一镜 `transition_out`；验证 `verify-canvas-shots-crud.mjs` 断言删除后项目与画布一致、防抖不复活
- [x] 6.4 改镜号按「新镜 + 删旧镜」处理并在写入前做集内唯一校验，冲突时提示且不写入；验证 `verify-canvas-shots-crud.mjs` 重号用例

## 7. 下线镜头表

- [x] 7.1 `view` 去掉 `'table'`，删除导航按钮与 `ShotTable` 渲染分支；验证 `rg "view === 'table'|'table'" src/App.tsx` 无视图残留且 `npm run build` 通过
- [x] 7.2 删除 `ShotTable.tsx`、`ShotTableJoinRow.tsx`、`shotTableUx.ts` 与仅表格使用的样式；验证 `npm run build` 通过、`node verify-canvas.mjs` 通过
- [x] 7.3 清空空集与引导文案中的「先在镜头表拆镜」，设置页环节标签改为「画布 · 拆镜」；验证 `rg "镜头表" src README.md` 只剩历史说明或零命中
- [x] 7.4 更新 README 的导航、视图列表与验收命令；验证文档中的视图列表与顶栏一致

## 8. 集成验收

- [x] 8.1 跑 `node verify-all.mjs`（至少 `canvas`、`text-intake`、`workbench-chats`、`shot-inspector`、`canvas-intake`、`canvas-shots-crud`、`canvas-shots-bar`）并全部通过
- [x] 8.2 手动走通：新建/选择项目 → 画布导入只有结构的分镜表 → 卡片与连线出现 → 单镜改字段并出图 → Agent 拆镜 → 插入与删除镜头 → 转场面板改接缝；逐步记录观察结果
- [x] 8.3 与进行中的 `shot-table-transition-joins` 对齐接缝场景的宿主（改为画布连线与转场面板，或先归档该变更），并跑 `openspec validate canvas-only-shots-workbench --strict`

## Workflow follow-up

- 评审通过后归档本变更，并按主规格合并顺序处理 `shots-workbench`、`manual-row-editing`、`workbench-text-intake`、`workbench-shell`、`project-context` 的 delta。
- 归档后复核新增主规格 `canvas-shots-workbench` 的 Purpose 与场景是否完整。
