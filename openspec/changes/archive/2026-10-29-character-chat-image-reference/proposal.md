# Proposal

## Why

角色卡已经有参考图（`referenceImages`，上限 4 张），但它只是生成三视图时的输入——写外观锚点仍然只能靠人打字或让文本模型从剧本里猜。手上有角色定妆照的人，最自然的动作是「把图给模型，让它照着图写锚点」，现在无处可做。与此同时五个工作台聊天（剧本/角色/素材/镜头表/提示词）全是纯文本通道，`SkillChat` 只读 `adapter.inputs()` 的三段文本，连一张图都送不进去；而 3D 场景聊天早就有附件清单、发送前检查器和视觉 brief。同一套需求在两处能力不对等。

## What Changes

- 角色聊天增加图片附件：从该角色已有的参考图里挑选（也可现场上传，上传即写入 `referenceImages`），附件在发送前可见、可移除。
- 图片先经视觉模型理解，产出结构化的外观要点，再交给角色技能写 `look_cn` / `look_en`。多张参考图拼成一张带标签的 contact sheet（`/api/vision` 只收单张 dataURL、≤4MB）。
- 锚点写入支持「明确要求改已有角色」：模型在角色条目上带 `update: true` 时才覆盖已有锚点，否则维持「已有 `look_en` 就跳过」的既有规则。覆盖后表情总图按既有机制标失效。
- 生成三视图改为**用户确认**的第二步：角色回执卡出现「用它生成三视图 · ¥0.44」按钮，点击才调 `/api/seedream`（`cap: 'view'`，`refImages` = 该角色参考图）。聊天不自作主张花钱。
- **BREAKING**（内部契约，非用户可见）：`ContextManifest` 的必填 `shot: { no, duration, aspect }` 泛化为 `scope`，使附件托盘 `ChatContextTray`、发送前检查器 `ChatContextInspector`、每轮审计卡能服务非镜头场景的工作台聊天。3D 场景聊天的行为不变。
- 视觉模型未配置时降级：只用文本锚点，图片仅作为出三视图的 `refImages`，回执里明确写出「没配视觉模型，没看图」。
- 不做：聊天里不经确认直接出图、视频/音频附件进入角色聊天、跨项目引用参考图、表情总图在聊天里生成。

## Capabilities

### New Capabilities

- `workbench-chat-context`: 工作台聊天的模型上下文——附件清单作为唯一输入来源、发送前可见与可移除、图片的先经视觉理解与无视觉模型时的降级、以及「预计算再同步进任务卡」的时序契约。供五个工作台聊天共用，本变更只在角色聊天启用。

### Modified Capabilities

- `character-appearance`: 参考图新增「聊天入口」——从聊天选图作为身份输入、看图产出外观锚点、`update` 覆盖语义，以及由用户在回执上确认后生成三视图这条唯一路径。

## Impact

- 前端新增 `src/agent/chatAttachments.ts`（附件状态、拼 contact sheet、视觉理解缓存与降级）与 `src/intake/` 之外的一个图片选择器（或复用 `MediaPicker` 的 project 页签）。
- 改动：`src/contextManifest.ts`（`shot` → `scope` 泛化）、`src/chat-ui/ChatContextTray.tsx`、`src/chat-ui/ChatContextInspector.tsx`（读 `scope` 后的显示文案）、`src/chat-ui/ChatContextPart.tsx`、`src/agent/SkillChat.tsx`（附件状态 + 预计算 + 同步 inputs）、`src/agent/workbenchChat.ts`（adapter 增加可选附件声明）、`src/agent/workbenchChatContext.tsx`（新增 `onRenderTurnaround` 之类的确认动作）、`src/agent/stageToolUis.tsx`（回执卡按钮）、`src/CharacterBoard.tsx`（角色聊天的附件来源与生图回调）、`src/charExtract.ts`（`mergeCharacters` 读 `update`）、`skills/character/SKILL.md`（看图与 `update` 规则）、`src/theme.css`（附件选择器与回执按钮样式）。
- 不改服务端路由：`/api/vision`、`/api/seedream`、`/api/save-image` 都已具备；`/api/vision` 的「单张 dataURL、≤4MB」是既有约束，靠 contact sheet 满足。
- 数据：不新增项目字段；聊天传的图写入既有的 `characters[].reference_images`（上限 4 张）。
- 兼容：3D 场景聊天的附件清单、检查器、审计卡行为不变（只是类型字段改名）；旧项目与旧聊天记录不受影响。
- 相关但未归档的变更：`chat-context-transparency`（16/16 完成、未归档）为 3D 侧定义了上下文清单与审计。本变更不修改它的 delta 文件，但实现时两者共用 `contextManifest.ts`，需要避免重复造第二套清单结构。
