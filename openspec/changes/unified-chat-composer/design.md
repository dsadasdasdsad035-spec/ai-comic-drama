# Design

## Context

四个聊天面共用 `ChatThreadBody` 的文字输入，但附件各走各的：

- 工作台技能聊天：`SkillChat` 在 `ChatThreadBody` 之前渲染 `ChatAttachmentBar`，附件状态是本组件 `useState`，只收图片，上限 4，产出 `referenceDigest` 并只被 `skills/character/SKILL.md` 消费。
- 3D 调度：`SceneAgentChat` 在面板顶端渲染 `ChatContextTray`，数据来自 `manifest`，由 `SceneCodeWorkbench` 的 `shot_3d_context` 派生；聊天内没有上传入口。
- 创意：`CreativeComposerBar` 挂在输入框**下方**，只有 URL 与视频上传。
- 发布：无附件入口。

约束（已在 explore 阶段核实，都是既定事实而非选择）：

1. 聊天文本模型的 `ProviderChatMessage.content` 是 `string`，`callText` 只发字符串；唯一能吃图的是 `askVision`，且只收单张 dataURL。所以非文本附件必须先被翻译成文字。
2. 3D 的附件不是聊天临时态：它决定 `prepared.assets`、`contextFp` 新鲜度和「沿用上一镜」。
3. 创意摄取走服务端 `assertPublicUrl`，项目内本地 URL 会被拒；改造它属于另一条链路。
4. 上传走 `/api/save-image` + 40MB JSON 请求体上限，实际只适合图片。
5. `appendText()` 只取文本，`run()` 里 `if (!text) return` —— 只带附件时点发送是静默失败。
6. `SkillChat` 把 `digestBusy` 并入 `disabled`，视觉理解期间输入框整体不可用。

## Goals / Non-Goals

**Goals**

- 四个面在输入区达到视觉与交互一致，且每个面的附件去向保持其原有语义。
- 让「上传」和「从素材选」在需要它们的面上都可用，不再有「选完才被拒」的路径。
- 修掉静默失败与整块锁输入这两个已存在的行为缺陷。

**Non-Goals**

- 不统一各面附件的内部消费方式（视觉摘要 / manifest / session source / deliverable 各归各）。
- 不引入文档解析、视频上传、新服务端接口。
- 不改 `skills/*/SKILL.md` 的 `inputs` 声明。
- 不改 Blender 渲染链路、`contextFp` 新鲜度判定或 `MediaPicker` 的服务端数据源。
- 不给发布助手加附件（封面需要比例维度，通用附件表达不了）。

## Decisions

### D1：附件条长在 `ChatThreadBody` 内部，而不是各面板自己插

统一后的输入区结构：

```
ChatComposer
  +-- 附件条（可选，仅当声明了 attachment slot）
  |     [图1 x] [视频1 x] [doc1 x]        查看将发送 · 清空
  +-- ComposerSuggestions（可选）
  +-- ComposerPrimitive.Input (textarea)
  +-- actions: [+] 上传 / 从素材选 | hint | 停止 | 发送
```

`ChatThreadBody` 增加一个 `attachments?: ComposerAttachmentSlot`。所有面板都通过它接入，`ChatAttachmentBar` 与 `ChatContextTray` 都改成这条的两种皮肤。

**为什么不让每个面板自己插**：这正是现状的问题来源。附件条一旦由面板渲染，位置就只能靠 CSS 猜，而且每个面板会不可避免地长出自己的交互差异。

**备选**：保持面板各自渲染，只统一样式类。否决——样式统一解决不了「创意在上方、技能在顶部、3D 在顶部只读」这种结构差异。

### D2：`ChatAttachment` 扩成带 kind 的统一类型

```ts
type AttachmentKind = 'image' | 'video' | 'doc' | 'text'

type ChatAttachment = {
  key: string          // image/video 用 url；doc 用内容哈希；text 用既有稳定键
  kind: AttachmentKind
  label: string
  url?: string         // image / video
  text?: string        // doc 正文 / text 项正文（切片 2 才产生 doc）
  bytes?: number
  /** 3D 面专用：brief 排除开关与检查器要能定位回 manifest 条目 */
  manifestKey?: string
}
```

`kind` 决定三件事：附件条怎么渲染、指纹怎么算、sink 怎么消费。切片 1 实际只会产生 `image`（五个工作台 + 3D）、`video`（仅 3D 从素材选）、`text`（3D 的 manifest 文本项）。`doc` 类型先定义不启用，避免切片 2 再改一次公共类型。

**备选**：为 3D 保留独立类型、只在 UI 层做映射。否决——那样附件条要处理两套类型，`ChatThreadBody` 的 props 会变成联合类型，正是要消除的复杂度。

### D3：三个 sink，按面适配，不合并

```
ChatThreadBody.attachments
  |  items / kinds / onFiles / onPick / onRemove / onClear / busy / note / extra
  v
+---------------+---------------------------+---------------------------+
| workbench     | scene3d                   | creative                  |
| (5 surfaces)  | (SceneCodeWorkbench)      | (CreativeStudio)          |
+---------------+---------------------------+---------------------------+
| 本地 useState | shot_3d_context (持久)     | session source (服务端)    |
| -> 视觉摘要    | -> manifest + assets      | -> ingest -> probe -> cover|
| -> 用户消息    | -> contextFp              | -> 工具按 id 读            |
+---------------+---------------------------+---------------------------+
```

`ChatThreadBody` 只负责展示与收集，不感知 sink。sink 由宿主通过回调注入，这与 `workbenchChat.ts` 里 `WorkbenchAttachmentSource` 已有的形状一致，只是把「只有 available/limit/upload/pick」扩成「还能声明 kinds 与持久化语义」。

### D4：技能聊天的附件内容进用户消息，不进技能模板

`composeInputs()` 目前产出 `referenceDigest` 塞进技能模板的 `{{input:referenceDigest}}`。但按下发路径分析，只有 `skills/character/SKILL.md` 声明了这个输入；其余四个技能即使收到附件也是白收。

因此：**附件摘要作为「本轮附件」块并入 `userForModel`**（`SkillChat.tsx` 里拼 `taskCard + 用户要求` 那一处），`referenceDigest` 保持原样供角色技能使用。

```
userForModel = 【本轮技能任务】...
               【本轮附件】
               - 图1（视觉摘要）：短发、深色风衣…
               - 说明.md：...正文...
               【用户要求】
               把这段改成第二镜
```

**为什么**：让附件对五个技能同时生效，且不改任何 `SKILL.md`。代价是附件内容无法被 `renderSkillTemplate` 的引用阈值裁剪（长文档会整段进上下文），这一点用「本轮附件」块的字数上限兜住，而不是靠引用机制。

**备选**：给五个技能都加 `{{input:attachments}}`。否决——要改五份 `SKILL.md` 与版本号，且模板输入是"整份产物"的语义，塞附件会混淆。

### D5：3D 的上传必须经过 media 刷新再写 context

顺序不能反：

```
上传图片 -> /api/save-image 落成 /project-assets/<proj>/<file>
        -> listMedia(project) 刷新 MediaBundle
        -> buildShot3DContextCatalog 重新派生 catalog
        -> setContextSafe({ ...context, imageUrls: [...ctx.imageUrls, url] })
```

原因：`selectedImageInputs`（`sceneCodePrepare.ts`）是从 `catalog` 里按 `url` 查的，而 `catalog` 由 `media` 派生。只写 `imageUrls` 不刷新 media，图片就在上下文里但没有对应的 catalog 条目，表现是"加了图但 Blender 看不到"。

`SceneCodeWorkbench` 已有消费 `media` 的 `useEffect`（依赖 `[loaded, project, media, ...]`），所以刷新 `media` state 即可触发重派生，不需要额外调用。

**备选**：上传后直接把新条目伪造成 catalog item 塞进去。否决——`catalog` 是 `useMemo`/`useState` 派生物，伪造会在下次真实刷新时被冲掉，造成"图时有时无"。

### D6：只带附件发送的占位策略

`appendText()` 只取文本。改动落在 `onNew` 这一层，而不是改 `appendText`（它还被历史恢复与 retry 复用）：

```
onNew(message):
  text = appendText(message)
  if (!text && attachments.length === 0) return      // 仍然不可发送
  if (!text && attachments.length > 0) text = '（见附件）'
  run(text)
```

占位文案固定且可读，作用是让 `begin(text)` 与 `retryLast()` 有内容可存。附件本身仍通过 sink 进入模型，占位不替代附件。

**备选**：让 `appendText` 兼容非文本 part。否决——`AppendMessage.content` 在四个面由不同适配器产生，改它要同时验证四条路径。

### D7：视觉理解期间锁发送、不锁输入

现状 `disabled={!loaded || !hostSkill || busy || digestBusy}` 把两件事绑在一起。拆开：

```
textarea disabled = !loaded || !hostSkill || busy     // 只看"能不能聊"
发送按钮 disabled = 上面的条件 || digestBusy          // 多一个"附件还没准备好"
发送时的 digestBusy 处理：明确 toast「参考图还在理解中，请稍候」
```

**为什么**：`workbench-chat-context` 明确要求"理解未完成时不阻塞界面"。而且附件加上后理解要跑几秒，整块禁用会让用户以为面板卡死。

**备选**：理解期间允许发送并用旧上下文。否决——模型会拿到不含图片的上下文却看到附件条，属于静默降级，比提示等待更糟。

### D8：附件跨轮保留，切项目/集/镜头清空

`SkillChat` 已有 `sessionSig = project|episode` 的 effect 清空附件，保留。需要改的只是文案与注释（"本轮"→"本次对话"），以及 3D 面天然就是持久的、不受此 effect 影响。

### D9：素材入口按面声明，不假设处处可用的

- 五个工作台 + 3D：`pick` 走既有 `MediaPicker`。
- 创意：只有 `upload`（视频），没有 `pick` —— 摄取链路的 `assertPublicUrl` 拒绝本地 URL。
- 发布：两者都没有，不显示附件条。

这对应 `chat-composer` 规格里的「不声明就不出现」。

## Risks / Trade-offs

**3D 上传后忘记刷新 media → 图在条上但生成看不到** → 上传回调封装成单一函数（落盘 → 刷新 media → 写 context 三步不可拆），并在验收里断言"上传后立刻 `prepareAgent` 能拿到这张图"。

**附件摘要塞进用户消息会撑大上下文** → 「本轮附件」块设字数上限；超限时截断并在附件条标注。真正需要全文时走切片 2 的文档通道。

**`ChatAttachment` 加 `kind` 是公共类型变更** → 所有构造点（`CharacterBoard` 的上传/选择返回值、`chatAttachments` 的指纹与拼板）必须同时改；`buildReferenceSheet` 需要先 `filter(kind === 'image')`，否则视频会被当图片解码失败。

**验收脚本大面积依赖 `data-ca-*` 选择器** → 保留这些属性名，只改位置与父容器。这样 `verify-character-chat-attachments.mjs` 的选择器仍可用，只需调整"附件栏在输入区上方"的位置断言。

**发布面不加附件，与"统一聊天功能"的字面期待不符** → 在提案里显式写明原因（封面需比例维度），避免用户以为漏做。

**`ChatContextTray` 的 `brief` 开关要并入附件条** → 该开关是 3D 独有语义（排除媒体 brief）。做法是附件条支持一个可选的 `extra` 槽位渲染每项的附加控件，而不是给附件条加 3D 专有 prop。

## Migration Plan

前端改动，无数据迁移。`shot_3d_context` 结构不变；旧线程里的附件不迁移（本来就没存进线程）。

回滚：`ChatThreadBody` 的新参数是可选参数，不传即回到原行为，因此可以按面板逐个回退。

## Open Questions

- 附件条里视频项在没有封面时的呈现方式（类型图标 vs 首帧抓取）。首帧抓取要调 `/api/frames`，而该接口目前对 `/project-assets` 有路径 bug，留到切片 3 一并处理；切片 1 用类型图标。
