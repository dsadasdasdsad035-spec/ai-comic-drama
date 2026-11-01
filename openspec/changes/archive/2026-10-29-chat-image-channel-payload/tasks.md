# Tasks

## 1. 渠道转换函数

- [x] 1.1 新增 `server/chat-image-payload.mjs`，实现设计决策 2 的纯函数：按渠道种类与模型 `vision` 能力把图片块转成 `image_url` 或占位，单张解码超过 4MB 或无法解码时只占位该张。用 Node 测试覆盖 Agent Plan、无 vision、可看图、超限、损坏、无图仍为字符串这六种情况，确认测试通过。
- [x] 1.2 让 `normalizeChatMessages` 保留 text / image 内容块并丢弃未知块；纯字符串消息行为不变。用现有或新增的 `server/text-tools` 测试确认字符串消息、图片块、未知块三种输入，确认测试通过。

## 2. 运行时把图片带到代理

- [x] 2.1 扩展 `ProviderChatMessage.content`，使 `toProviderMessages` 在用户消息含图片块时输出内容数组，工具结果仍只输出文字。为 `src/agent/pi/messages.ts` 补测试：带两张图的用户消息保留两块，工具结果里的图片块被丢掉。确认测试通过。
- [x] 2.2 `runStageAgent` 接受本轮图片并调用 `agent.prompt(userText, images)`；没有图片时仍只传字符串。用现有 stage runner 测试或新增用例确认无图调用签名不变、有图时第二条参数是图片块。确认测试通过。
- [x] 2.3 `/api/text` 在选定模型之后调用 1.1 的函数再发往渠道。用针对代理报文的测试确认：可看图渠道的 user content 含 `image_url` 且 dataURL 带正确 mime；`ark-plan` 的报文不含 dataURL，只含占位文字。确认测试通过。

## 3. 技能聊天改为直接带图

- [x] 3.1 `SkillChat` 发送时读取输入区里仍在的图片并交给 `runStageAgent`，用户文字旁只保留附件标签，不再写入外观摘要。去掉 `digestAttachments` 预计算和 `digestBusy` 发送门禁。更新角色聊天附件验收：加入图片后到发送完成不请求 `/api/vision`，输入框保持可输入。确认该验收通过。
- [x] 3.2 删除已无调用的参考板与 `digestAttachments` 路径（保留 3D `mediaBrief`）。跑引用检索，确认技能聊天发送路径不再引用这些函数；相关单元测试改为断言不再拼板，或随函数删除后通过。

## 4. 上下文卡记录处置

- [x] 4.1 发送时用 1.1 的函数为本轮每张图记下「已作为图片送出」或占位及原因，写入该轮上下文快照；线程正文不保存 base64。上下文卡验收：一张可送出、一张超限时，卡片分别显示两种处置，且刷新会话后仍能看到。确认验收通过。
- [x] 4.2 工具回传验收：同一轮用户带图且工具返回关键帧时，模型可见的工具结果仍只有文字摘要。用现有工具结果测试或新增断言确认，确认测试通过。
