# Proposal

## Why

聊天和 3D 生成送给模型的上下文目前是"左勾选 + 若干自动行为"拼出来的：画布出片在没有保存选择时直接用 `catalog.defaults`（首帧、角色、场景、道具、全部台词等），聊天输入框会自动预填未勾选的镜头文本，镜头头始终带景别/运镜，选中的图片还会自动生成 media brief 并拼进上下文。用户看不到这一轮到底发了什么，也无法在发送前确认或移除。

现在要把规则改成：**左边只负责浏览，右边显式附加；模型收到的每一段文本、每一张图、每一份 brief 都必须能在发送前看到，并且只来自人的明确选择。**

## What Changes

- 引入 **上下文清单（manifest）** 作为模型输入的唯一来源：`{ metadata, attachments[] }`。元数据只允许镜号、时长、画幅；其余文本、图片、视频关键帧、媒体 brief 全部是附件。
- 左边变成浏览区：项目显示 + 集数下拉 + 分类；点缩略图只预览，不改变模型上下文；「加入上下文」是唯一附加动作。项目下拉只过滤当前项目，**不支持跨项目引用**。
- **BREAKING** 移除自动默认选择：画布右键 3D 出片的 `catalog.defaults` 改为「推荐参考」动作，先预览要加入什么，再由用户确认。
- **BREAKING** 移除聊天输入框的自动预填：镜头文本改为附件栏里的可添加条目（画面提示词、运动提示词、台词、cast、景别/运镜、标注）。
- 镜头头只保留镜号、时长、画幅；景别/运镜不再自动发送，改为可附加文本。
- media brief 与视频关键帧作为**派生附件**展示：可以看到具体描述和帧，可单独排除；视觉模型只为已附加的图片/视频调用。
- 新增「查看将发送」检查器：展开显示系统提示（可折叠）、元数据、每个附件的缩略图/全文、brief 原文、预计字符数与图片数；每轮模型调用再记录一张可折叠的「本轮上下文」卡。
- 每次打开聊天显示「本次上下文 N 项」并允许清空；持久化的选择不再静默进入新一轮。
- 左边增加集数过滤；角色/素材/图片/视频仍限当前项目，场景文本按所选集数过滤。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-3d-context`: 默认选择改为空上下文 + 显式推荐；选择器的浏览/附加分离、项目与集数范围、必需元数据边界、媒体 brief 可见性。
- `scene-agent-chat-ui`: 新增上下文清单、发送前检查器、每轮上下文审计；移除自动预填；附件可移除。
- `scene-agent-runtime`: `get_shot_context` 只返回显式清单与必需元数据，不再自动附带 brief、上次选择或其他镜头内容。

## Impact

- 代码：`SceneCodeWorkbench`（`agentContextText`、`agentDraftText`、prepared 状态）、`SceneAgentChat`（发送前 manifest、检查器、审计卡）、`Shot3DContextPicker`（浏览/附加、项目/集数过滤）、`sceneCodePrepare`（只处理附件）、`shot3dContext`/`shot3dContextCatalog`（默认值语义）、`App.tsx`（画布出片路径）、`sceneAgentTools`/`sceneAgentGraph`（上下文工具契约）、`chat-ui`（chips/检查器）、相关 Playwright 测试。
- 数据：`Shot3DContext` 仍按镜头保存，但语义变为"附件选择"；不新增项目字段，不做跨项目引用。
- 规格：`shot-3d-context`、`scene-agent-chat-ui`、`scene-agent-runtime` 三份增量；不涉及渲染、Blender 作业或模型路由。
- 兼容：旧项目仍可打开；已保存的选择会以「本次上下文 N 项」出现，用户可清空或逐项移除，不会被静默发送。
