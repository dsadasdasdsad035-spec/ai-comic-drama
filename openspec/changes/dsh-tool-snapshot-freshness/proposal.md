# Proposal

## Why

创意视图里的「全能专家」通过 dsh 宿主调用 `read_shots` / `read_shot_detail` 等读工具时，拿到的是**第一次读取那一刻**的项目数据：用户在画布上改镜、删镜、补视频提示词之后，再次读取仍然返回旧镜头，甚至不再向应用发一次 `GET /api/project`。

根因不是 HTTP 缓存，而是工具表的构造粒度。读工具的取数被 `createStageToolSet` 的 `snapshotPromise` 去重（`src/agent/stageTools.ts`），其设计前提是「一次重新构造工具集 = 一轮对话，同一轮内只取一次项目」。浏览器路径每一轮都会重建工具集；而 DSH 桥把整张工具表按「项目 + 集」缓存在宿主插件进程里（`server/studio-tool-bridge.mjs` 的 `ensureLoaded`），`toolBridge` 又是应用进程级单例（`server/index.mjs`），于是这份快照一直活到切项目、重建 `server-build/studio-tools.mjs` 或重启应用为止。

最小复现（stub 后端，仅用已构建产物）：

```
第1次读取: ["E01-S01"]
同一套工具第2次读取: ["E01-S01"] | GET 次数: 1
重建工具集后读取: ["E01-S02"] | GET 次数: 2
```

这会让模型基于旧分镜做决策（读旧、写新，判断与写回基准错位），也是「工具调用数据没有实时获取画布」的直接原因。

## What Changes

- 桥在**每次工具调用边界**重置项目快照：一次 `invoke` 内仍只取一次项目，跨 `invoke` 不再复用上一轮的快照。
- 浏览器防抖推送画布实况（节点、角色、坏链、出片模型与分辨率）到 `POST /api/studio/canvas-context`；桥按当前项目注入 `getCanvasContext` 等钩子，与画布 Pi 会话对齐。
- `read_shots` / 钻取读工具在有实况时，用 `nodeToShot` 按 `shotId` 覆盖项目快照中的镜头字段，尚未防抖落库的改动也能被专家读到。
- 回归：连续两次 `read_*` 反映落库改动；推送实况后 `read_shot_detail` 反映画布字段。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-tool-bridge`: 新增「工具调用的项目数据不得跨调用陈旧」——桥必须让读工具在每次调用时看到当前已落库的项目数据，且不得为省一次请求而复用上一轮快照。

## Impact

- 服务端：`server/studio-tool-bridge.mjs`（调用边界重置快照）、`server/index.mjs`（若需要把「项目数据已变化」的信号转成重置，而不仅是切项目）。
- 工具层：`src/agent/builtinPlatformTools.ts`（读适配器的快照钩子可重置）、`src/agent/stageTools.ts`（暴露重置入口或把去重范围收窄到单次调用）。
- 测试：`verify-agent-project-cache.mjs` 的「同一套工具内只取一次」语义需要区分「一次调用内」与「跨调用」；`tests/studio-tool-bridge.mjs` 增加桥链路的跨调用新鲜度断言。
- 规格：`openspec/specs/dsh-tool-bridge/spec.md` 增加对应需求与场景。
- 不影响：工具声明、模型可见摘要/界面详情分离、审批与追问、专家工具白名单、数据库结构。
