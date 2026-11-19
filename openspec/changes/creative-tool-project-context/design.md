# Design

## Context

见 `proposal.md` 的「Why」。以下是塑造方案的关键现状：

- 宿主是**一个进程服务所有创意会话**：`server/creative-host.mjs` 起一个 dsh 实例，`/studio/` 反代到它；会话之间不隔离项目。
- 工具插件 `server/dsh-plugins/creative-tools/index.js` 已在执行时做三级取值：`args.project || config.project || SB_STUDIO_PROJECT`。后两级的赋值方在本仓库里**不存在**，所以实际恒为空串。
- `/api/studio/tools/execute` 的 `project` 直接传给 `createBuiltinPlatformTools({ projectName })`，项目工具最终由 `ensureProjectLoaded()` 抛错。
- 已有先例：`studioSessionToken`（`server/index.mjs:204`）就是一个**进程级单槽位**，由请求顺带刷新、按最近一次写入生效。项目上下文与它同构。
- 前端 `/studio/` 是 iframe，`StudioFrame.tsx` 只做主题桥与就绪态，不传任何业务参数。

## Goals / Non-Goals

**Goals:**

- 让 32 个依赖项目的工具在创意会话里开箱可用，且不改它们的参数定义。
- 未选项目时给模型一条可执行的下一步（列项目 → 询问），而不是一句堵塞式报错。
- 让「当前项目」成为应用侧的单一事实来源，前端只负责推送，不承担兜底逻辑。

**Non-Goals:**

- 不做会话级项目隔离（`exec.agent.id → project` 映射）。多标签互相覆盖属于已知限制，与 `studioSessionToken` 同性质。
- 不给写工具开放跨项目写入：显式 `project` 参数只用于读取场景，写入一律落到当前项目。
- 不复活 `creative_sessions.project` 列。
- 不改宿主插件的取值链，也不改 `creative-tools` 的审批/追问逻辑。

## Decisions

### 1. 默认值放在应用侧，而不是宿主插件

**选择**：`/api/studio/tools/execute` 里做 `const project = body.project || studioProject || ''`。

**为什么不是插件侧**：插件是装进宿主 profile 的独立 bundle（`server/dsh-bundle.mjs` 复制到 `node_modules`），改它要重新打包并重启宿主；而「当前项目」是应用的状态，应用才知道顶栏选了什么。默认值跟着状态所有者走，插件继续做一个纯粹转发器。

**为什么不改 32 个 schema**：给每个工具加 `project` 字段会让模型每次调用都要判断「这次要不要带项目」，是纯粹的负担；而且 zod 默认 strip 未知键，插件又在 parse 之前读原始 args，所以「不声明但可用」本来就是现状。默认值比显式参数是更好的默认体验。

### 2. `POST /api/studio/project` 做校验后写入单槽位

**选择**：`{ name }`，名字必须出现在 `listProjects()` 里；`''` 表示清除；`GET` 返回当前值。

**为什么校验**：默认值会被 32 个工具直接使用，塞进一个不存在的名字会让每一次调用都失败，且失败原因分散。在入口挡掉，错误就只有一个地方可见。

**为什么保留原值而不是清空**：推送方（前端）可能因为时序问题短暂推送空值或旧值；清空会让进行中的会话突然全部失效。保留最后一个合法值更稳。

**备选：把项目名编进 iframe 的 `src` 查询串**（`/studio/?project=x`）。否决：iframe 只在 `key` 变化时重挂，切项目会重建整个创意视图，会话状态丢失。推送式无副作用。

### 3. `list_projects` 是读工具，但不受项目上下文约束

**选择**：注册在 `PLATFORM_READ_TOOL_NAMES`，`run()` 不经过 `ensureProjectLoaded`，直接读项目列表；返回 `{ current, projects: [...] }`，条目只放目录名/标题/画风/画幅/集数/镜头数/更新时间。

**为什么放在「读」组**：它没有副作用，专家白名单里属于人人需要的基础能力；放进「项目与分镜管理」会让默认专家看不到它。

**为什么不复用 `create_project` 的路径**：`create_project` 是写工具且需要确认，混用会让「查一下有哪些项目」弹确认框。

### 4. 无项目文案带出口

**选择**：把 6 处（`ensureProjectLoaded` 一处 + 5 处内联）统一为「请先在顶栏选择项目…；可用 list_projects 查看已有项目」。

**为什么值得改**：模型看不到 UI，只看到错误文本。文本里没有出口，它就只能把这句话原样转述给用户，对话到此为止。

### 5. 注册面必须四处同步

新增工具名要同时出现在：

1. `src/agent/builtinPlatformTools.ts` 的 `PLATFORM_READ_TOOL_NAMES`（否则 `assertPlatformToolConsistency()` 启动抛错）
2. `src/skills/tools.ts` 的 `KNOWN_TOOL_IDS`（技能包可引用）
3. `src/creative/expertToolGroups.ts` 的 `READ` 组（设置页面板分组）
4. `DEFAULT_EXPERT_PLATFORM_TOOLS`（默认专家白名单）

**为什么强调**：`platformToolNameDiff()` 的三向比对就是为了堵「漏一处」这类事故；这四处不同步会在启动或测试时立刻失败，但失败信息分散在三个地方，写进 tasks 才不会漏。

## Risks / Trade-offs

- **多标签/多用户互相覆盖项目上下文** → 接受。与 `studioSessionToken` 同构，属当前单租户架构的既有性质；真要隔离需会话级映射，另开变更。
- **推送时机缺失导致首次调用仍无项目** → 前端在创意视图挂载与项目变化两处推送，并在工具报错文案里给出 `list_projects` 出口，模型可自行纠偏。
- **当前项目被删除后变成悬空指针** → 每次调用都会得到「项目不存在」，有 `list_projects` 可恢复；不做定时校验，避免额外的状态同步。
- **默认白名单 40 → 41 影响既有专家定义** → 重编译后既有专家工具数与文档里的计数要一起改；改为在验收脚本里从代码计算，避免第三次手写这个数字。
- **`GET /api/studio/project` 暴露项目名** → 与 `/api/project` 同级信息，且路由挂在 `authorizeStudioRequest` 下，不引入新的暴露面。

## Migration Plan

1. 先落服务端默认值 + 推送路由：此时已选项目的会话立即恢复，对未推送项目的前端无副作用（回退到空串，行为同今天）。
2. 再落 `list_projects` 与注册面同步：不改既有工具行为，只在清单里多一项。
3. 前端推送上线后，旧前端仍可用（服务端记录为空 → 与今天相同）。
4. 回滚：删掉推送调用与路由即回到当前行为；新增工具名对既有专家只是多一个可选工具。

## Open Questions

（无）
