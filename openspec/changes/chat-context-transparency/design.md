# Design

## Context

见 `proposal.md - Why`。当前实现的关键约束：

- `Shot3DContext` 已按镜头持久化，媒体选择通过 `itemIsSelected` 解析；`prepareSceneCodeContext` 只处理选中项。
- 但画布出片在没有保存选择时用 `catalog.defaults`（`App.tsx`），聊天输入框用 `agentDraftText` 自动预填，镜头头始终带景别/运镜（`agentContextText`）。
- 聊天右侧 chips 只显示媒体项，文本开关、场次文本、media brief、视频关键帧不在可视列表里；底部只显示数量。
- 代码模型收到的是文本（键、标签、brief），图片像素只发给视觉模型；两条通道目前没有被分别展示。
- 工具 `get_shot_context` 把上述内容自动拼成一段文本返回给 agent。

## Goals / Non-Goals

**Goals:**

- 模型输入只有一个显式清单；清单之外的任何内容都不进入模型。
- 发送前能看到清单的完整内容，包括派生 brief 和两条通道（视觉/代码）。
- 左边只浏览，右边才附加；首开为空，推荐参考先预览再确认。
- 画布出片和聊天共用同一套 manifest，消除两条路径的不一致。

**Non-Goals:**

- 不做跨项目引用；项目范围仍是当前项目。
- 不改变模型路由、Blender 作业、渲染或视频参考协议。
- 不做逐附件 token 预算或自动裁剪（只在检查器显示预计大小）。
- 不把图片像素发给代码模型；仍只发给声明视觉能力的模型。

## Decisions

### 1. 一个 manifest 作为唯一模型输入

```ts
type ContextManifest = {
  version: 1
  shot: { id: string; no: string; duration: number; aspect: string }
  attachments: Attachment[]
}

type Attachment =
  | { kind: 'image'; key; label; source; url; contentHash; includeBrief: boolean }
  | { kind: 'video'; key; label; url; duration; frameTimes: number[]; includeBrief: boolean }
  | { kind: 'text'; key; name: 'prompt' | 'videoPrompt' | 'dialogue' | 'cast' | 'sizeMove' | 'marks' | 'scene'; label; text }
  | { kind: 'brief'; forKey: string; label; text }
```

- `shot` 只允许镜号、时长、画幅；景别/运镜是 `text` 附件，不再自动出现。
- `Shot3DContext` 仍是持久化存储；manifest 是发送时的投影，不新增第二份真相。
- 所有入口（聊天、代码生成、画布出片）都从同一个 `buildManifest(context, catalog)` 得到输入。

**Alternatives**：直接让模型读 `Shot3DContext`（多一层隐式语义，UI 无法逐项展示）；把 manifest 存进项目（与选择重复，容易出现两份不一致）。

### 2. 两条通道分开展示

```
附件清单 (explicit)
   |
   +---- 图片/视频像素 ----> 视觉模型 ----> media brief（可见、可排除）
   |                                            |
   +---- 文本/键/标签/brief --------------------+----> 代码模型
```

检查器必须分别标注「视觉模型收到 N 张图」和「代码模型收到哪些文本/brief」；用户能理解图片本身没有直接进代码模型。

### 3. 浏览与附加分离

- 左边：项目（当前项目只读显示；切换仍走顶栏）、集数下拉、分类 tabs、缩略图/详情预览。
- 「加入上下文」是唯一附加动作；预览、搜索、切集都不改 manifest。
- 右边：附件栏（chips + 可展开内容）、「本次上下文 N 项」、清空、「查看将发送」。
- 输入框默认空；镜头文本是附件栏里的可添加条目。

**Alternatives**：保留左勾选直接生效（用户已明确否决）；把附件栏做成弹窗（每次发送多一步，且不利于长期可见）。

### 4. 首开为空，推荐参考先预览

- 删除画布路径的 `catalog.defaults`。
- 「推荐参考」按钮展示 `catalog.defaults` 的条目清单（首帧、角色、场景、道具、文本），用户勾选后确认才写入附件。
- 工作台首次打开仍是空附件栏；沿用上一镜仍是显式动作。

### 5. 持久化与本次会话

- 附件按镜头保存（沿用 `Shot3DContext`）；打开聊天时显示「本次上下文 N 项」，可一键清空或逐项移除。
- 持久化附件不会静默发送：它们出现在附件栏里，发送仍是用户动作；检查器在发送前展示完整清单。
- `briefOff`（被排除 brief 的附件键）作为 `Shot3DContext` 的可选字段持久化；缺省为空。

**Alternatives**：每次会话强制清空（安全但丢失连续性）；每次发送弹确认框（打断聊天）。

### 6. 每轮上下文审计

- 事件流新增 `context_manifest` 摘要事件：`{ turn, attachmentKeys, counts, metadata }`，不含图片字节、brief 全文或 Key。
- 聊天为每轮渲染一张可折叠的「本轮上下文」卡；默认折叠，展开显示清单摘要和来源。
- 「查看将发送」展示完整内容（缩略图、文本全文、brief 原文、预计大小），但它不是每轮事件的一部分，避免事件流膨胀。

### 7. 元数据边界

- 自动元数据：镜号、时长、画幅。
- 景别/运镜、台词、cast、标注、场景文本都必须作为 `text` 附件。
- 这条规则同时约束生成提示词和 agent 的 `get_shot_context`。

### 8. 代理与工具契约

- `get_shot_context` 只返回 `buildManifest` 的投影 + 代码摘要（hash/行数），不再自己拼接镜头头、brief 或上次选择。
- 工具结果和附件清单都序列化为文本；图片仍只以 brief/键的形式进入代码模型。
- 事件桥负责把 manifest 摘要发给 UI，不把完整 brief 复制进事件。

### 9. 旧数据与兼容

- 旧项目打开时，已保存的 `shot3DContext` 直接成为附件栏内容；没有保存记录的镜头为空。
- 旧 `catalog.defaults` 只用于「推荐参考」的预览，不再自动生效。
- 不需要 SQLite 迁移；`briefOff` 是可选字段。

## Risks / Trade-offs

- **[空上下文让首次使用变慢]** → 推荐参考一键预览；左浏览到附加只需两步；附件按镜头持久化。
- **[附件栏与左选择两份状态不一致]** → manifest 只从 `Shot3DContext` 投影，左浏览不改状态，附件栏是唯一编辑入口。
- **[brief 生成增加等待]** → 只为已附加图片调用，按内容哈希缓存；检查器显示 brief 是否已就绪。
- **[审计卡让聊天变吵]** → 默认折叠，只显示「N 项附件 · 2 图 · 1 文本」摘要。
- **[系统提示可见可能泄露内部指令]** → 只读展示，不含 Key/鉴权头；如需要可只显示摘要和附件清单，完整提示放在二级展开。
- **[旧项目用户不习惯没有默认选择]** → 首次打开显示空附件栏 + 推荐参考；不自动生成，不自动发送。
- **[画布与工作台路径再次分叉]** → 两边都调用同一个 `buildManifest`，测试覆盖两条路径。

## Migration Plan

1. 先落 manifest + 检查器 + 每轮审计，保持旧的默认选择不变；用测试确认清单与实际发送一致。
2. 再把画布 `catalog.defaults` 改为「推荐参考」预览，工作台保持空首开。
3. 最后移除输入框预填，镜头文本改为附件条目。
4. 回滚：三步都可由同一个 `contextManifest` 开关控制；关闭后回到旧路径，旧附件仍可读。

## Open Questions

- 「推荐参考」的条目集合是否要按项目配置（例如是否包含候选图）？
- 检查器的系统提示展示到哪一层：完整只读、摘要，还是只列附件？
- 被排除的 brief 是否需要跨会话记住，还是每次会话重新选择？（设计默认持久化 `briefOff`。）
