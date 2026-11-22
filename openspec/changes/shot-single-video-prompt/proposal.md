# Proposal

## Why

出片正文在界面上有两处可编辑入口：「运镜与语义」里的运动提示词输入框，和「本次出片提示词」面板的手改编辑。自 4a5b79b 删除运行时拼装后，两者已是同一段文本的两个视图，但名字、位置和保存目标都不同（`video_prompt` vs `video_prompt_override`），用户无法判断哪一份会真正提交。名字还停留在「只写动作与运镜」，与它现在承载整段出片正文的事实相反。

## What Changes

- **删除运动提示词输入框**：「运镜与语义」区块只保留镜号、时长、景别、运镜四项纯数据字段，不再承载正文编辑。
- **出片面板正文成为唯一编辑入口**：在「本次出片提示词」面板内编辑正文，保存后写回 `video_prompt`，并给该字段打 `handEdited: 'video_prompt'` 锁，使模型重新拆镜或重写提示词时不覆盖人工正文。
- **停止写入 `video_prompt_override`**：新保存的正文一律进 `video_prompt`。存量 `video_prompt_override` 继续按「有快照优先读快照」出片，保证已存文本不丢失、不改变现有成片结果；该字段进入只读退役状态。
- **移除「旧快照」过期语义**：单一正文模型下不存在「手改与自动输入不一致」，面板不再产生旧快照警告，也不再提供「重新拼装 / 恢复自动」按钮。
- **修正正文来源摘要**：摘要按实际生效来源显示，不再在已手改时仍报「正文来自运动提示词」。
- **BREAKING**：依赖「运动提示词字段是正文来源」的外部说明与技能文案（Inspector 四处提示、`outgoing` 面板徽章、读工具描述）需同步改口径；`video_prompt` 从此是人/Agent 共用的正文主体，不再只是语义层输入。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-video-prompt`：手改提示词的存储与生效方式改为单一正文 + `handEdited` 锁；移除手改快照过期与重新拼装要求；旧快照降级为只读兼容。
- `shot-inspector-layout`：出片 Tab 区块顺序中「运镜与语义」不再含运动提示词；正文来源徽章收敛，移除旧快照相关呈现。

## Impact

**前端**
- `src/Inspector.tsx`：删除 `motionPrompt` 折叠区（约 70 行）；移除 override 保存/清除回调与「运动提示词不影响出片」提示；修正 `sourceLabel` 判定。
- `src/OutgoingVideoPromptPanel.tsx`：正文区改为可直接编辑并写回；移除旧快照/重新拼装/用字段重填分支与 `renderStale` / `templateStale` 呈现。
- `src/videoPrompt.ts`：`effectiveVideoPrompt` 改为「存量 override 优先 → `video_prompt`」；`EffectiveVideoPrompt` 收敛来源枚举。
- `src/App.tsx`：出片请求正文取值随上述收敛；案例库 `videoPrompt` 写入路径保持写 `video_prompt`。

**数据与同步**
- `src/types.ts`、`src/api.ts`：`videoPromptOverride` 标记退役；新增字段无变化，`video_prompt` 语义扩展。
- `src/shotSync.ts`：`video_prompt_override` 移入只读兼容处理；`video_prompt` 纳入 `handEdited` 保护清单。
- `src/skills/contracts.ts`：`prompts-v1` 本就只写 `keyframe_prompt` / `video_prompt`，无需改动；`shots-v1` 的禁止键清单保留 `video_prompt_override`，继续拦 `submit_shots` 夹带。

**Agent 工具**
- `set_shot_video_override`：保留签名做兼容，内部改为写 `video_prompt` + `handEdited`；或标注退役并指向 `submit_prompts`（实现阶段选定，见 design）。
- `read_shot_video_prompt` / `read_shot_detail` / `read_shot_video_inputs`：来源标签与说明文案随单一正文调整。

**测试**
- `verify-video-prompt-preview.mjs`（9 处）、`verify-shot-inspector.mjs`（4 处）、`tests/shot-read.ts`（6 处）、`tests/shot-field-policy.ts`（4 处）、`verify-creative-export.mjs`（3 处）、`verify-prompt-cases.mjs`（2 处）、`verify-video-prompt.mjs`、`verify-prompt-render.mjs`：手改入口位置、徽章文案、重新拼装、字段锁断言需重写。

**不受影响**
- 参考图/参考视频/音色参考的收集、上限与互斥规则。
- `server/video.mjs` 的请求拼装与正文透明性。
- `video_prompt_rendered` 的存量读取（本就无运行时消费者）。
