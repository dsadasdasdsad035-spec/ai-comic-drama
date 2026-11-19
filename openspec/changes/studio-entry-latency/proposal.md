# Proposal

## Why

桌面端首次点击「创意」时，骨架「正在连接创意会话…」要停留数秒。实测把这段等待拆成了两笔账：

- **宿主冷启动**（本机 1.33 秒）落在用户正面，因为桌面端预热要等 2 秒定时器才触发，而窗口记住的路由若停在创意页，请求会抢在预热之前把宿主拉起来；
- **请求路径上的重复准备**：每个 `/studio/*` 请求都跑一遍 `syncExperts()`（42 个工具 schema + 3 个专家 preset + 22 个技能目录同步 + 两次 `writeFileSync`）。一次进入创意会触发 58 次全量重写，每次 18–25ms 同步阻塞，把外壳并发启动的那批 API 从 ~10ms 推到 ~190ms。

第二笔账在宿主已 `ready` 时纯属白做：`start()` 本来就会立刻返回，真正需要的配置同步已由设置页变更钩子覆盖。日志里 234 条「已生成 3 个专家 preset」就是它的痕迹。

## What Changes

- **请求路径不再无条件准备**：代理转发前只在宿主尚未 `ready` 时执行配置同步与启动；已就绪直接转发。
- **派生配置按内容幂等落盘**：专家 preset 与镜像内容未变化时不写文件、不打印日志；技能根同步同样只在差异存在时动作。
- **工具声明按需缓存**：工具清单只在工具实现产物变化（bundle mtime 改变）或项目上下文变化时重建，不再每个请求重算 42 份 JSON Schema。
- **预热允许补一次**：宿主处于 `starting` 时不算「已触发」，也不算失败；就绪窗口错过后应重新安排一次预热，而不是让该进程生命周期内永久失去预热。
- **桌面端预热不再等固定 2 秒**：桌面端首屏由 splash 与本地服务握手遮住，预热可在服务握手完成后立即触发；浏览器端保持首屏预算优先的延迟。
- **加载态文案区分阶段**：骨架按宿主状态显示「正在启动创意会话…」或「正在加载创意界面…」，不再是单一黑盒转圈。
- **回归契约**：连打多次 `/studio/*` 后，专家 patch 的 mtime 与写入计数不得变化；预热完成后进入创意的耗时有上限断言。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `creative-dsh-host`: 预热语义由「只触发一次、失败不重试」收敛为「启动中被占用不算触发，允许补一次」；新增「已就绪宿主的请求路径不做重复配置准备」与「加载态按阶段给出说明」两条要求。
- `creative-experts`: 专家 preset 与镜像的落盘由「每次全量重写」收敛为「按内容幂等」，内容等价时不得写盘、不得产生变更日志。

## Impact

- `server/index.mjs`：`startHostForRequest` 增加就绪短路；预热延迟按运行形态取值。
- `server/dsh-experts.mjs`：`writeExpertsPatch` / `mirrorExpertSources` / `syncExpertSkillRoot` 幂等化，返回值新增「是否实际写入」。
- `server/studio-prewarm.mjs`：`fired` 的置位时机从「首次尝试」改为「真正发起或确认失败」。
- `server/studio-tool-bridge.mjs`：工具表缓存键从「项目 + 集」扩展为「项目 + 集 + 产物 mtime」。
- `desktop/main/main.mjs`、`desktop/main/service.mjs`：桌面端预热触发点前移到服务握手完成。
- `src/creative/StudioFrame.tsx`、`src/theme.css`：骨架文案的阶段化。
- 测试：`tests/studio-host-prewarm.mjs`、`tests/studio-expert-signature.mjs`、`tests/studio-tool-bridge.mjs` 增幂等与预热补触发用例；新增连打请求零写盘契约。
- 不涉及对外接口、数据迁移与账本行为。
