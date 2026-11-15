# Markdown 渲染的体积与流式开销

对应任务 5.2（设计 D9 的实测依据）。测量环境：macOS，Node 22.23，Vite 6.4.4，Chrome headless。

## 构建体积

| 产物 | 改动前 | 改动后 | 差值 |
| --- | --- | --- | --- |
| `index-*.js` 原始 | 2,195.00 kB | 2,376.04 kB | +181.04 kB |
| `index-*.js` gzip | 675.94 kB | 731.77 kB | +55.83 kB |
| `index-*.css` 原始 | 288.16 kB | 290.68 kB | +2.52 kB |
| `index-*.css` gzip | 48.01 kB | 48.49 kB | +0.48 kB |

`react-markdown` + `remark-gfm` + `remark-breaks` 的实际增量是 gzip **约 56 kB**，比设计里预估的「100KB 量级」小一半（删掉死代码 `SkillChat` / `PromptRefineModal` 后，增量里还包含 11 kB 左右的构建抖动，两者均已被 tree-shaking，不构成负担）。桌面 Electron 端可忽略；Web 端如需进一步压缩，可对创意/技能会话做按需 `import()`，不在本 change 范围。

## 流式渲染开销

模拟方式：`.md-harness.html?stream=1`，每 50ms 追加一段（标题 + 说明 + 两条列表），累计 60 段、5,834 字符，全部经过真实 `ChatText` 渲染路径，记录每次提交到下一帧的耗时。

| 指标 | 值 |
| --- | --- |
| 提交次数 | 60 |
| p50 | 4.8 ms |
| p95 | 17.1 ms |
| 最大 | 18.1 ms |
| 相邻提交最大间隔 | 51.6 ms（定时器间隔 50ms，未排队堆积） |

结论：5.8KB 量级、50ms 一次的追加节奏下没有出现持续掉帧，最长单帧 18.1ms 仍在 60fps 预算（16.7ms）附近，属于可接受的一次性抖动。**暂不需要**按 `status === 'running'` 做纯文本降级；若后续出现更长的单轮输出（>20KB）再评估。

## 复现命令

```bash
# 体积（对照改动前后各跑一次）
npx vite build

# 渲染契约与两处会话回归（长期保留）
node verify-chat-markdown.mjs            # 纯函数：标题/列表/表格/代码块/安全
node verify-chat-markdown-sessions.mjs   # 创意会话：轮次前缀 + 富文本 + 用户消息
node verify-chat-markdown-scene3d.mjs    # 3D 会话：工具卡 + 富文本 + 用户消息
```

样式与流式两个数字来自一次性探针（`.md-harness.html` + `.md-harness.tsx`，验完即删）：它把 `ChatText` 挂进真实 `.chat-ui` 作用域，一组断言计算样式，另一组按 50ms 节奏追加文本。需要重测时按同样方式临时重建即可。
