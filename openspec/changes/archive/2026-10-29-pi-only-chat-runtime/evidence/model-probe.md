# 真实模型探测：原生工具调用能力

探测方式：绕开应用 `/api/text` 的能力表守卫，直连渠道 `/chat/completions`，提交真实工具声明与真实契约 schema。
目的：在删除 JSON action 与 LangGraph 之前，确认哪些模型真能承担聊天，以及收紧 `required` 是否必要。

## 结论一：ark-plan 通道 8 个模型全部可用

单工具探测与深层嵌套探测（`submit_script` 2 集 × 场次、`submit_shots`）均通过，非流式与流式一致：

| 模型 | 单工具 | 深层嵌套 | 收紧后 shots | 能力表 |
|---|---|---|---|---|
| MiniMax-M3（minimax） | PASS | PASS | PASS | 原有 |
| doubao-seed-2-1-lite-260915 | PASS | 2/2 | PASS | 原有 |
| deepseek-v4-flash | PASS | 2/2 | PASS | 原有 |
| kimi-k3 | PASS | 2/2 | PASS | 原有 |
| doubao-seed-2-1-pro-260915 | PASS | 2/2 | PASS | 新增 |
| doubao-seed-evolving | PASS | 2/2 | PASS | 新增 |
| deepseek-v4-pro | PASS | 2/2 | PASS | 新增 |
| glm-5.3 | PASS | 2/2 | PASS | 新增 |

## 结论二：契约 required 太宽松会导致「成功但空产物」

同一提示词、同一 `shots-v1` schema，只改 `shots.items.required`：

| 模型 | 宽松（required 仅 `["no"]`） | 收紧（+scene_no/seconds/size/desc） |
|---|---|---|
| kimi-k3 | FAIL（回 `{no:"S01"}` 并通过校验） | PASS |
| doubao-seed-2-1-lite | PASS | PASS |
| deepseek-v4-flash | PASS | PASS |
| glm-5.3 | PASS | PASS |

Kimi 的失败不是模型能力问题：宽松 schema 下它如实只填了必填字段，产物却会被 `validateContract` 放行并写进草稿。
这正是删除 JSON action 的前提条件——JSON action 时代模型主要读提示词里的文字契约，宽松 schema 不会发作。

收紧后复验（7 个 ark-plan 模型）：全部两镜均含 `no/scene_no/scene_slug/seconds/size/move/desc`。

## 结论三：不可用渠道

| 渠道 | 状态 | 说明 |
|---|---|---|
| ark（标准方舟） | 401 | `ARK_API_KEY` 已失效；默认模型表里 `ark-text-lite` / `ark-text-pro` 当前跑不了 |
| deepseek 直连 | 无 Key | 未验证 |
| openai | 无 Key | 未验证 |
| apimart | 单工具通过，未做深层验收 | 忽略 `stream:false` 恒返 SSE；约 5–6 次连发后断连（限流），冷却后恢复。按产品决定不纳入能力表 |

apimart 下游可用性不作为本变更范围（不处理限流）。
