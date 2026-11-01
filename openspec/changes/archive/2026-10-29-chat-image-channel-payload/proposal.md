# Proposal

## Why

角色聊天带图时，图片先被拼成参考板，交给另一个视觉模型写成外观摘要，角色模型只收到这段文字。用户要的是 pi 的做法：文字和图片在同一条消息里，由当前这一轮的模型自己看图。渠道报文各不相同，转换必须发生在发到渠道的那一步，而不是在 agent 里提前改写成摘要。

## What Changes

- 本轮用户消息里的图片与文字一起交给当前聊天模型。多张图保持独立图片块，不再拼参考板，也不再预调用 `/api/vision`。
- Agent 内部保持 pi 的图片块（base64 + mimeType）。发到渠道时，由 `/api/text` 按渠道转换。
- 能解析 OpenAI `image_url` 的渠道（APIMart、OpenAI 兼容、标准方舟，且该模型声明可看图）把每张图转成 `data:<mime>;base64,...` 的 `image_url`，与文字放在同一条 user content 数组里。
- **BREAKING**：Agent Plan（`/api/plan/v3`）不解析 `image_url`。该渠道不再把 dataURL 塞进正文，也不再改走视觉摘要；每张图换成明确的文字占位，说明这张图没有送进模型。
- 图片读不出来或超过单张大小上限时，该张换成占位并说明原因，不阻断整条消息。
- 工具结果仍然只向模型提供文字摘要，不把帧数据或图片字节放进工具回传。

### 明确不在本次范围

- 不给还没有附件入口的聊天面新增上传。
- 不改变「聊天附件不写入角色参考图、不进入三视图出图请求」。
- 不改造 Agent Plan 网关本身，也不为它发明第二种看图字段。
- 不把历史轮次里的图片重新编码进后续请求；只有当前仍挂在输入区的附件进入本轮请求。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workbench-chat-context`: 图片不再先经视觉模型摘要。本轮图片与用户文字一起进入当前模型；渠道不能看图时改为可见的占位说明。删除参考板、预计算视觉理解，以及「未配置视觉模型所以没看图」这条降级。
- `chat-agent-runtime`: 用户消息中的图片块必须保持到服务端代理，由代理按渠道转换。工具结果仍不得包含图片数据。

## Impact

- `src/agent/SkillChat.tsx`：发送时把当前图片附件放进本轮用户消息，去掉发送前的视觉摘要门禁。
- `src/agent/chatAttachments.ts`：参考板与 `digestAttachments` 不再作为聊天发送路径。
- `src/agent/pi/stageRunner.ts`、`src/agent/pi/messages.ts`：`agent.prompt` 可以带图片块；转成渠道消息时保留图片，不再只抽文字。
- `src/api.ts`：`ProviderChatMessage.content` 允许文字或内容块。
- `server/text-tools.mjs`、`vite.config.ts` 的 `/api/text`：按渠道把图片块转成 `image_url` 或占位文字。
- 未归档变更 `unified-chat-composer` 里「视觉理解必须先算好」的要求被本变更取代；附件跨轮保留、理解中不锁输入框这些行为仍保留，只是不再有视觉预计算。
