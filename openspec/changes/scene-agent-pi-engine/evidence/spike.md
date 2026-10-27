# 组 1 验收记录：依赖与浏览器打包 spike

日期：2026-10-26
上游版本：`@earendil-works/pi-agent-core@1.4.0`（精确锁定，无 peer 冲突）

## 依赖

- `package.json` 写入精确版本 `"1.4.0"`（无 `^`）。
- `package-lock.json` 解析到 `1.4.0`，同时带入 `@earendil-works/pi-ai@1.4.0`、`pi-telemetry`、`typebox@1.3.27`、`partial-json`。
- `npm ls @earendil-works/pi-agent-core` 输出单一版本，无冲突。

## 浏览器打包

脚本：`.verify-pi-spike/run.mjs`（临时目录，命中 `.gitignore` 的 `.verify-*/`）。

| 检查 | 结果 |
|---|---|
| esbuild `platform=browser` 打包 | 通过 |
| 产物不含 `node:` 内建 | 通过 |
| 产物不含 `require("node:` | 通过 |
| 产物不含 `process.env` | 通过 |
| 产物不含 `Buffer.from/alloc` | 通过 |
| 浏览器产物直接在 Node 中运行 | 通过（11 项行为检查） |

## 体积

minified、`platform=browser`、es2022：

- 只 `import { Agent }`：**164.7 KB**
- 完整 spike 入口（Agent + typebox + 4 个场景）：198.2 KB

结论：把 `Agent` 引入浏览器产物约增加 **165 KB**（minified，未 gzip）。按 gzip 估算通常在 45–55 KB 量级，低于需要暂停的阈值；本变更按 165 KB minified 作为预算基线。

## 行为验证

全部 11 项通过：

- 工具调用 → 工具执行 → 第二轮文本结束的完整生命周期成立；工具在首个 `turn_end` 之前执行，用户消息先于模型。
- `agent.abort()` 后工具收到 abort signal、不重复执行、循环以 `agent_end` 收尾。
- `finishTurn` 返回 `{ action: 'end' }` 时只发起一次模型请求。
- `finishTurn` 返回 `{ action: 'continue' }` 时可以再请求一轮（复刻 gate 的催促语义）。

## 关键发现（已回写 design.md）

**`agent.abort()` 只中止当前模型流与工具 signal，不会自行终止循环。** 如果 `streamFn` 忽略 `options.signal`，abort 之后循环会继续调度，甚至重复执行工具（spike 初版复现了无限循环）。

因此 `streamFn` 必须：

1. 进入时检查 `options.signal.aborted`，若已中止立即以 `{ type: 'error', reason: 'aborted' }` 结束；
2. 流式过程中监听 signal，中止时推送 aborted 错误事件；
3. 返回 `stopReason: 'aborted'` 的 `AssistantMessage`。

pi 只在收到 `stopReason: 'aborted' | 'error'` 时才把该轮当作硬退出。
