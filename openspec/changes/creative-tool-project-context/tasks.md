# Tasks

## 1. 服务端默认项目上下文

- [x] 1.1 在 `server/index.mjs` 增加模块级 `studioProject`（与 `studioSessionToken` 同构），把 `/api/studio/tools/execute` 的项目取值改为 `body.project || studioProject || ''`，验证：宿主不带 `project` 时 `read_episodes` 能读到分集
- [x] 1.2 新增 `POST /api/studio/project`（body `{ name }`，空串清除）与 `GET` 读回，复用 `authorizeStudioRequest`；名字不在 `listProjects()` 中时返回 400 且保留原值，验证：推送合法名后 `GET` 返回该名，推送非法名后 `GET` 仍是旧值
- [x] 1.3 在 `tests/studio-tool-bridge.mjs` 增加断言：`body.project` 为空时落到服务端记录、非法项目名被拒绝且记录不变，验证 `npm run test:studio` 通过

## 2. list_projects 工具

- [x] 2.1 在 `src/agent/builtinPlatformTools.ts` 新增只读工具 `list_projects`，返回 `{ current, projects[] }`（目录名、标题、画风、画幅、集数、镜头数、更新时间），不经过 `ensureProjectLoaded`、不需要确认，验证：未选项目时调用返回空 `current` 与已有项目列表
- [x] 2.2 统一 6 处无项目文案（`ensureProjectLoaded` 与 5 处内联）为附带 `list_projects` 出口的版本，验证：`npm run build` 通过且全仓库不再出现旧的单向报错文案
- [x] 2.3 同步四处注册面：`PLATFORM_READ_TOOL_NAMES`、`src/skills/tools.ts` 的 `KNOWN_TOOL_IDS`、`src/creative/expertToolGroups.ts` 的 `READ` 组与 `DEFAULT_EXPERT_PLATFORM_TOOLS`，验证 `assertPlatformToolConsistency()` 不抛错、`verify-agent-tool-coverage.mjs` 通过
- [x] 2.4 新增或扩展验收脚本覆盖 `list_projects`（有项目 / 无项目 / 当前项目在列表内）与默认上下文的读取，验证脚本可独立跑通

## 3. 前端推送当前项目

- [x] 3.1 在 `src/creative/StudioFrame.tsx` 挂载时与 `projectName` 变化时推送 `POST /api/studio/project`，清除态推送空串，验证：请求只发一次 per 变化，切项目后 `GET` 反映新项目
- [x] 3.2 把 `projectName` 从 `App.tsx` 传入 `StudioFrame`（当前是零参数组件），验证：`npm run build` 通过且无未使用参数告警
- [x] 3.3 用 `verify-expert-settings.mjs` 同款方式新增或扩展一个 Playwright 验收：顶栏选项目 → 进创意视图 → `GET /api/studio/project` 返回该项目名；切到另一项目后返回新名字

## 4. 文档与既有计数

- [x] 4.1 更新 `docs/creative-host.md`：新增「创意会话的项目上下文」小节，说明默认值链、单槽位限制与 `list_projects` 的作用，验证文中不再出现「工具需要顶栏当前项目但拿不到」的旧描述
- [x] 4.2 把文档与脚本里手写的工具计数（默认白名单 40 → 41、专家 preset 41 → 42）改为从代码计算或更新为正确值，验证 `npm run test:studio` 与 `verify-expert-settings.mjs` 均通过

## 5. 集成验收

- [x] 5.1 端到端跑一次：顶栏选项目 → 创意视图里连续调用 `read_source`、`read_episodes`、`read_shots` 均成功，验证 `npm run test:studio` 全绿
- [x] 5.2 验证未选项目路径：清空项目后调用读取工具得到带 `list_projects` 提示的失败，再调用 `list_projects` 能列出项目并据此继续
