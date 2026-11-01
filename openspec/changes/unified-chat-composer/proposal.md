# Proposal

## Why

四个聊天面（五个工作台技能聊天、3D 调度、创意会话、发布助手）共用同一个文字输入组件，却各自用不同方式处理「参考来源」：技能聊天在面板顶端挂一条只收图片的附件栏，3D 调度在面板顶端放一条来自左侧选择器的只读清单，创意会话把上传条放在输入框下方，发布助手什么都没有。用户在每个面都要重新学一遍「从哪里带参考进去」，而且其中三个面根本没有上传入口。

同时存在两个已实现但违背规格的行为：视觉理解进行中输入框被整体禁用；只带附件不带文字点发送时什么都不会发生，也没有提示。

本次只做第一切片：把输入区统一，并让「上传 / 从素材选」成为所有聊天共同的参考来源入口。文档解析与视频上传留到后续切片，避免把高风险链路（服务端上传口、`/api/frames` 路径解析、Blender 资产）卷进来。

## What Changes

- 附件能力从「各面板各自的位置」收进共用的聊天输入区：附件条位于输入框上方，与发送按钮同属一个整体，四个聊天面外观一致。
- 附件从「只有图片」扩成 `image | video | doc` 三类统一模型，类型由文件本身决定；切片 1 实际启用 `image`（`video` 仅限 3D 从素材库选，`doc` 留待切片 2）。
- 每个接受附件的面新增两个入口：上传本地图片、从项目素材里选。素材选择器复用既有的缩略图选择器，不再有「选完才被告知只收图片」的拒绝路径。
- 3D 调度的附件条改为同一外壳，但内部语义不变：它编辑的仍然是按镜头持久化的 `shot_3d_context`，上传与选择都写回该镜头的 `imageUrls` / `videoUrls`，并保留 `brief` 排除开关与「查看将发送」检查器。
- **行为变更**：附件在本次对话内跨轮保留（原先注释写「本轮」但代码从不重置，现明确为对话级）。
- **行为变更**：允许只带附件、不带文字发送；此时用户消息带一句可读的占位说明，不再静默失败。
- **行为变更**：视觉理解进行中不再禁用输入框；输入可继续，发送按已就绪的上下文执行或明确提示，不再整块锁死。
- 修复：附件条按 `kind` 分流渲染与去重，避免文档附件被当作图片渲染。

### 明确不在本次范围

- 文档（txt/md/csv/tsv/json/docx/pdf）解析与正文抽取。
- 视频文件上传与抽帧摘要；`/api/frames` 对 `/project-assets` 的路径解析 bug。
- 服务端新增加的上传接口；本次上传仍走现有 40MB JSON 通道，且只用于图片。
- 技能模板新增 `{{input:attachments}}` 占位符；本次附件内容只进入本轮用户消息。

## Capabilities

### New Capabilities

- `chat-composer`: 定义所有聊天共用的输入区契约——附件条的位置与结构、附件类型模型、上传与从素材库选两个入口、附件在不同聊天面的去向（sink）、仅附件发送与跨轮保留语义。它回答「聊天输入区长什么样、附件从哪来、到哪去」，不负责各面附件的内部消费方式。

### Modified Capabilities

- `workbench-chat-context`: 修改「附件清单是模型输入的唯一来源」「附件在发送前可见且可移除」「视觉理解必须先于同步渲染算好」三条要求，明确附件作用于整段对话而非单轮、仅附件也能发送、理解进行中输入框保持可用且不静默丢弃。新增附件条位于输入区的定位要求，并保留 `brief`/检查器的既有行为。
- `shot-3d-context`: 修改「选择内容必须真正进入生成和聊天」与「选择结果按镜头持久化」两条要求，把 3D 聊天里的上传与素材选择也纳入持久化镜头上下文，并明确附件条与左侧选择器编辑的是同一份数据。

## Impact

**前端（主要）**

- `src/agent/ChatThreadShell.tsx`：`ChatThreadBody` 增加附件槽位参数，输入区工具栏承载上传/选素材/附件 chip。
- `src/agent/ChatAttachmentBar.tsx`：从面板顶端独立块改为输入区内的条带，按 `kind` 渲染，接收统一的 sink 回调。
- `src/agent/chatAttachments.ts`：`ChatAttachment` 增加 `kind`、`text`、`bytes`；指纹计算按类型分组。
- `src/agent/SkillChat.tsx`：附件状态上移到输入区、修复 `digestBusy` 锁输入与静默丢弃、把附件摘要并入本轮用户消息而非技能模板输入。
- `src/agent/SceneAgentChat.tsx`：把 `ChatContextTray` 并入统一附件条，接入上传与选素材回调；保留 `brief` 与检查器。
- `src/SceneCodeWorkbench.tsx`：新增「上传图片 → 刷新 media → 写回 context」链路；`removeAttachment` / `toggleBrief` / `clearAttachments` 直接接到新槽位。
- `src/CharacterBoard.tsx`、`src/ScriptBoard.tsx`、`src/AssetBoard.tsx`、`src/ShotTable.tsx`、`src/PromptTable.tsx`：适配器声明可收类型，复用既有上传与选择器；角色面去掉「选完再拒绝视频」的分支。
- `src/creative/CreativeStudio.tsx`：上传条入口并入工具栏。不做「从素材选」——创意摄取走服务端 `assertPublicUrl`，项目内本地 `/videos/...` 会被判为非公网地址而拒绝，改造成本不属于本切片。
- `src/publish/PublishChatPanel.tsx`：接入同一输入区外壳，但本次不声明附件来源——封面写入需要比例维度（9:16 / 3:4 / 16:9），通用附件表达不了，留待发布切片。
- `src/theme.css`：`.ca-*` 样式改为输入区内条带。

**服务端**

- 无新增接口。复用 `/api/save-image`、`/api/media`、既有的素材选择器数据源。

**验收脚本**

- `verify-chat-attachments.mjs`、`verify-character-chat-attachments.mjs`、`verify-workbench-chats.mjs`、`verify-agent-chat-ui.mjs`、`verify-shot-3d-chat.mjs`、`verify-3d-context.mjs` 依赖 `data-ca-*` 选择器与附件栏文案，需要随新外壳同步更新断言。
