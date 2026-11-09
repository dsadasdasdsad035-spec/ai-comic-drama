# Acceptance：转场出片工作台 1:1

## DOM 顺序对照（分镜视频 Tab vs 转场生成 `gen-box`）

| 顺序 | 分镜 `Inspector` 视频 Tab | 转场 `TransitionPanel` 生成 |
|------|---------------------------|------------------------------|
| 上区 | 运动提示词 | 成片时长 → 画面与过渡 → 声音描述（+ 手改 footnote） |
| 1 | 出片设置 + 估价 | 同 |
| 2 | 成片预览 | 同 |
| 3 | `VideoOutgoingModelRow` | 同 |
| 4 | `gen-controls` / vid-len | 同（含 bridging 文案） |
| 5 | 原生音频 | `TransitionNativeAudioBlock`（禁用） |
| 6 | vid-note | 同句式 |
| 7 | vid-refs 摘要 | 同（合并上/下镜） |
| 8 | `OutgoingVideoPromptPanel` | 同组件 |
| 底栏 | 生成视频 / 重出视频；blocking → 首条 message | 同文案；running → **取消生成**（例外） |

转场专有：**转场参考与边界** 在提示词面板 `advancedSlot`（`details`），非第二套主列表。

## 功能清单

- [x] 预览与请求共用 `buildTransitionVideoRequest`
- [x] `blocking`/`warnings` 为 `VideoRequestIssue[]`（含 code）
- [x] 生成前 `blocking[0]` 阻止 running + toast
- [x] 省略参考 `videoOmitToastMessages` toast
- [x] 成功写入 `generated.video.videoMeta`
- [x] 手改时分层字段 footnote
- [x] `tr-foot` 移除；时间轴摘要收到成片时长行 / 效果模式一行 note

## 验证命令

```bash
node verify-transitions.mjs
```

2026-11-09：上述脚本全绿。
