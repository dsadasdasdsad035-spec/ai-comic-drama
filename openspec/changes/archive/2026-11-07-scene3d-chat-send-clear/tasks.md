# Tasks

## 1. 技能白名单（恢复 scene3d 加载）

- [x] 1.1 在 `KNOWN_TOOL_IDS` 登记 `run_bash`、`read_file`、`write_file`、`list_dir`，并在 `tests/skill-parser.ts` 或新用例断言内置 `scene3d` 经 `parseSkillRecords` 可加载（`node verify-skills-unit.mjs` 通过）

## 2. SceneAgentChat 可观察错误与输入

- [x] 2.1 `getSkill('scene3d')` 失败时设置 `skillError` 并 toast/条带展示原因；成功时展示现有技能芯片
- [x] 2.2 技能失败时不再 `disabled={!sceneSkill}` 锁死整框输入，改为 `sendDisabled` + 发送时拦截；验证：技能失败时输入可编辑、发送有说明
- [x] 2.3 `npm run build` 通过

## 3. 3D 清空对话

- [x] 3.1 实现 `clearConversation`（对齐 `SkillChat`：`clearGen`、abort、host job cancel、`clearChatThread`、清 messages/inspector）
- [x] 3.2 聊天 Tab 内增加「清空对话」入口：空线程禁用、有消息确认框；验证：清空后 `GET /api/chat-thread` 无该 shot 消息
- [x] 3.3 运行中清空：生成停止且持久化为空（手动或扩写 `verify-workbench-chat-clear.mjs` / 新增 scene3d 场景）

## 4. 收尾验证

- [x] 4.1 `openspec validate scene3d-chat-send-clear --strict` 通过

## Workflow follow-up

- 实现完成后 `/opsx-apply`，验收后 `/opsx-archive` 同步主规格。
