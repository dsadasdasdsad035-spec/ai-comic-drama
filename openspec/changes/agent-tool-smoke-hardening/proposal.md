# Proposal

## Why

平台内置工具已有逐工具冒烟（`verify-creative-builtin-tools.mjs` 遍历 36 个工具逐个 `invoke`），但这条防线在三个地方漏了：

1. **断言恒真**。脚本始终调用 `check(名称, true, hint)`，`ok:false` 也记为通过。实测 36 次调用里有 12 次业务失败全部显示 ✅，其中 11 次是设计好的 fail-closed（无确认通道），但那 1 次真实的 `HTTP 404` 也被一起吃掉了 —— 回归信号被假绿淹没。
2. **八个工具只有「不抛异常」级断言**。`list_camera_lexicon`、`get_camera_lexicon`、`list_experts`、`list_installed_skills`、`read_skill_text`、`submit_assets`、`submit_prompts`、`submit_joins` 没有任何内容级断言：返回结构变了、条目空了、写回没生效，冒烟都还是绿的。
3. **一处冒烟已腐坏**。`verify-agent-scene-draft.mjs` 仍在调用 `begin_scene_draft` / `append_scene_draft` / `patch_scene_draft` / `commit_scene_draft`，这些工具在 `sceneAgentTools.ts` 里已经不存在（现为 `set_scene_code`），脚本第 274 行直接 `TypeError`。

再加一处工程割裂：10 个 agent 脚本各自硬编码默认端口（5273 / 5274 / 5280），`verify-all.mjs` 不传 `APP_URL`，于是 `node verify-all.mjs agent` 稳定 9/16 失败，且失败是 0 秒退出（连不上），看起来像断言坏了。

## What Changes

- **冒烟声明期望结果**：逐工具冒烟的参数表为每个工具附带期望状态（`ok` / `expected-fail`），脚本比较实际与期望；出现「预期成功却失败」或「预期失败却成功」都算失败。
- **补八个工具的内容级断言**：运镜库条目形状与总量、专家与技能目录的非空结构、技能正文可取、`submit_assets` / `submit_prompts` / `submit_joins` 的成功写回落到项目并返回可读计数。
- **重写腐坏的场景草稿冒烟**：按 `set_scene_code` 当前流程重写，或在不保留该流程时删除脚本并说明由谁接管覆盖。
- **统一 `verify-all` 的启动约定**：需要现成 server 的脚本从同一处解析 `APP_URL`；`verify-all` 要么注入，要么脚本自起并在结束时清理。**BREAKING**（仅影响本地验收调用方式，不影响产品行为）。
- **为「依赖真实代理」的断言加显式标记**：`verify-agent-stream` 里命中真实 key 才有意义的用例改为可跳过并说明，不伪装成失败或通过。

## Capabilities

### New Capabilities

- `platform-tool-verification`: 平台内置工具（读 / 写 / 校验 / 动作四类）的冒烟与回归契约 —— 每个工具都必须被逐个调用，调用必须带期望状态，业务失败 Must 区分「预期 fail-closed」与「意外失败」；清单、运行时注册与默认专家白名单三者必须互相一致。

### Modified Capabilities

无。既有 spec 描述的是工具的业务行为（`creative-asset-tools` 管资产读工具、`creative-experts` 管专家白名单），本次不改变任何工具的行为，只改变验证这些行为的契约。

## Impact

- 验收脚本：`verify-creative-builtin-tools.mjs`、`verify-joins.mjs`、`verify-material-tools.mjs`、`verify-agent-scene-draft.mjs`、`verify-agent-stream.mjs`、`verify-all.mjs`。
- 单元测试：`tests/platform-tool-coverage.ts`、`tests/creative-tools.ts`、`tests/shot-read.ts`（补内容级断言时的落点）。
- 产品代码（执行中发现的既有缺陷，最小修复）：`server/app.ts` 里 `/api/camera-lexicon/import` 路由被误嵌在 `if (url.startsWith('/api/stock/'))` 分支内，永远匹配不到，客户端收到 HTML 404 后报「代理返回了非 JSON 响应（HTTP 404）」，导致 `set_shot_camera_lexicon` 100% 失败。本次把它挪到同级路由位置并补 `try/catch`，不改变任何接口契约与工具语义。
- 无数据迁移；工具名清单与注册保持现状。
