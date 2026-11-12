# Tasks

## 1. 分镜数据层收敛

- [x] 1.1 从 `types.ts` 删除 `ShotData` 的 `sceneCode`、`sceneCodeMeta`、`scheduleMeta`、`scheduleVideo`、`shot3DContext`、`useScheduleFrames`、`useScheduleVideoRef`、`shotScene`、`shotBlocking`、`layout`
- [x] 1.2 删除 `Shot3DContext` / `Shot3DContextText` 类型，以及 `SceneLayout` / `ShotScene` / `ShotBlocking` 类型
- [x] 1.3 `api.ts` 删除 `ProjectShot` 的 `scene_code`、`scene_code_meta`、`schedule_meta`、`schedule_video`、`shot_3d_context`、`shot_scene`、`shot_blocking`、`use_schedule_*` 与 `project.sceneLayouts`，并移除对应导入
- [x] 1.4 `shotSync.ts` 删除上述字段的双向映射，保留提示词、表演、参考等仍在用的字段
- [x] 1.5 删除 `saveSceneLayouts` 与 `saveScheduleVideo` 等已无调用方的 API 助手

## 2. 白模工作台改为条目入参

- [x] 2.1 在 `SceneCodeWorkbench` 新增条目入参（标题、时长、代码、代码元数据、视频、渲染元数据），渲染上下文由条目自身推导
- [x] 2.2 删除工作台对 `ShotNodeType` 与 `node.data.sceneCode/scheduleVideo/scheduleMeta` 的依赖
- [x] 2.3 `lexiconWhitebox.ts` 删除 `lexiconSheetToNode`，改为把 `LexiconWhiteboxSheet` 直接映射为工作台入参
- [x] 2.4 `LexiconWhiteboxStudio` 与 `AssetBoard` 按新入参接线，`sceneLayouts` 参数一并移除

## 3. legacy 几何栈删除

- [x] 3.1 新建 `src/renderSize.ts` 承接 `renderSize`，把 App、工作台、素材链路的引用改过去
- [x] 3.2 删除 `scheduleStatus.ts`、`scheduleGeometry.ts`、`shotScene.ts`、`scheduleAI.ts`、`scheduleContext.ts`、`layoutGen.ts`
- [x] 3.3 `App.tsx` 删除 `resolveShotSchedule` 调用、`sceneLayouts` 状态与相关依赖项，改为直接把数据传入请求构建
- [x] 3.4 `videoPrompt.ts` 的运镜兜底改为只读 `motionNote`
- [x] 3.5 `promptRender.ts` 删除未使用的 `schedule` 参数

## 4. 聊天与运行时收敛

- [x] 4.1 `SceneAgentChat` 的 `threadKey.surface` 只保留 `lexicon`，删除 `scene3d` 分支与相关注释
- [x] 4.2 `agent/pi/engine.ts` 与 `sceneCodeJob.ts` 的模型缺失文案改为白模语义
- [x] 4.3 设置页「白模工作台 Agent 宿主权限」「白模 3D 代码」等文案与线程键说明对齐

## 5. 服务端与文档

- [x] 5.1 `server/db.mjs` 确认不再读写 `shot_3d_context` / `shot_scene` / `shot_blocking` / `schedule_*`，旧列保留
- [x] 5.2 更新 README 与 `docs/scene-agent-engine.md`、`docs/creative-studio.md` 中残留的「3D 调度」表述
- [x] 5.3 删除或占位化依赖已移除模块的验收脚本，保证 `node verify-all.mjs` 不引用不存在的文件

## 6. 验证

- [x] 6.1 `npx tsc --noEmit` 无新增错误（`vite.config.ts` 的两个 `.mjs` 声明告警除外）
- [x] 6.2 `npx vite build` 通过
- [x] 6.3 手动回归：素材 → 镜头语言 → 自定义白模，新建条目、手写代码、运行、渲染、发布素材卡全链路可用
- [x] 6.4 手动回归：打开一个含旧 `scene_code` / `shot_3d_context` 的旧项目，不报错、不显示任何 3D 调度入口
- [x] 6.5 `openspec validate remove-shot-3d-schedule-residue`

## Workflow follow-up

- 实现完成后运行 `/opsx-apply` 勾选任务，再 `/opsx-archive` 归档本变更。
