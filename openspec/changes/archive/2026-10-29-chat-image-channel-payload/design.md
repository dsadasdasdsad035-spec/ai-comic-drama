# Design

## Context

见 `proposal.md`。和本设计直接相关的现状：

- 角色等技能聊天在 `SkillChat` 里于发送前调用 `digestAttachments`：多图拼成一张 JPEG 参考板，`POST /api/vision`，模型只收到外观摘要文本。
- `runStageAgent` 只调用 `agent.prompt(userText)`。`toProviderMessages` 只保留 `type: "text"`。`ProviderChatMessage.content` 与 `normalizeChatMessages` 都把内容收成字符串。
- pi 本身支持 `prompt(text, images)`，图片块是 `{ type: "image", data, mimeType }`，并在它自己的 OpenAI 适配器里转成 `image_url`。本应用的模型调用不走那个适配器，而走 `/api/text`。
- `/api/vision` 已把单张 dataURL 转成 `image_url`，并限制解码后 4MB。Agent Plan 的 `/api/plan/v3` 不解析 `image_url`，会把 dataURL 当成正文。
- 工具结果的模型可见面已经是文字摘要。这条不变。

## Goals / Non-Goals

**Goals:**

- 当前输入区里的图片以 pi 图片块进入本轮用户消息，到 `/api/text` 才按渠道转换。
- 预览（将发送 / 上下文卡）与真正发出的报文使用同一套转换规则。
- 去掉技能聊天发送路径上的参考板和 `/api/vision`。

**Non-Goals:**

- 不改工具回传的内容形状。
- 不把 base64 写进聊天线程。
- 不让 3D 抓帧、出图参考图走这条用户消息通道。

## Decisions

### 决策 1：图片块留到选中渠道之后再转换

客户端在发送时读取仍挂在输入区的图片，得到 `{ data, mimeType, label }`。`runStageAgent` 用 `agent.prompt(userText, images)` 放进同一条 user 消息。`toProviderMessages` 遇到图片块时保留为内容数组，不再丢弃。

`/api/text` 在 `pickTextModel` 之后调用纯函数做转换，因为只有这时才知道渠道种类和该模型有没有看图能力：

| 条件 | 该张图变成 |
|---|---|
| 渠道不是 `ark-plan`，且模型具备 `vision` | `{ type: "image_url", image_url: { url: "data:<mime>;base64,..." } }` |
| 渠道是 `ark-plan`，或模型没有 `vision` | 一条文字占位，写明标签和「未送入模型」的原因 |
| 解码失败或解码后超过 4MB | 同样是占位，原因写进占位；同条消息继续发送 |

文字块与转换后的图片块留在同一条 user `content` 数组里。没有图片时 `content` 仍是字符串，现有纯文本调用不变。

替代方案：在 `SkillChat` 里按渠道拼好 `image_url`。否决。渠道差异会漏进每个聊天面，Agent Plan 的限制也会被复制多份。

替代方案：继续走 `/api/vision`，只是换个时机。否决。那仍是另一个模型在看图。

### 决策 2：转换函数只有一份

纯函数放在 `server/chat-image-payload.mjs`，不依赖 Node API，方便单测，也让界面预览和 `/api/text` 引用同一份。输入是渠道种类、模型是否具备 `vision`、以及每张图的字节与标签。输出是内容块，或带原因的占位。

`normalizeChatMessages` 只负责保留合法的 text / image 块并丢掉未知块，不在这里决定占位还是 `image_url`。大小与解码检查放在转换函数里，这样预览和正式请求用同一个 4MB 上限。

看图与否以**当前聊天模型**的 `vision` 能力为准，不看设置里单独的视觉环节模型。角色环节如果绑的是纯文本模型，图片会变成占位，即使项目里另外配了视觉模型。

### 决策 3：技能聊天不再做视觉摘要

`SkillChat` 去掉 `digestAttachments` 的预计算、`digestBusy` 发送门禁，以及把外观要点写进 `userForModel` 的路径。用户文字仍可带一行附件标签（名称与 key），让模型把图片块对上「这是哪一张」；这行是标签，不是视觉描述。

`buildReferenceSheet` / `digestAttachments` 若不再被发送路径或测试以外的代码使用，随发送路径一起删除，避免两条看图策略并存。3D 的 `mediaBrief` 不在此列。

线程里的用户消息仍只存用户输入的文字，不存 base64。本轮上下文快照记录每张图的处置（已作为图片送出，或占位及原因），供上下文卡显示。快照在发送时由决策 2 的函数算好后跟该轮消息一起留下。

### 决策 4：工具结果路径不动

`toPiTool` 继续只返回文本 `content`。转换函数遇到工具角色消息时不插入图片块。用户图片只出现在当轮用户消息里。

## Risks / Trade-offs

- **角色环节模型多数只有文本能力** → 图会按规格变成占位，用户会以为没送出去。缓解：占位写明「当前模型不能看图」，上下文卡在发送前就能看到；不偷偷改绑视觉模型。
- **Agent Plan 上原先能看到外观摘要，现在只能看到占位** → 这是提案里的行为变更。要看图需把该环节改绑到具备 `vision` 且不走 Agent Plan 的模型。
- **base64 进 `/api/text` 的 JSON 体会变大** → 沿用现有 4MB 单张上限；超限的张改为占位，不把超大 dataURL 发给渠道。
- **预览与服务端各写一遍规则会漂移** → 只保留 `server/chat-image-payload.mjs` 这一份。
- **`unified-chat-composer` 仍要求视觉预计算** → 本变更取代那一条；实现时不得恢复 `digestBusy` 锁。附件跨轮保留保持不变。

## Migration Plan

无数据迁移。已保存的线程没有图片块，打开时仍按文字显示。

回滚：恢复 `SkillChat` 的摘要预计算，并让 `toProviderMessages` 再次丢弃图片块。`/api/text` 对纯字符串消息的行为本变更不改变，回滚转换函数不影响无图请求。

## Open Questions

无。渠道分类、4MB 上限、以及「不回退到视觉摘要」都已由规格定死。
