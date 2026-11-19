# Proposal

## Why

创意会话里的平台工具**拿不到项目**。`builtinPlatformToolNames()` 登记的 41 个工具中有 32 个依赖项目上下文（13 个 `read_*`、7 个 `submit_*`、12 个动作/生成工具），它们一律抛「请先在顶栏选择项目，平台读/写工具需要项目上下文」——包括最基础的 `read_source` 与 `read_episodes`。

原因不是工具缺失，而是链路上少了一格：顶栏的项目名只活在浏览器里，`/studio/` iframe 没有把它带下去，宿主又是**一个进程服务所有会话**（`creative_sessions.project` 在 dsh 迁移后已停写）。于是 `server/dsh-plugins/creative-tools/index.js` 的 `project = config.project || process.env.SB_STUDIO_PROJECT || ''` 恒为空，`/api/studio/tools/execute` 收到 `project: ''`。

同时**没有任何工具能列出项目**：41 个工具里只有 `create_project`（新建）与 `update_project_meta`（改当前项目）。这构成死锁——要读分集得先知道项目名，要查项目名却没有工具，模型只能干报错。

## What Changes

- 应用侧新增 `POST /api/studio/project`：前端在进入创意视图与顶栏切项目时推送当前项目名；服务端校验名字存在于项目列表后记入内存。
- 工具执行的项目上下文改为三级回退：`调用参数.project` → `请求体.project` → 服务端记住的当前项目。默认值落在应用侧，**宿主插件 `creative-tools` 与 32 个工具的参数定义一行不改**。
- 新增只读工具 `list_projects`：返回当前项目名与项目清单（名称、标题、画风、画幅、集数、镜头数、更新时间），让模型在未选项目时能反问「你有 A/B/C 三个项目，要读哪个」而不是死路。
- 无项目时的失败文案补上出口：从「请先在顶栏选择项目，平台读/写工具需要项目上下文」改为附带 `list_projects` 的提示。
- 同步平台工具的三处注册面（`PLATFORM_READ_TOOL_NAMES`、`KNOWN_TOOL_IDS`、专家工具分组与默认白名单），使 `assertPlatformToolConsistency()` 继续通过。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-tool-bridge`: 新增「工具调用的默认项目上下文」与「项目清单工具可供模型发现当前项目」两条需求；工具参数定义不再向宿主泄漏项目选择责任。
- `project-context`: 新增「创意会话的工具读写必须落到当前项目」——顶栏切换后工具上下文随之更新，未选项目时只读工具给出可发现的替代路径而不是笼统报错。

## Impact

- 服务端：`server/index.mjs`（新增路由 + 工具执行的项目回退）、`server/app.ts`（`list_projects` 所需的项目列表读取已存在，可能只导出能力）。
- 前端：`src/creative/StudioFrame.tsx`（推送项目名）、`src/api.ts` 或新增薄封装。
- 工具层：`src/agent/builtinPlatformTools.ts`（`list_projects` 注册 + 5 处无项目文案）、`src/skills/tools.ts`（`KNOWN_TOOL_IDS`）、`src/creative/expertToolGroups.ts`（读组 + 默认白名单）。
- 计数：默认专家白名单 40 → 41，`expert-omni` 等重编译后 41 → 42。
- 已知限制：当前项目是**进程级单一槽位**（与既有 `studioSessionToken` 同构），多标签或多用户同时操作会互相覆盖；真正的会话级隔离需要 `exec.agent.id → project` 映射，不在本变更范围。
- 测试：`tests/studio-tool-bridge.mjs`、`tests/studio-integration.mjs`、`test:studio` 全量、新增验收脚本。
