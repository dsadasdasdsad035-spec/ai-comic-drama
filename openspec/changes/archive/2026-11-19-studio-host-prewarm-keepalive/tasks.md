# Tasks

## 1. 宿主空闲预热

- [x] 1.1 把 `server/index.mjs` 中反代 `ensureStarted` 的主体抽成具名函数（先 `syncProfile()`、再 `syncExperts({ restartIfRunning: false })`、最后 `start()`），预热与反代共用同一入口；`npm run test:studio` 中 `studio-proxy`、`studio-proxy-dsh`、`studio-host-experts` 三个用例仍通过，证明首次请求行为不变
- [x] 1.2 在 `setupStudio()` 末尾加 2 秒 `unref` 定时预热：仅在 `isStudioEnabled()` 且宿主 `state === 'idle'` 时触发，失败只写中文日志不重试；启动应用后 20 秒内 `curl /studio/_host/status` 返回 `state: "ready"`，设 `SB_STUDIO_NO_PREWARM=1` 后同一时刻仍为 `idle`
- [x] 1.3 新增 `tests/studio-host-prewarm.mjs`，覆盖「入口关闭不预热」「预热失败不重试」「预热未完成时进入只拉起一个进程」三个断言，并把它加入 `package.json` 的 `test:studio`；`npm run test:studio` 通过
- [x] 1.4 在 `docs/creative-host.md` 增加「预热时机、失败语义、关闭开关」小节；文档里的 `SB_STUDIO_NO_PREWARM` 命令可照抄执行并观察到预期结果

## 2. 创意视图常驻

- [x] 2.1 `src/App.tsx` 增加 `studioMounted` 状态（`view === 'creative'` 时置 `true` 且不回退），把 creative 分支从条件链摘出，改为链后常驻容器；`npm run build` 通过，且启动后未进创意视图时 Network 无 `/studio/` 文档请求
- [x] 2.2 `src/theme.css` 增加 `.view-keepalive` 与 `.view-keepalive[data-active='true']` 规则，隐藏时不占布局；手工切到镜头表，导航按钮水平偏移不超过 2px（对齐 `creative-layout` 既有要求）
- [x] 2.3 加 `SB_STUDIO_NO_KEEPALIVE` 降级开关，置位时退回条件渲染；两次启动分别切页一次，置位后 `/studio/` 在往返时重新请求、未置位时只请求一次
- [x] 2.4 新增 `tests/studio-view-keepalive.mjs`，断言「未进入不挂载」「进入后往返不卸载」「开关置位退回条件渲染」，并加入 `test:studio`；`npm run test:studio` 通过
- [x] 2.5 在 `docs/creative-host.md` 记录常驻策略、实测内存基线与 `SB_STUDIO_NO_KEEPALIVE`；文档中的开关名与代码 `grep` 结果一致

## 3. 加载态与宿主启动页

- [x] 3.1 `src/creative/StudioFrame.tsx` 增加提前注入：设置 `src` 后每 100ms 轮询 `contentDocument`，`head` 可访问时插入 `[data-dsh-boot]{display:none!important}`，`readyState === 'complete'` 时停止轮询，全程 `try/catch`；手工首次进入创意视图，首帧不出现宿主产品名与「Loading plugins…」文案
- [x] 3.2 `state === 'error'` 时移除隐藏样式，并展示 `/studio/_host/status` 的失败摘要；把 `DSH_ENTRY` 指向不存在的文件后进入创意，错误页出现中文说明与摘要，恢复配置后点「重试」可正常进入
- [x] 3.3 把 `.studio-frame-loading` 的纯文案替换为三栏骨架（侧栏条、消息气泡轮廓、输入区轮廓），两套主题各自取色；日间与夜间分别首次进入一次，骨架表面与文字都可读，无纯文案闪烁
- [x] 3.4 新增 `tests/studio-boot-overlay.mjs`，覆盖「同源注入成功」「跨源访问不抛错」「错误态不注入隐藏样式」三种情况，并加入 `test:studio`；`npm run test:studio` 通过

## 4. 集成验收

- [x] 4.1 记录三组数字：应用 `listening` 到宿主 `ready` 的时长、切页往返时 `/studio/` 文档请求次数、常驻后进程与渲染进程 RSS；三个数字都写入 `docs/creative-host.md` 的基线表
- [x] 4.2 `npm run test:studio` 与 `npm run build` 全绿；`npm run test:studio` 的用例清单数量比改动前增加 4 个
- [x] 4.3 回滚演练：分别只设 `SB_STUDIO_NO_PREWARM=1` 与只设 `SB_STUDIO_NO_KEEPALIVE=1` 启动应用，确认预热与常驻各自可独立关闭且另一项仍生效

## Workflow follow-up

- 完成项目评审要求后归档该 change。
- 归档后确认 `openspec/specs/creative-dsh-host/spec.md` 与 `openspec/specs/creative-layout/spec.md` 已合入新增要求。
