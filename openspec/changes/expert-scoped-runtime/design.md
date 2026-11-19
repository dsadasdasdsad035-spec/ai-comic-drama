# Design

## Context

- 专家 preset 已包含：`dsh-plugin-creative-expert`（`tools.restrict`）、`dsh-skill-filesystem`（`includeDefaultRoots: false` + 每专家 `dsh/experts/<id>/skills` 软链根）、`materializeExpertSoul`。
- 平台工具由全局 `dsh-plugin-creative-tools` 注册；专家只收窄**可见**工具名，执行在应用 `StudioToolBridge`。
- `list_installed_skills` / `read_skill_text` / `read_skill_file` 在 `stageTools.ts` 中调用 `loadSkills()`，**不感知专家**。
- `compileExpertPreset` 在 `skillIds` 含 `*` 时不向 `creative-expert` 传入 `skillIds`，宿主不测 skill pre-execute。

参见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 专家会话：列表、读取、宿主闸门、DSH 技能根四方同一白名单集合。
- `*` = 专家技能根内全部已安装技能（与 `syncExpertSkillRoot` + `resolveSkillWhitelist` 同源），不是「应用任意技能无闸门」。
- 工具桥 execute 带 `expertId`（或 `presetId` 可反查），应用侧对技能工具与（可选）非白名单工具名做 fail-closed。

**Non-Goals:**

- 不改无专家 / 标准 preset 的全量工具与技能发现。
- 不在此变更实现「按会话动态改专家 preset」（仍遵循已有：新会话选专家、进行中不换 preset）。
- 不合并 `creative-host-skill-gate` 里顶栏偏好技能 UI（若未落地，可后续叠加）。

## Decisions

### D1：专家标识从宿主传到应用

- **选择**：`creative-tools` 的 `execute` POST body 增加 `expertId`（字符串，空表示无专家）。从 Cordis agent scope 读取 preset 插件配置里的 `expertId`（与 `dsh-plugin-creative-expert` 一致）。
- **备选**：应用按 session cookie 查 DSH 会话元数据 —— 需要应用解析宿主 session 存储，耦合高，否决。
- **备选**：仅在 DSH pre-execute 拦截 —— 无法修复 `list_installed_skills` 泄露，否决。

### D2：白名单解析单一函数

- **选择**：在 `server/` 侧导出 `resolveExpertSkillAllowlist(expertId)`（读 `listAllExperts` + `resolveSkillWhitelist` + 技能目录），供桥接 invoke 与（必要时）宿主编译 preset 时写入显式 id 列表给 `*`。
- **备选**：在 `stageTools` 内重复逻辑 —— 易漂移，否决。

### D3：`*` 在宿主闸门上显式展开或「根内任意」

- **选择**：`creative-expert` 增加模式：收到 `skillWildcard: true` 时，pre-execute 对 `read_skill*` 校验 id 是否落在「当前 preset 技能根目录下存在的子目录名」集合（宿主可读 `customSkillDirs` 列举）；应用侧 `*` 用 `resolveSkillWhitelist(..., ['*'])` 的 ids 列表过滤 `list_installed_skills`。
- **备选**：`*` 继续不挂闸门，只靠应用过滤 —— 若模型走 DSH 原生技能 API 仍可能漏，双端都要收紧；宿主用根目录枚举更稳。

### D4：工具执行防御

- **选择**：`invoke` 若带 `expertId`，校验 `name` 属于 `resolveToolSubset(expert.toolIds, registered)` ∪ `list_experts`；否则 `{ ok:false, error }`。不替代 DSH `restrict`，防宿主插件未加载。
- **非目标**：不为未勾选工具从注册表删除声明（仍 46 条注册，模型看不见即可）。

### D5：API 形态

- **不变**：`/api/studio/tools` 仍返回全量声明（供无专家与编译 expert patch）；不在此接口按专家分叉 schema（避免 N× 专家缓存）。

## Risks / Trade-offs

- [宿主与应用白名单漂移] → 共用 `resolveSkillWhitelist` 数据源；单测对同一 expert fixture 断言列表与拒绝文案。
- [`*` 根枚举在 Windows/无软链] → 与现 `syncExpertSkillRoot` 复制降级一致；验收在 CI macOS/Linux。
- [传 expertId 伪造] → 仅 loopback + internal token；不信任浏览器直调 execute 的 expertId 做提权（内部 token 仅宿主持有）。

## Migration Plan

1. 部署应用 + 更新 `creative-tools` 插件包（宿主重启加载 bundle）。
2. 重跑 `writeExpertsPatch`（`*`  preset 配置字段变化时自动触发重启）。
3. 已有专家会话 JSONL 无破坏；行为变严可能使曾「误列」的技能从列表消失。

## Open Questions

- 是否在 `list_installed_skills` 回执中保留 `restrictedCount` 字段（类似 `creative-host-skill-gate` 提案）—— 可在 apply 时按 UX 需要二选一，不改变核心白名单语义。