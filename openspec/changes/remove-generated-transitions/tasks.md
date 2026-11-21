# Tasks

## 1. 数据层收敛

- [x] 1.1 `src/types.ts` 删除生成转场专用类型（`TransitionGenerated`、`TransitionKeyframe`、`TransitionVideo`、`TransitionBoundary`、`TransitionBridging`、`BoundarySource`、`TransitionVideoPromptOverride` 引用），`TransitionOut` 只保留 `to` / `mode` / `effect` / `meta`；验证：`npx tsc --noEmit` 报出的剩余错误点全部落在本次要改的文件里。
- [x] 1.2 `src/transition.ts` 的 `normalizeGenerated` 删除，`normalizeTransitionOut` 只输出 `{ to, mode: 'effect', effect, meta? }` 并在 JSDoc 注明「`mode` 为兼容旧存档保留，写入恒为 effect」；验证：`node -e` 用含 `generated` 的旧对象跑 `normalizeTransitionOut`，输出无 `generated` 键。
- [x] 1.3 `src/transition.ts` 的 `resolveJoin` 删除 `mode === 'generated'` 分支与 `JoinResolution` 的 `generated` 变体，删除 `generatedFade` / `generatedClipSeconds` / `hasGeneratedVideo`；`transitionSummary` 收敛为只返回「预设名 + 时长」；验证：纯函数对 effect 与缺省输入返回 `mode: 'effect'`，对过短输入返回 `mode: 'cut'`。
- [x] 1.4 `src/editList.ts` 删除生成插入分支与 `EditItem.kind: 'transition'`、`media`、`trimTo`、`stale`、`fallback` 字段，`EditList.transitions` / `stale` 移除；验证：两镜与 0.5s 叠化输入得到 `total = 5.5`、`items.length = 2`、无 `inactive`。
- [x] 1.5 `src/shotSync.ts` 的 `transitionOut` 双向映射保持不变（旧字段可读），并确认写回路径经 `normalizeTransitionOut` 后不再产生 `generated`；验证：构造带 `generated` 的 `ProjectShot` → `shotToData` → `nodeToShot`，输出 `transition_out.generated` 为空。

## 2. 接缝设置面板收缩

- [x] 2.1 `src/TransitionPanel.tsx` 删除生成段（成片时长、画面与过渡、声音描述、出片预览、参考素材条、出片设置、原生音频、提示词面板、底栏生成/取消/重拉）与全部生成相关 props；验证：面板内不再出现「生成视频」「出片设置」「首尾帧」文案。
- [x] 2.2 面板标题改为「接缝设置」，保留预设网格（常用 4 项常显、其余折叠）、时长输入与成片 delta 摘要，并保留「未参与成片」警告；验证：打开一条转场连线能看到 `叠化` 等常用预设与时长输入。
- [x] 2.3 删除 `src/OutgoingReferencePickerModal.tsx` 与它的引用；验证：`grep -rn "OutgoingReferencePickerModal" src/` 无结果。
- [x] 2.4 删除 `src/transitionGen.ts`、`src/transitionRecipes.ts`、`src/transitionRecipes.json`、`src/transitionRecipes.README.md`、`src/transitionSuggest.ts`；验证：`grep -rn "transitionGen\|transitionRecipes\|transitionSuggest" src/ server/` 无结果。
- [x] 2.5 删除 `src/promptRender.ts` 中未使用的 `buildTransitionPromptRenderBundle` 及其对 `transitionGen` 的 import；验证：`npx tsc --noEmit` 通过且 `grep -rn "buildTransitionPromptRenderBundle" src/` 无结果。

## 3. 画布连线标签

- [x] 3.1 `src/data.ts` 的 `ShotEdgeDataType` 新增 `seamLabel?: string`，`src/App.tsx` 装饰边时用 `transitionSummary(t)` 填入；验证：转场边在 React DevTools/回归脚本里能看到 `data.seamLabel`。
- [x] 3.2 `src/ShotEdge.tsx` 增加 `EdgeChip` 子组件：独立订阅 `useStore(st => st.transform[2])` 做反向缩放，`EdgeLabelRenderer` 渲染，`pointer-events: none`；仅在 `relation === 'transition'` 且 `seamLabel` 非空时渲染；验证：缩放画布 1x → 2x，标签视觉字号不变，且 `document.querySelector('.edge-chip')` 数量等于转场边数量。
- [x] 3.3 `src/theme.css` 新增 `.edge-chip` 样式（小字号、描边用关系色、不接收指针事件），并确认删除项里没有遗留的旧 `.edge-chip` 规则冲突；验证：画布上标签背景不遮挡线身，鼠标点标签区域触发线身点击。
- [x] 3.4 `src/EdgeContextMenu.tsx` 与 `src/App.tsx` 把「转场设置…」文案改为「接缝设置…」，`headSub` 的接缝摘要继续由 `transitionSummary` 提供；验证：菜单里出现「接缝设置…」，点击后打开面板且标题为「接缝设置」。

## 4. 时间线与预览

- [x] 4.1 `src/Timeline.tsx` 删除转场块渲染、`transitionItems`、`edit.transitions` 计数与 `stale` 相关样式分支，保留 xfade 标记与 `inactive` 提示；验证：时间线摘要只显示「N 镜 · X.Xs」，两镜 0.5s 叠化显示 5.5s。
- [x] 4.2 `src/Preview.tsx` 删除 `kind: 'transition'` 的条目构造、`stale` 计数与 `staleTransitions` 上报、播放条上的 `T` 块；验证：预览条目数等于镜头数，导出回执不再出现「条生成转场已失效」。
- [x] 4.3 `src/api.ts` 的 `ExportSegment.kind` 保留 `'transition'` 读取兼容但前端不再产生；`StartVideoOptions.transition` 声明删除、`fetchTransitionSuggest` 与 `TransitionSuggestion` re-export 删除；验证：`npx tsc --noEmit` 通过且 `grep -n "fetchTransitionSuggest" src/` 无结果。

## 5. App 生成链路拆除

- [x] 5.1 `src/App.tsx` 删除 `generateTransitionVideo`、`cancelTransitionVideo`、`recoverTransitionVideo`、`TransitionVideoRun`、`activeTransitionVideoRef` 与三个注册/查找函数，以及面板上对应的三个 props；验证：`grep -n "generateTransitionVideo\|cancelTransitionVideo\|recoverTransitionVideo" src/` 无结果。
- [x] 5.2 `src/App.tsx` 删除转场参考拖线（`onConnect` 里的 `selEdgeId` 分支、`transition-pick` 菜单模式、`toggleTransitionRef` / `removeTransitionRef` / `transitionPair` / `writeTransition` / `transitionAgentRefs` 及 `transitionRefEdgeId` 系列 import）；验证：选中转场边后从角色/素材拖线改为写入镜头 `refIds`，且项目数据出现 `refIds` 而非 `transition_out.generated`。
- [x] 5.3 `src/App.tsx` 的 `setEdgeRelation` / `unifyTransitions` 去掉生成模式判断与「生成转场保持不变」文案；验证：批量叠化后回执为「已把 N 条转场统一为叠化 0.5s」。
- [x] 5.4 `src/canvasShots.ts` / `src/canvasShotOps.ts` 的 `transitionOut` 修复与水合逻辑保持行为不变（只依赖 `to` 与 `relation`）；验证：清空画布边后重载，转场线按 `transition_out.to` 恢复且标签显示正确的效果名。

## 6. 服务端

- [x] 6.1 `server/app.ts` 的 `/api/seedance` 删除 `transition` 入参解析、`morphTransition` / `boundaryBoth` / `boundaryFirstOnly` / `transitionMode` 判定与所有依赖它们的首帧/尾帧/参考选择分支；验证：不带 `transition` 的分镜出片请求行为不变（首帧、参考图、参考视频、原生音频、纯文本五种模式仍可进入）。
- [x] 6.2 `server/app.ts` 删除 `/api/transition/suggest` 路由；验证：`curl -X POST /api/transition/suggest` 返回 404 而非 405/400。
- [x] 6.3 `server/app.ts` 的 `/api/assemble` 保留 `kind: 'transition'` 的读取分支但确认前端不再产生（`joins` 结构与 xfade 链不变）；验证：`node scripts/verify-export.mjs` 通过。

## 7. Agent 与契约

- [x] 7.1 删除 `src/agent/transitionRefTools.ts`，并从 `src/agent/builtinPlatformTools.ts` 移除 `createTransitionRefTools` 调用与四个工具名；验证：Agent 工具清单里不再出现 `attach_transition_refs` / `set_transition_audio` / `read_transition_video_inputs` / `read_transition_recipes`。
- [x] 7.2 `src/agent/stageTools.ts` 删除 `read_transition_video_inputs` 与 `read_transition_recipes` 两个工具定义及 `transitionGen` import；验证：`npx tsc --noEmit` 通过，`grep -n "read_transition" src/agent/stageTools.ts` 无结果。
- [x] 7.3 `src/skills/tools.ts`、`src/creative/expertToolGroups.ts`、`server/dsh-plugins/creative-tools/shell-sync-tools.mjs` 移除四个工具名；验证：`grep -rn "attach_transition_refs\|set_transition_audio\|read_transition_video_inputs\|read_transition_recipes" src/ server/` 无结果。
- [x] 7.4 `src/agent/workbenchChat.ts` 删除 `plan_transition_director` 与 `plan_cinematic_transition` 两条内置动作，保留 `plan_transition_joins`；验证：工作台内置动作清单剩 3 条，`plan_transition_joins` 仍可运行。
- [x] 7.5 `src/skills/contracts.ts` 的 `joins-v1` schema 把 `mode` 收敛为 `z.literal('effect')`，删除 `generated` / `taxonomy` / `recipe_ids` 子对象；`src/shotJoins.ts` 的 `applyJoinsToShots` 删除 `generated` 分支与计数；验证：提交 `mode: 'generated'` 被 zod 拒绝并返回校验错误，提交 effect joins 正常写回。
- [x] 7.6 `src/platform/projectDraft.ts` 的 joins 回执去掉「生成 N」；`skills/README.md` 与 `skills/cinematic-transition-skills.README.md` 同步更新或删除；验证：回执为「镜间接缝：应用 N，硬切 N，特效 N」。
- [x] 7.7 `src/storyboardMarkdown.ts` 的转场脚注删除「AI 生成过渡」分支；验证：导出含转场的分镜 Markdown，脚注只出现效果名与时长。

## 8. 回归脚本

- [x] 8.1 `verify-edge-menu.mjs`：把「画布上没有任何连线标签」反转为「转场线有标签、硬切/闪回/分支无标签」，并补「点标签等价于点线身打开菜单」；验证：`node verify-edge-menu.mjs` 全绿。
- [x] 8.2 `verify-transitions.mjs`：保留夹紧、折叠时间账、非相邻、持久化映射；删除生成插入、指纹失效、生成回落用例；新增「旧 `generated` 数据按 `effect` 渲染且写回被剥离」用例；验证：`node verify-transitions.mjs` 全绿。
- [x] 8.3 `verify-transitions-ui.mjs`：删除生成段断言，保留标记转场/默认叠化/预设切换/非相邻；新增连线标签断言；验证：`node verify-transitions-ui.mjs` 全绿。
- [x] 8.4 退役 `verify-transition-folds.mjs`（删除文件并在 `README.md` 或测试清单里去掉引用）；验证：`grep -rn "verify-transition-folds" . --exclude-dir=node_modules --exclude-dir=openspec` 无结果。
- [x] 8.5 `verify-joins.mjs` 收窄为效果 joins；验证：`node verify-joins.mjs` 全绿。
- [x] 8.6 确认 `verify-boundary-frames.mjs` 与 `verify-native-audio.mjs` 未受影响；验证：`verify-boundary-frames` 退出码 0；`verify-native-audio` 在干净 HEAD 上同样因 undici 打包失败，属既有问题，本次未触碰其依赖（`nativeAudio.ts` / `videoSeconds.ts` / `server/apimart.mjs`）。

## 9. 集成验收

- [x] 9.1 跑 `npm run build`（`tsc --noEmit` + vite + server bundle）；验证：退出码 0。
- [ ] 9.2 跑 `npm run test:studio`；验证：退出码 0。**当前被既有 bug 挡住**：`assertPlatformToolConsistency` 报「已注册但未列入清单：publish_shot_clip_frame、link_prev_shot_tail_frame」（上一个 commit `b4a0b6c` 引入，干净 HEAD 上同样失败），连带 5 个测试红。逐项在干净 HEAD 复现过，非本次改动引入。
- [x] 9.3 端到端手验：加载一个带 `generated` 的旧画布存档 → 连线按 `effect` 渲染且标签正确 → 改预设 → 刷新后保留 → 导出成片总长等于时间线总长；验证：三者数值一致且项目数据里该镜 `transition_out` 不含 `generated`。
- [x] 9.4 `README.md` 更新转场口径（只有效果转场、连线标签、接缝设置入口、旧数据降级规则）；验证：README 描述的入口名称与界面一致。

## Workflow follow-up

- 归档前跑 `openspec validate remove-generated-transitions --strict`。
- 归档时以本变更为准接管 `transition-joins` 的效果部分，并关闭 `transition-video-inputs`、`transition-ref-agent-write`、`shot-table-transition-joins` 三条未归档变更。
- 归档后确认 `openspec/specs/shot-transition-continuity`、`shot-transition-video-prompt`、`shot-transition-agent` 三个目录已从 specs 树中移除。
