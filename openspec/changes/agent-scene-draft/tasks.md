# Tasks

## 1. 草稿存储与路由

- [x] 1.1 新增服务端草稿存储：固定目录 `.scene-drafts/<project>/<shot>/draft.py`，实现 begin/append/read/patch/commit 读取与写入；路径规范化拒绝绝对路径、`..` 和符号链接；总量 200KB、单次写入 32KB、单次读取 200 行/8KB。验证：Node 单测覆盖路径穿越、大小上限、append/patch/read 行号
- [x] 1.2 新增 `/api/scene-draft` 路由（begin/append/read/patch/commit/discard + 预览读取）；草稿标识随机且映射到会话内固定路径，清理后返回 404。验证：脚本覆盖正常读写、任意路径拒绝、清理后 404
- [x] 1.3 实现清理策略：begin 重置、discard/关闭工作台/启动 sweep 删除草稿目录；`.gitignore` 加入 `.scene-drafts/`。验证：取消或关闭后目录不存在，旧目录在启动时被清理

## 2. Agent 工具与会话

- [x] 2.1 扩展 `SceneAgentSession` 与事件类型：草稿标识、行数、字符数、提交状态；新增 `draft_started/progress/committed/discarded`，事件不包含完整代码。验证：`tsc --noEmit` 通过，单测断言事件载荷
- [x] 2.2 实现草稿工具族：`begin_scene_draft`、`append_scene_draft`、`read_scene_draft`、`patch_scene_draft`、`commit_scene_draft`、`discard_scene_draft`；commit 读取草稿、执行 `checkSceneCode`、设置 `session.code`/哈希/行数并重置试运行/抓帧/验收。验证：工具单测覆盖分片、patch、提交失败保留旧代码、旧 Three.js 拒绝
- [x] 2.3 保持提交与试运行边界：`commit_scene_draft` 不调用 `onDraftCode`；`run_render` 通过后才更新工作台草稿；`set_scene_code` 内部走"写入草稿 + 立即 commit"。验证：mock 测试断言 commit 后工作台草稿不变，试运行通过后才变
- [x] 2.4 实现历史压缩：`historyPrompt` 把已提交前的 `begin/append/patch` 工具调用与结果折叠为草稿摘要，保留最近 4 次未提交操作及 `read`/`commit` 结果。验证：history 快照单测
- [x] 2.5 更新 agent 提示词与工具说明：加入草稿工具，长代码优先草稿；保留 `set_scene_code` 说明。验证：提示词快照包含新工具名

## 3. UI

- [x] 3.1 草稿卡：展示行数、字符数和状态（暂存 / 已提交，待试运行 / 已生效 / 失败），随事件更新；失败显示原因。验证：Playwright 覆盖分段进度、提交、失败
- [x] 3.2 只读草稿预览：打开当前草稿并固定标注"未试运行"，不提供保存/运行入口；代码页签继续显示已通过试运行的代码。验证：Playwright 检查预览标记与代码页签内容
- [x] 3.3 提交/试运行状态联动：commit 后卡片显示"已提交，待试运行"；`run_render` 通过后显示"已生效"且代码页签更新。验证：Playwright 全流程

## 4. 验证与文档

- [x] 4.1 单测：草稿存储路径/大小、工具分片与 patch、历史压缩、事件载荷。验证：测试脚本全绿
- [x] 4.2 Playwright：长代码 begin → append → read → patch → commit、只读预览、提交失败保留旧代码、`set_scene_code` 兼容。验证：端到端脚本通过
- [x] 4.3 回归：工作台、chat-first、legacy 只读、画布出片、`npm run build`。验证：全部通过
- [x] 4.4 README 更新：草稿工具、单次/总量限制、安全边界、`.scene-drafts` 清理。验证：文档描述与实现一致

## Workflow follow-up

- 归档前先同步 `scene-agent-runtime` 与 `scene-agent-chat-ui` 主规格。
- 注意与已完成的 `chat-context-transparency` 变更合并时，`get_shot_context` 的代码摘要应读 `session.code`，不要回退到工作台快照。
