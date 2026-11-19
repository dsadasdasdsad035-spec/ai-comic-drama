# Tasks

## 1. 白名单解析与编译

- [x] 1.1 在 `server/dsh-experts.mjs`（或邻接模块）导出 `resolveExpertSkillAllowlist(expertId, root)`，与 `syncExpertSkillRoot` / `resolveSkillWhitelist` 同源；`node tests/dsh-experts.mjs` 增断言 `*` 与有限列表。
- [x] 1.2 `compileExpertPreset`：`*` 时向 `dsh-plugin-creative-expert` 传 `skillWildcard: true`（或展开后的 id 列表），不再省略技能闸门配置；`node tests/dsh-experts.mjs` 更新通配用例。

## 2. 宿主插件

- [x] 2.1 `creative-expert`：实现 `skillWildcard` 或根内 id 集合校验；`node tests/creative-expert-plugin.mjs` 覆盖 `*` 拒绝根外 id。
- [x] 2.2 `creative-tools`：`execute` 转发 `expertId`（从 agent 配置读取）；`node tests/creative-tools-plugin.mjs` 断言请求体。

## 3. 应用工具桥

- [x] 3.1 `server/index.mjs` `/api/studio/tools/execute` 接受并传入 `expertId` 至 `toolBridge.invoke`。
- [x] 3.2 `StudioToolBridge.invoke`：技能读工具按 allowlist 过滤/拒绝；可选对非白名单工具名 fail-closed。
- [x] 3.3 `stageTools`：`list_installed_skills` 支持可选 `expertAllowlist` 参数（由 bridge 注入，不改对外 schema 字段名则通过闭包/deps 传递）。

## 4. 集成与文档

- [x] 4.1 `tests/studio-host-experts.mjs` 或新用例：专家 preset 下 `list_installed_skills` 不包含白名单外 id。（由 `tests/studio-tool-bridge.mjs`「专家 expertId 过滤技能列表与读取」覆盖。）
- [x] 4.2 更新 `docs/creative-host.md`「谁决定专家能用哪些工具/技能」：列表=可读、`*` 语义、expertId 传参。
- [ ] 4.3 手测：选「全能专家」与一自定义专家，各调 `list_installed_skills` 与 `read_skill_text` 对比 DSH 技能根目录。