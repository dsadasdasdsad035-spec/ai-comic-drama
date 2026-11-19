# Tasks

## 1. 预热裁决与服务端开关

- [x] 1.1 在 `src/creative/keepalive.ts` 增加 `StudioWarmupVerdict`、`StudioWarmupInput`、`resolveStudioWarmup`，短路顺序照 `design.md` D1；验证：`node tests/studio-shell-prewarm.mjs` 通过，且 `resolveStudioMount` 的行为与返回值不变（`node tests/studio-view-keepalive.mjs` 仍全绿）
- [x] 1.2 新增 `tests/studio-shell-prewarm.mjs`，表驱动覆盖：入口关闭、常驻关闭、服务端关闭、已挂载、当前在创意、无访问记录且无意图、有访问记录、有意图、节省流量、`3g`、`deviceMemory=2`、宿主未就绪、主线程不空闲、全部满足；验证：把 `resolveStudioWarmup` 里任意一条短路删掉，对应用例失败
- [x] 1.3 在 `server/studio-flag.mjs` 增加 `isStudioPreload()`（读 `SB_STUDIO_NO_PRELOAD`）并把它加进 `studioFlagPayload()`；验证：`curl -s http://127.0.0.1:5273/api/studio/enabled` 返回含 `"preload":true`，以 `SB_STUDIO_NO_PRELOAD=1` 启动后同一请求返回 `"preload":false`
- [x] 1.4 把 `node tests/studio-shell-prewarm.mjs` 加入 `package.json` 的 `test:studio`；验证：`npm run test:studio` 退出码 0

## 2. 前端接线

- [x] 2.1 新增 `src/creative/useStudioWarmup.ts`：轮询 `/studio/_host/status`（800ms 间隔、最多 12 次、`failed` 立即放弃、连续 3 次请求异常即放弃），满足后进 `requestIdleCallback`（`timeout: 3000`，无 rIC 时退化为 1ms `setTimeout`），裁决为 `mount` 时回调；验证：宿主未启动时 `SB_STUDIO_NO_PREWARM=1` 启动应用，控制台无未捕获异常、无轮询残留（页面停留 30 秒内请求数不超过上限）
- [x] 2.2 `src/shell/SideNav.tsx` 增加可选 `onIntent?: (view: ViewId) => void`，在导航按钮的 `onPointerEnter` 与 `onFocus` 上调用；`src/shell/AppShell.tsx` 透传该回调；验证：`npm run build` 通过，键盘 Tab 到「创意」入口时 `onIntent` 被调用（React DevTools 或临时 console 打点）
- [x] 2.3 `src/App.tsx` 把 `studioEnabled`、`studioKeepAlive`、`preload`、`studioMounted`、`view`、意图标记喂给 `useStudioWarmup`，裁决为 `mount` 时置 `studioMounted = true`；进入创意视图时写 `localStorage.setItem('sb.studioVisited','1')`（`try/catch`，隐私模式失败不影响功能）；验证：`SB_STUDIO_NO_PRELOAD=1` 时行为与改动前完全一致
- [x] 2.4 三条浏览器实测：① `localStorage.clear()` 后启动应用停留 30 秒，Network 无 `/studio/` 的 document 请求；② 首访把指针移到「创意」入口上，随后出现该请求；③ 进入过一次后刷新页面，不点任何东西也会在宿主 ready 后出现该请求；并记录三次的触发时刻

## 3. 隐藏方式改为保留布局

- [x] 3.1 `src/theme.css` 给 `.app-main` 加 `position: relative`，把 `.view-keepalive` 非激活态改为 `position: absolute; inset: 0; visibility: hidden; pointer-events: none`，激活态加 `position: relative; inset: auto; visibility: visible; pointer-events: auto`；验证：切到创意再切回画布，画布版面与改动前逐像素一致，画布上的节点点击命中正常
- [x] 3.2 CDP 实测隐藏期：容器内 `_panelRow` 计数 ≥ 1、iframe `innerWidth/innerHeight` 等于揭示后的尺寸；揭示到两帧耗时 ≤ 16ms；左栏导航按钮水平偏移 ≤ 2px；把五个数字写进 `docs/creative-host.md` 的新基线行
- [x] 3.3 在 `tests/studio-view-keepalive.mjs` 增加一条契约断言：读取 `src/theme.css`，`.view-keepalive` 非激活规则必须含 `visibility: hidden` 且不得含 `display: none`；验证：把隐藏方式改回 `display: none` 后该用例失败

## 4. 失败语义与集成验收

- [x] 4.1 `src/creative/StudioFrame.tsx` 接收 `active: boolean`，当它由 `false` 变 `true` 且 `state === 'error'` 时静默重试一次（复用 `retry()` 的 `/studio/_host/restart` 路径，仅一次）；验证：`DSH_ENTRY=/nonexistent/bin.js` 下预热后首次揭示，界面不出现错误页而是先重试；宿主确坏时第二次揭示仍显示既有错误页与重试按钮
- [x] 4.2 `docs/creative-host.md` 新增「外壳预热」小节：触发矩阵（回访 / 意图 / 门槛）、宿主就绪的等待方式与上限、隐藏方式前后对照表（0×0 与 0 行 vs 真实视口与已渲染行）、`SB_STUDIO_NO_PRELOAD` 与 `SB_STUDIO_NO_KEEPALIVE` 的关系、三个验收数字；验证：文档里的命令可原样执行，`grep` 到的开关名与代码一致
- [x] 4.3 `npm run test:studio` 与 `npm run build` 全绿；验证：两条命令退出码均为 0，`test:studio` 用例数比改动前多 1 个文件、`studio-view-keepalive` 多 1 条断言
- [x] 4.4 回滚演练：只设 `SB_STUDIO_NO_PRELOAD=1`（回到点击加载、无后台请求）、只设 `SB_STUDIO_NO_KEEPALIVE=1`（回到条件渲染、预热自动失效），两者互不干扰；验证：两次启动各做一次往返，行为符合描述

## 5. 归档

- [x] 5.1 先归档 `studio-host-prewarm-keepalive`（本 change 修订了它在 `creative-layout` 里的新增要求），再跑 `openspec validate studio-shell-prewarm --strict`；验证：输出里不再出现 `creative-layout MODIFIED ... not found` 的 INFO
- [x] 5.2 归档本 change，确认 `openspec/specs/creative-dsh-host/spec.md` 与 `openspec/specs/creative-layout/spec.md` 已合入新增与修订后的要求，且 `creative-layout` 中不存在两条语义重叠的「往返不重建」要求
