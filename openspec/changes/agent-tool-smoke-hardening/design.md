# Design

## Context

见 `proposal.md - Why`。当前状态的关键事实：

- 平台内置工具清单由 `builtinPlatformToolNames()` 派生：17 个读工具名 + `validate_contract` + 7 个 `submit_*`（来自 `PLATFORM_WRITE_TOOLS`）+ 11 个动作工具，共 36 个。真实注册集合由 `createBuiltinPlatformTools(ctx)` 产生。
- 三方一致性比较已存在但只在单元测试里：`platformToolNameDiff()` / `assertPlatformToolConsistency()`（`src/agent/builtinPlatformTools.ts`），由 `tests/platform-tool-coverage.ts` 驱动，并含「少一个名字」「多一个名字」两个否定用例。
- 逐工具冒烟已存在：`verify-creative-builtin-tools.mjs` 自起临时库，构造一个**没有 `confirm` 也没有 `askCost`** 的 ctx，遍历全部工具逐个 `invoke`，用 `staticArgs` 表提供最小参数。
- 八个工具只有弱断言（清单见 proposal）。它们的强断言要落在别处：读取类已有 `tests/shot-read.ts`（游标续读、截断、钻取），写回类已有 `verify-tool-contracts.mjs`（契约层）与 `verify-joins.mjs`（底层 `applyJoinsToShots`），缺的是**工具层到落库**这一段的断言。
- `verify-agent-scene-draft.mjs` 引用的 `begin/append/read/patch/commit_scene_draft` 已不在 `src/agent/sceneAgentTools.ts`（现为 `get_shot_context` / `set_scene_code` / `run_render` / `capture_frames` / `review_frames` / `finish` / `run_bash` / `read_file` / `write_file` / `list_dir` / `adopt_scene_from_job`）。
- 端口约定割裂：`verify-agent-stream` 默认 `5274`、`verify-agent-chat-ui` / `verify-agent-limits` 默认 `5280`、`verify-agent-plan` 默认 `5273`；`verify-all.mjs` 直接 `spawn(node, [f])`，不注入地址。

## Goals / Non-Goals

**Goals:**

- 让「预期 fail-closed」变成显式声明，真实回归不再被假绿掩盖。
- 让每个内置工具的验证都能回答「返回内容对不对」，而不只是「有没有抛异常」。
- 让批量验收在没有外部依赖时能整体跑通，并且失败原因可读。

**Non-Goals:**

- 不改变任何工具的业务行为、参数、返回形状或工具名清单。
- 不追求把 36 个工具的端到端 UI 都覆盖（UI 由各视图自己的 `verify-*` 负责）。
- 不引入新的测试框架或断言库：沿用现有 `check(名称, 条件, 详情)` 风格与 `node xxx.mjs` 跑法。

## Decisions

### 1. 期望状态写在参数表里，而不是另开一张表

把 `staticArgs[name]` 从「参数」升级为「参数 + 期望」：

```js
{ args: {...}, expect: 'ok' }
{ args: {...}, expect: 'fail', reason: /没有确认通道/ }
```

备选是把期望另存为 `expected[name]` 的第二张表。否决理由：两张表必须同步新增，漏一个就会出现「有参数没期望」的静默通过 —— 而这正是本次要堵的坑。同一张表里缺字段就报错，天然强制成对声明。

### 2. 校验用正则匹配错误信息，而不是只匹配布尔

`expect: 'fail'` 必须带 `reason`，与实际 `error` 文本比对。这样「拒绝对了但理由变了」也能被拦下。

备选是只断言 `ok === false`。否决理由：`ok:false` 太容易满足 —— 一个拼错参数导致的 schema 拒绝就能顶替真正的 fail-closed，测试会退化成「反正报错了」。

### 3. 内容级断言分两类落点，不都塞进冒烟

- **读取类**：断言返回结构与条目，补在 `tests/shot-read.ts`（已有断言框架与 fixture）与冒烟脚本内联。
- **写回类**：断言「提交后重新读取项目，字段确实变了」，补在 `verify-creative-builtin-tools.mjs` 用它的临时库 —— 因为只有那里同时有真实 `POST /api/project` 与干净的初始数据。

备选是把所有内容断言都写进冒烟脚本。否决理由：冒烟的 ctx 没有宿主回调，`submit_*` 靠服务端落库断言是对的，但读取类的截断/游标语义在 `tests/shot-read.ts` 里已有 fixture，重复造只会分叉。

### 4. 过期脚本：先修，修不动就删并交代接管

`verify-agent-scene-draft.mjs` 的目标流程已被 `set_scene_code` 取代。处理顺序：先看 `set_scene_code` 是否保留了等价的「分段追加 + 行号读取 + 片段替换 + 准入提交」行为；保留则按新工具重写，不保留则删除脚本并在 `tasks.md` 里写明覆盖由谁接管。**不允许**留着运行即抛异常的脚本。

#### 4.1 判定结论（任务 3.1）：部分取代，脚本按「服务端存储 + set_scene_code + 暴露面」重写

| 旧能力 | `set_scene_code` 现状 | 结论 |
|---|---|---|
| 分段追加 | 内部按 32KB 分片写服务端草稿（`draftClient.begin` + 循环 `append`） | 保留，但不对模型暴露 |
| 准入提交 | `commit` 后 `checkSceneCode` 准入并设为 `session.code` | 保留，且是唯一入口 |
| 行号读取 | `draftClient.read` / `server/scene-draft.mjs readDraft` 仍在，但无工具暴露 | 模型侧无等价能力 |
| 片段替换 | `draftClient.patch` / `patchDraft` 仍在，但无工具暴露 | 模型侧无等价能力 |

不暴露不是遗漏：`openspec/specs/scene-agent-runtime/spec.md` 明确要求两档 **MUST NOT** 暴露 `begin/append/read/patch/commit/discard_scene_draft`，只 MAY 保留 `set_scene_code`。所以旧脚本断言的「六个草稿工具可用」既已腐坏，也与现行 spec 相反。

因此不删除脚本，改为四段：① 服务端草稿存储（原样保留，全部仍在用）；② `set_scene_code` 的草稿路径（32KB 分片、准入提交、试运行门禁）；③ 工具暴露面（两档都不含草稿工具族、restricted/full_host 差异）；④ 历史压缩（旧 transcript 里的草稿工具调用仍需折叠）。

### 5. 端口统一为「显式地址 + 自起兜底」

需要现成服务的脚本一律读 `APP_URL`（已有脚本已在用这个变量），批量入口 `verify-all.mjs` 负责注入并（必要时）自起一个 server。服务不可达时脚本给出可读提示，而不是抛连接栈。

备选是让每个脚本自起服务。否决理由：批量跑会同时起十几个 vite 实例，端口与临时库互相踩；现有 `verify-all` 的顺序执行假设一个共享 server。

### 6. 外部依赖断言引入第三种结果：跳过

`verify-agent-stream` 里命中真实代理的用例改为「无凭据 → 跳过并说明」。汇总输出分列 通过 / 失败 / 跳过，跳过不算通过。

备选是保留为失败。否决理由：凭据缺失是环境问题不是产品缺陷，长期红着会训练人忽略失败信号 —— 与本次要解决的是同一类病。

## Risks / Trade-offs

- **期望理由写太严会频繁因文案调整而红** → `reason` 只匹配语义关键词（如 `确认通道`），不匹配整句。
- **写回类断言污染临时库，影响后续用例** → 冒烟脚本每个用例用独立项目名，或在断言后清理；沿用现有 `proj = creative-tools-${Date.now()}` 的隔离做法。
- **删除 `verify-agent-scene-draft.mjs` 造成场景草稿流程无覆盖** → 删除前确认 `scene-agent-runtime` 相关 spec 已有对应验收；若没有，补最小覆盖再删，并在 tasks 里点名接管脚本。
- **跳过机制被滥用成「全跳过还报绿」** → 汇总必须单列跳过数，且 `verify-all` 把「全部跳过」视为异常并提示。

## Migration Plan

无产品迁移。验收调用方式变化：原先 `node verify-agent-stream.mjs` 隐式打 5274，现在需 `APP_URL` 或由批量入口注入 —— 属于开发者本地习惯变更，不影响构建与运行。回滚只需回退脚本。
