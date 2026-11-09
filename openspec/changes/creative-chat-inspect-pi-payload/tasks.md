# Tasks

## 1. 载荷组装（单一真相源）

- [x] 1.1 新增 `buildCreativeTurnPayload`（`src/creative/` 或 `workbenchChat.ts` 旁）：输入 host、readonly、messages、draftText；输出 system、userForModel、toolNames；system 调用极简 `buildCreativePiSystem`（无 mode/session/只读名单）。验证：单元或内联断言对固定 fixture 输出稳定字符串。
- [x] 1.2 抽取 `assembleCreativeUser(draft, messages)` 与 `stageRunner` 历史前缀规则一致。验证：`npx tsc --noEmit` 通过。

## 2. 检查器 UI

- [x] 2.1 `CreativeStudio` 提升 composer 草稿 state/ref，供检查器读取。验证：输入未发送文字时 state 可读到。
- [x] 2.2 `CreativeHeader` 增加「查看将发送」与 `inspectOpen`；展开时渲染 `WorkbenchInspector`（或 creative 包装）展示 system、task=合成 user、readTools=工具列表。验证：手测展开可见三块内容。
- [x] 2.3 `run()` 改调 `buildCreativeTurnPayload`，删除内联 `buildPiAgentSystem` + 手写 user。验证：发送一轮后检查器内容与 Network/日志中的 system 一致（手测或 mock）。

## 3. 技能与模式解耦

- [x] 3.1 移除无条件 `mode → hostSkillId` effect；实现 `skillFollowsMode`（手选下拉置 false；可选「跟随模式」恢复）。验证：手选技能后切 Tab 技能不变。
- [x] 3.2 新会话与「跟随模式」为 true 时仍应用 `MODE_SKILL[mode]`。验证：新建反推会话默认宿主为反推技能。

## 4. 验收脚本

- [x] 4.1 新增 `verify-creative-payload-inspect.mjs`：打创意页、打开检查器、断言存在 system/user 区与 `read_skill` 在工具列表；模拟改下拉后 system 不含 `创意模式`。验证：`node verify-creative-payload-inspect.mjs` 退出码 0。

## Workflow follow-up

- 实现完成后运行 `openspec validate creative-chat-inspect-pi-payload --strict`，再按需 archive。
