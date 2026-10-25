# Proposal

## Why

3D 工作台首次打开某个镜头时，会自动勾满首帧、角色、场景卡、道具、图片和全部镜头文本，并立刻用这份默认选择生成一版 3D 代码；聊天也自动带着这一大包参考。用户想用聊天创建场景时，反而要先清理一堆没选过的参考。聊天创建应该从空白开始：参考由人从左侧手工加入，镜头文本只作为输入框草稿，模型不自动跑。

## What Changes

- 首次打开没有保存过 `shot3DContext` 的镜头时，参考内容从 0 项开始：媒体、文本和场次键都不自动勾选；已保存的选择仍按原样恢复。
- 镜头文本预填到聊天输入框，作为可编辑、不自动发送的草稿；只预填尚未被选进参考的文本项。用户可以改、删或直接发送。
- 打开无代码镜头时不再自动调用代码模型；预览显示空状态和显式的「生成 3D 代码」按钮，聊天是另一个显式入口。
- 维持一份清单：左侧勾选就是聊天参考，聊天 chips 显示同一份；chip 的 × 只取消左侧勾选。聊天空参考时给出明确引导。
- 画布「一键出片」在没有保存选择时继续使用 `catalog.defaults`，本次不改变这条显式出片路径。
- 更新验收脚本：空镜头不再自动生成；新增聊天创建流程的验收（0 项起步、输入框预填、不自动调模型、加参考后只把已选素材发给 agent）。

## Capabilities

### New Capabilities

无。本次只修改已有行为，不引入新能力。

### Modified Capabilities

- `shot-3d-context`: 首次打开不再默认勾选参考；镜头文本改为预填聊天输入框的可编辑草稿，不计入参考选择。
- `scene-blocking-3d`: 「打开 3D 即准备生成」改为打开不自作主张生成，空状态等待用户显式生成或聊天。
- `scene-agent-chat-ui`: 聊天输入框预填镜头文本；参考条空状态与"左侧勾选即聊天参考"的语义。

## Impact

- `src/SceneCodeWorkbench.tsx`：首次打开的初始上下文、`init()` 自动生成分支、`catalog.defaults` 的工作台用法。
- `src/agent/SceneAgentChat.tsx`：接收镜头文本草稿并在挂载时写入 composer，不自动发送。
- `src/chat-ui/*`：参考条空状态提示、输入框预填后的可访问性。
- `src/agent/sceneAgentTools.ts`：`get_shot_context` 的描述不再声称自动包含镜头文本。
- `verify-code-auto-legacy.mjs`、`verify-code-workbench.mjs` 及新增聊天创建工作台验收脚本。
- 画布一键出片（`src/App.tsx`）保持现有 `catalog.defaults` 回落，不在本次范围内。
