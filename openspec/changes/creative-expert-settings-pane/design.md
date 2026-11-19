# Design

## Context

专家的运行时链路在 dsh 迁移后是完整的：`server/dsh-experts.mjs` 把 `experts/<id>/` 与 `<DSH_HOME>/experts/<id>/` 编译成宿主 preset，闸门插件按 `toolIds` / `skillIds` 收窄，工具桥把 41 个工具注册进宿主。缺的是**管理面**：`696e76a` 删除了 `src/settings/ExpertSettingsPanel.tsx` 及 7 个 `src/creative/expert*` 模块，`设置 → 创意专家` 退化成一句说明；而宿主侧只有只读的 preset 查看与「设默认」。

迁移时被删的模块所依赖的东西大多还在：`GET/PUT /api/experts`、`import-zip` / `export-zip`、内置图标路由、`builtinPlatformToolNames()`、`skillDetailShell`、`listSkillTexts()`，连面板用的 CSS 类（`expert-skill-pick`、`expert-soul-readonly-wrap`、`creative-header-alert` 等）也还在 `src/theme.css` 里。

## Goals / Non-Goals

**Goals:**

- 让「新增 / 修改 / 删除专家」重新成为可点的事，而不是改 JSON 或调接口。
- 面板展示的白名单与运行时真正生效的集合一致，不再出现「勾了但没生效」。
- 复用既有接口、重编译链路与样式，不引入新的服务端抽象。

**Non-Goals:**

- 不在宿主侧做专家编辑插件（见「Decisions」的方案对比）。
- 不恢复会话级专家记忆（`expertStorage.ts`）：专家的选择在宿主里表现为 preset，属于会话创建事实。
- 不恢复 MCP 工具勾选：创意会话未桥接 MCP，勾选无运行时意义。
- 不改变专家数据的存储位置与格式，不做迁移。

## Decisions

### 决策 1：面板放在应用设置页，不在宿主里新建 client 插件

三种可选路径：

| 方案 | 代价 | 风险 |
|---|---|---|
| A. 恢复应用侧面板 | 约 1240 行（多为原样搬回）+ 8 处适配 | 低，全部是应用内代码 |
| B. 宿主 client 插件（`settings.section` slot） | 新建 client 包 + slot/locale/primitives 适配 + 新的构建链 | 高，绑死 dsh 0.2.2-rc.5 内部契约 |
| C. 只保留 API + 脚本 | 半天 | 低，但要求操作员手写 JSON |

选 A。技术前提已确认：创意页是同源 iframe，`/api/experts` 在两边都能直接用；但 B 需要仓库目前没有的 dsh client 插件构建链，收益仅为「设置页少一处」。C 适合临时排障，不适合作为产品能力。

**替代方案被否的原因**：B 与宿主版本强耦合，dsh 一升级就可能碎；C 无法满足「操作员能配专家」的基本诉求。

### 决策 2：只读内置 + 另存为自定义，不做原地编辑

内置专家的权威来源是仓库 `experts/<id>/`，写它等于让运行时配置变成代码改动。面板沿用旧行为：内置只读，任何编辑动作先克隆成 `source: 'custom'` 的新 id，保存走 `PUT /api/experts`。这样 `mergeCustomExperts` 里「内置 id 不可覆盖」的约束依然成立，也不需要新增接口。

### 决策 3：`list_installed_skills` 回到「专家勾选」，只锁 `list_experts`

`ALWAYS_ON_TOOLS` 收窄为 `['list_experts']`。`resolveToolSubset` 已经把「`toolIds` ∩ 运行时已注册」作为唯一来源，因此勾选即可见、不勾就不出现，无需额外分支。

面板对两者的呈现必须不同：
- `list_experts`：锁定行，不可勾选，标注「平台始终注入」；
- `list_installed_skills`：普通可勾选项，归入「技能」组。

工具清单继续用 `builtinPlatformToolNames()`（与工具桥同一份声明来源），而不是另抄一张表；运行时仍由 `resolveToolSubset` 过滤掉未注册的名字，两边漂移不会变成运行时错误。

### 决策 4：保存即重编译，重启交由服务端决定，UI 只负责告知

`PUT /api/experts` 已经会 `notifySettingsChanged('experts')`，`syncExperts` 按内容指纹判断是否重写 preset，并在宿主 ready 时重启。面板不重复实现这套判断，只在保存成功的提示里写清「宿主正在运行时会重启，进行中的会话会中断」。

这也解释了为什么不恢复 `notifyCreativeExpertsChanged()`：那是旧应用内聊天的 window 事件，现在没有任何订阅方。

### 决策 5：技能多选的数据源用 `/api/skills`，不用宿主的技能根

面板编辑的是「白名单 id 集合」，而白名单最终会被编译成每个专家的技能根（软链）。用应用侧 `/api/skills`（`listSkillTexts()`）能一次拿到 id、来源与是否存在；用宿主技能根既拿不到未挂载的技能，也会把「收窄后」的视图误当成全集。通配 `*` 的语义不变。

## Risks / Trade-offs

- [面板与宿主 preset 页并存，用户不知道去哪] → 文案分工固定：应用设置=管理与编辑，宿主设置=选用与设默认；`ExpertsPane` 的说明文字随面板恢复一并删除。
- [保存触发宿主重启，打断会话] → 保存提示明确写出；重编译与重启仍由 `syncExperts` 统一判断，避免面板自造一套「立即/延迟生效」语义。
- [工具清单与运行时漂移] → 面板只负责展示与选择，运行时以 `resolveToolSubset` 的交集为准；`builtinPlatformToolNames` 已有 decl/registered 差异检查可复用为回归断言。
- [恢复的面板引用了已删除的模块] → `expertStorage.ts`（会话记忆）与 MCP 相关 import 明确不复用；其余 7 个模块按原样恢复，改动点集中在 import 与文案。
- [保存的内置 id 覆盖风险] → 服务端已有「内置 id 不可覆盖」校验；面板的克隆逻辑必须先生成合法且不冲突的新 id。

## Migration Plan

1. 恢复模块与面板，接进 `SettingsPaneSwitch` 的 `experts` 分支（菜单项已存在）。
2. 收窄 `ALWAYS_ON_TOOLS`，同步面板的锁定行。
3. 跑既有回归：`npm run test:studio`（含 `tests/dsh-experts.mjs`、`tests/studio-expert-signature.mjs`）与 `verify-skills-unit.mjs`。
4. 回滚：面板改动是纯前端 + 一个常量，回退这几个文件即可；专家数据与 preset 文件不受影响。

## Open Questions

- 无。
