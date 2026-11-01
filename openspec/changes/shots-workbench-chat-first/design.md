# Design

## Context

`ShotTable.tsx` 当前结构：`WorkbenchBar` + `.wb-gen`（`brief` + `generate()` 拆镜）+ 可编辑 `<table>` + 右侧 `WorkbenchChatAside`。聊天已绑定 `shotlist` 技能、`submit_shots` 与 `split_shots` 内置动作（与顶栏共用 `runSplitRef`）。剧本页已完成类似改造（见 `script-board-chat-only-generation` 归档变更）。详见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 删除 `.wb-gen` 与顶栏/页内拆镜入口；移除 shots 的 `split_shots` builtin 注册。
- 保留左侧镜头表格编辑、保存、导入、增删、表演、孤儿清理、推画布。
- Agent 宽屏默认展开（shots surface）；空态与 profile 指向聊天产镜。
- 剧本「拆这一集 →」：切 view + 集号 + 打开 chat（`setChatOpen(true)`）。
- 清空聊天时仍能取消进行中的 agent 文本/合并（沿用 SkillChat 现有 abort）。
- 更新验证脚本与 README。

**Non-Goals:**

- 把左侧表格改成只读卡片（用户要求仍可编辑保存）。
- 变更 `shots-v1`、`skills/shotlist` 工具列表或 `mergeGenerated` 语义。
- 移除镜头表「导入」或 settings 里 `stage: shot` 模型配置。
- 在本变更内归档 `workbench-chat-actions` 主 spec（仅文档注明镜头表例外）。

## Decisions

1. **只删 UI 与 builtin，保留 `runSplitRef` 逻辑可选删除**  
   - 顶栏 `generate()` 与 `brief` state 一并移除；内置 `split_shots` 从 `chatAdapter.builtins` 去掉。  
   - 备选：保留 hidden API 供测试 — 不采用，测试改走聊天 mock/`submit_shots`。

2. **产镜输入改为 Agent 工具链，不保留本地 `brief`**  
   - 模型通过 `read_episode` 读场次；用户可在对话粘贴补充，不必同步到页内 textarea。  
   - `chatAdapter.inputs()` 仍可传 `style`/`aspect`/`target`，`brief` 可从当前集 `describeEpisode(episodes)` 在发送任务卡时计算，但不渲染为可编辑控件（与 profile `inputLabels.brief` 仍可显示在 inspector）。

3. **布局：左表右聊，不改为上下**  
   - 沿用 `wb-with-chat`；删除 `.wb-gen` 后表格占满左侧主列。  
   - 备选：左卡片 — 与「可编辑保存」+ 现有 PerformanceEditor 表格行展开冲突大，不采用。

4. **shots 聊天默认展开**  
   - 在 `useWorkbenchChatOpen('shots')` 首次默认值改为 true（或 shots 专用：无 localStorage 时 true），窄屏仍可按现有 &lt;1440 收起。  
   - 备选：强制永远展开 — 影响窄屏，不采用。

5. **workbench-shell 强调按钮**  
   - 有 dirty 时保存可强调；「推画布」若存在，不与拆镜竞争（拆镜已不存在）。保持与现 `ShotTable` 动作区一致即可。

6. **测试**  
   - `verify-workbench-builtin-actions.mjs`：镜头表用例改为断言无顶栏拆镜、无 builtin 拆镜，聊天可 `submit_shots` 或 mock agent。  
   - `verify-workbench-builtin-real.mjs`：真实拆镜改经聊天对话触发，或跳过 shots 的 builtin 段。  
   - 新增/更新选择器：确认无 `[data-split-shots]` / `.wb-gen`（若加 data 属性便于测）。

## Risks / Trade-offs

- **[Risk] 用户习惯顶栏一键拆镜** → 空态与 `WORKBENCH_PROFILES.shots` 明确示例句；Agent 默认展开。  
- **[Risk] 无 `brief` 时内置路径消失，长补充只能对话粘贴** → `read_episode` + 对话附件/粘贴覆盖。  
- **[Risk] 与 `workbench-chat-builtin-actions`「一一对应」文档冲突** → README + proposal 注明镜头表与剧本同为 chat-first 例外。  
- **[Risk] Agent 产镜比一键拆镜慢/贵** → 非本变更范围；保留 settings 环节模型选择。

## Migration Plan

- 单 PR：前端 + 文案 + 测试；`project.json` 无 schema 变更。  
- 回滚：恢复 `.wb-gen` 与 `split_shots` builtin 即可。

## Open Questions

- 无。左侧保留完整表格编辑为 explore 已确认范围。
