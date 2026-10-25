# Tasks

## 1. 工作台首开状态

- [x] 1.1 在工作台侧新增“空初始上下文”（媒体、文本、场次键为空，保留当前镜头的 `dialogueHash`），仅在没有保存过 `shot3DContext` 时使用；`catalog.defaults` 保留给画布一键出片。验证：打开无保存选择的镜头时左侧显示 0 项，`verify-3d-context.mjs` 仍通过。
- [x] 1.2 删除 `init()` 中“无代码且非 legacy 时自动 `generateCode(true)`”的分支，保留有代码时的基线、试运行和预览，以及 legacy 只读分支。验证：新开无代码镜头不产生代码模型请求，预览显示“还没有代码”。
- [x] 1.3 检查空预览状态：无参考时提示先选择或聊天；有模型且已选至少一项参考时显示「生成 3D 代码」，无模型时提示手写；预览头部生成按钮同样在无参考时禁用。验证：两种配置下空状态文案和按钮正确，点击生成只触发一次。
- [x] 1.4 更新 `verify-code-auto-legacy.mjs`：首开断言 0 次代码模型调用和空状态，点击「生成 3D 代码」后一次调用并出代码；legacy 转换路径保持不变。验证：脚本通过。
- [x] 1.5 更新 `verify-code-workbench.mjs`：确认已有代码路径不受影响，并覆盖“已选文本不重复预填”；空状态由 `verify-code-auto-legacy.mjs` 和 `verify-chat-first-3d.mjs` 覆盖。验证：脚本通过。

## 2. 聊天输入框预填

- [x] 2.1 组合镜头文本草稿（`画面` / `运动` / `出场角色` / `台词` / `标注`），只包含非空项，跳过已经被选进参考的文本项；通过新 prop 传给 `SceneAgentChat`。验证：打开有 prompt、台词、运动提示的镜头，草稿内容完整且没有重复项。
- [x] 2.2 挂载时若 composer 为空且没有消息，用 `useAui().composer.setText` 写入一次草稿；不调用发送；用 ref 记录已预填，清空或发送后不再写入。验证：预填后发送按钮可用但不自动发送；清空后不复发；发送后不重复预填。
- [x] 2.3 给输入框设置最大高度和内部滚动，避免长提示词把聊天消息区挤没。验证：长 prompt 下消息区和输入框都可滚动。
- [x] 2.4 新增 `verify-chat-first-3d.mjs` 覆盖预填：0 项参考、输入框含镜头文本、无代码模型调用；发送后文本作为用户消息进入对话。验证：脚本通过。

## 3. 聊天参考条与一份清单

- [x] 3.1 聊天参考条为空时显示“从左侧添加参考”的引导；非空时保持现有 chips 和移除操作。验证：首开无参考时引导可见，勾选后消失。
- [x] 3.2 确认 chip 移除只取消左侧勾选（一份清单），不静默加入其他素材；`prepareAgent` 和 `get_shot_context` 只使用当前选择。验证：勾选两张图、移除一张后发送，agent 上下文只含剩下的一张，左侧对应项同步取消。
- [x] 3.3 把 `get_shot_context` 的描述改为“读取当前镜头的元数据、已选参考和当前代码摘要”，不再声称自动包含镜头文本。验证：工具卡描述与实现一致，mock 验收通过。
- [x] 3.4 在 `verify-chat-first-3d.mjs` 增加“加参考 / 移除 chip”场景。验证：脚本通过。

## 4. 集成验收

- [x] 4.1 运行 `openspec validate chat-first-3d-workbench`，确认 spec delta 合法。验证：命令返回 valid。
- [x] 4.2 运行相关验收：`verify-code-auto-legacy.mjs`、`verify-code-workbench.mjs`、`verify-chat-first-3d.mjs`、`verify-3d-context.mjs`、`verify-agent-chat-ui.mjs`。验证：全部通过。
- [x] 4.3 手工验收：新开一个无保存选择的镜头，确认左侧 0 项、输入框有镜头文本、无模型调用；勾一张角色图后聊天，确认 agent 只收到该图；清空输入框后不复发；点「生成 3D 代码」只调用一次。验证：观察并保存截图/录屏证据。
- [x] 4.4 回归画布一键出片：没有保存选择时仍使用 `catalog.defaults` 生成，不因本次改动退化。验证：`verify-canvas-code-fallback.mjs` 通过。

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived specs include the updated `shot-3d-context`, `scene-blocking-3d`, and `scene-agent-chat-ui` requirements.
