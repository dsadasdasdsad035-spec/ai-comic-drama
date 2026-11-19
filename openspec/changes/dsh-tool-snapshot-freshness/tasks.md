# Tasks

## 1. 读快照刷新

- [x] 1.1 `createStageToolSet` 暴露 `resetSnapshot`；`createBuiltinPlatformTools` 挂 `resetReadSnapshot`
- [x] 1.2 `StudioToolBridge.invoke` 在每次调用前执行 `resetReadSnapshot`
- [x] 1.3 `tests/studio-tool-bridge.mjs` 断言连续两次 `read_shots` 看到落库改动

## 2. 画布实况通道

- [x] 2.1 新增 `server/studio-canvas-context.mjs` 与 `POST/GET /api/studio/canvas-context`
- [x] 2.2 桥注入 `getCanvasContext` / 视频模型 / 分辨率
- [x] 2.3 `App.tsx` 防抖推送；清项目时清除实况
- [x] 2.4 `shotsData` 用画布节点覆盖同 id 镜头
- [x] 2.5 `tests/studio-tool-bridge.mjs` 断言实况进入 `read_shot_detail`

## 3. 验证

- [x] 3.1 `npm run build:server` 与 `npm run test:studio-tools`