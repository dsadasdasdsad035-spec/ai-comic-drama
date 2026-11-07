# Design

## Context

见 `proposal.md`。`SceneAgentChat` 依赖 `getSkill('scene3d')`；失败时 `catch` 为空且 `disabled={!sceneSkill}`。`SkillChat` 已有成熟的 `clearConversation`（`clearGen`、abort、`clearChatThread`）。3D 线程键为 `{ project, surface: 'scene3d', shotId }`。

## Goals / Non-Goals

**Goals:**

- 恢复内置 `scene3d` 技能在声明 full_host 工具后的可加载性。
- 技能失败有可观察 UI；正常加载后输入与发送可用。
- 3D 聊天具备与内容工作台对齐的清空流程。

**Non-Goals:**

- 不改 `skills/scene3d/SKILL.md` 的工具列表（仍声明宿主工具）。
- 不把 3D 迁到 `SkillChat` / `WorkbenchHeader` 全家桶；仅在 3D 侧栏加轻量清空入口。
- 清空不删 job 沙箱目录清理策略（沿用现有 cancel on unmount）。

## Decisions

1. **白名单同步**  
   在 `KNOWN_TOOL_IDS` 增加 `run_bash`、`read_file`、`write_file`、`list_dir`，与 agent 运行时注册一致。替代方案：从 SKILL 移除四工具——会破坏 full_host 文档与模型提示一致性，否决。

2. **输入门控**  
   - 加载中：可 `disabled` 或占位「正在加载技能…」。  
   - 加载失败：`skillError` 状态 + 条带/toast；`disabled` 仅拦**发送**（`sendDisabled`），输入保持可编辑以便用户看提示与重试。  
   - `run()` 仍在无 `sceneSkill` 时 toast 并 return。  
   替代：保持整框 disabled——正是当前用户痛点，否决。

3. **清空实现**  
   从 `SkillChat.clearConversation` 抽取相同顺序：`clearGen++` → abort agent + cancel host job → `await clearChatThread(threadKey)` → `setMessages([])`、`messagesRef=[]`、关 inspector。  
   UI：在 `ChatThreadBody` 上方或技能芯片行增加「清空对话」链接；空消息时 `disabled`。  
   附件：**不清**镜头参考（规格与镜头表「只清会话」一致）；`onClearAttachments` 仍独立。

4. **验收**  
   - 单元：`parseSkillRecords` 内置 scene3d 必须 `skills.has('scene3d')`。  
   - 脚本：扩展现有 verify 或新增最小 HTTP/组件断言（清空 DELETE + 空态）。

## Risks / Trade-offs

- [技能服务返回坏覆盖] → 已有退回内置逻辑；仍须在 UI 展示 `issues` 摘要。  
- [清空后 500ms save 写回] → 复用 `clearGen` 与 `messagesRef` 同步，保存 effect 在 `!messages.length` 时仍可 DELETE（与 SkillChat 一致，实现时对照）。  
- [运行中清空与 host job] → `finally` 与 `cancelAgentJob` 与 abort 同路径。

## Migration Plan

单 PR：白名单 + UI；无数据迁移。发布后用户刷新即恢复发送；旧持久化线程仍可通过新清空入口删除。

## Open Questions

- 清空入口是否也要在 3D 顶栏（非仅聊天 Tab）——默认仅聊天 Tab 内，与「清空对话」语义一致。
