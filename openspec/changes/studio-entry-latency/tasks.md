# Tasks

## 1. 转发路径就绪短路

- [x] 1.1 `server/index.mjs` 的 `startHostForRequest` 先读 `creativeHost.status().state`，`ready` 时直接返回 true，不再执行 `syncProfile` / `syncExperts`；验证：`node -e` 起测试用宿主桩，连续调用两次，第二次不触发任何写入（用 `fs.statSync` 的 mtime 断言）
- [x] 1.2 `tests/studio-host-prewarm.mjs` 增加用例：已就绪宿主收到请求时不调用配置同步；`state === 'starting'` 时仍然同步且等待同一次启动；验证：`node tests/studio-host-prewarm.mjs` 全绿
- [x] 1.3 核对设置页所有保存路径都调用了 `notifySettingsChanged`（模型、专家、技能增删改），缺一处处补上；验证：`rg -n "notifySettingsChanged" server/app.ts` 与设置页保存处理器一一对应，且在 `tests/studio-expert-signature.mjs` 中断言「改设置后宿主重启读到新值」

## 2. 专家派生配置幂等落盘

- [x] 2.1 `server/dsh-experts.mjs` 的 `writeExpertsPatch` 先读旧文件内容，与待写内容逐字比较，等价时跳过两个 `writeFileSync`、跳过「已生成 N 个专家 preset」日志，并返回 `{ written: false }`；验证：连续两次调用的文件 mtime 不变
- [x] 2.2 `mirrorExpertSources` 同样按内容比较，`manifest.json` / `soul.md` 等价时不写；`syncExpertSkillRoot` 把逐项 `existsSync` 收敛为一次目录列举，无差异时不产生任何变更；验证：新增技能时只新增该条目、已有条目 mtime 不变
- [x] 2.3 `tests/studio-expert-signature.mjs` 增用例：内容不变连续生成两次，断言文件 mtime 与日志条数均不变；改 `soul` / 工具白名单后断言文件被重写且指纹变化；验证：`node tests/studio-expert-signature.mjs` 全绿
- [x] 2.4 `docs/creative-host.md` 的专家同步小节补「幂等落盘」说明（比较依据、重启后允许一次写入、日志只在真正写入时出现）；验证：文档里的命令与开关取值可照抄执行

## 3. 工具声明缓存

- [x] 3.1 `server/studio-tool-bridge.mjs` 为 `catalog()` 的 JSON Schema 结果增加缓存，失效条件与 `this.tools` 重建同步；验证：同一工具表连续调用 20 次，`z.toJSONSchema` 只执行一轮（用计数桩断言）
- [x] 3.2 `tests/studio-tool-bridge.mjs` 增用例：bundle mtime 变化后缓存失效并重新生成声明；项目上下文变化后工具表重建；验证：`node tests/studio-tool-bridge.mjs` 全绿

## 4. 预热补触发与桌面端触发点

- [x] 4.1 `server/studio-prewarm.mjs` 把 `fired` 拆成 `pending` / `deferred` / `spent` 三态：触发时宿主 `starting` 记为 `deferred` 而非 `spent`，宿主就绪后补触发一次（延迟 1 秒，上限 1 次）；验证：`tests/studio-host-prewarm.mjs` 新用例覆盖「启动中被占用 → 就绪后补一次 → 之后不再触发」
- [x] 4.2 `server/index.mjs` 的 `setupStudio` 在 `SB_DESKTOP_PARENT_PID` 存在时以 `delayMs: 0` 安排预热，浏览器形态保持既有延迟；验证：`SB_DESKTOP_PARENT_PID=1` 启动后日志中预热在 `listening` 行之后立即出现
- [x] 4.3 `docs/creative-host.md` 的「外壳预热」与「内存与耗时基线」两节更新预热时机与实测数据，注明桌面端与浏览器端的差异；验证：文档描述与实际日志一致

## 5. 加载态阶段文案

- [x] 5.1 `src/creative/StudioFrame.tsx` 用宿主状态 + iframe 是否 load 派生两段文案（「正在启动创意会话…」/「正在加载创意界面…」），探测失败退回既有文案；验证：`tests/studio-shell.mjs` 断言两种状态下的文案取值
- [x] 5.2 `src/theme.css` 的骨架样式覆盖两段文案的排版，两套主题下都可读；验证：`tests/studio-view-keepalive.mjs` 的样式契约仍绿，人工在两套主题下各看一眼骨架

## 6. 集成验收

- [x] 6.1 新增连打契约：宿主就绪后连续请求 `/studio/` 子路径 20 次，专家 preset 与模型配置的 mtime、写入计数、变更日志条数均不变；验证：新用例纳入 `npm run test:studio` 并通过
- [ ] 6.2 端到端体感验收：桌面端首次点击「创意」在预热完成后进入，骨架到外壳可见的时间不高于 400ms；验证：`verify-studio-project-context.mjs` 同款 CDP 取数脚本记录一次实测并写入 `docs/creative-host.md` 基线表

## Workflow follow-up

- 合入后归档本变更，把两个 delta 合入 `creative-dsh-host` 与 `creative-experts` 主 spec。
- 归档后复查 `openspec/specs/creative-dsh-host/spec.md` 中「预热 MUST 只触发一次」的表述是否已随 delta 更新，避免主 spec 与实现分叉。
