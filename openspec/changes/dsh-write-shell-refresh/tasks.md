# Tasks

## 1. 服务端变更序与查询

- [x] 1.1 在应用进程增加写成功后的项目 revision 登记（项目名 + revision + 时间），并在 `StudioToolBridge.invoke` 成功且工具属于落库写集合时更新；验证：`tests/studio-tool-bridge.mjs` 新增断言 bump 被调用且失败不 bump
- [x] 1.2 实现 `GET /api/studio/project-revision`（或等价轻量路由），返回当前项目的 `revision`；验证：execute 写镜后 GET 返回值高于写前
- [x] 1.3 将 `createBuiltinPlatformTools` 的 `onProjectDataChanged` 接到登记函数（替换空函数）；验证：经 `applyProjectDraft` 的 `submit_episodes` 成功路径单测触发一次登记

## 2. 外壳同步钩子

- [x] 2.1 新增 `useStudioProjectSync`（或同级模块）：轮询 revision、比对 `projectSnapRef`、调用 `refreshProjectSnapshot` + 立即 `postStudioCanvasContext`；创意 keepalive 隐藏时降频；验证：单元测试 mock fetch 在 revision 升高时刷新回调被调一次
- [x] 2.2 在 `App.tsx` 挂载钩子（传入 `readyProject`、`studioMount`、`refreshProjectSnapshot`、画布推送参数）；验证：`tsc --noEmit` 通过
- [x] 2.3 刷新不传 `fit`，并加简单 mutex 防并发双刷；验证：手测写回后视口中心不跳转

## 3. 工具名单源与回归

- [x] 3.1 抽取或复用「落库写工具名」单源（与宿主 `DESTRUCTIVE_TOOLS` 语义一致，含 `submit_*` 与必要 `set_*`）；验证：`grep`/小测确保桥与插件名单无矛盾
- [x] 3.2 跑 `npm run test:studio-tools` 与相关 studio 集成用例全绿；手测：创意批准 `submit_shots` → 切画布可见新镜；`submit_episodes` → 分集目录更新，无需重启桌面端

## Workflow follow-up

- 归档前运行 `openspec validate dsh-write-shell-refresh --strict`。
- 实现合并后更新 `docs/creative-host.md` 一节说明壳自动同步（可在 3.2 手测通过时顺带补文档）。