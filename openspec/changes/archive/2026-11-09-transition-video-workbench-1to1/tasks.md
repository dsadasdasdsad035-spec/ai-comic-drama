# Tasks

## 1. 拼装层 issue 与映射

- [x] 1.1 将 `TransitionVideoPreview.blocking`/`warnings` 改为 `VideoRequestIssue[]`，补齐转场专用 code 与文案迁移，运行 `node verify-transitions.mjs` 断言 code 存在
- [x] 1.2 提供 `transitionPreviewToPromptPanelModel()`（或等价）生成摘要行、正文来源标签与 `vp-refs` 行（含首尾帧前缀），单测或 verify 覆盖首尾帧 + 图N 同列表

## 2. 共用出片提示词面板

- [x] 2.1 从 `Inspector.tsx` 抽出 `OutgoingVideoPromptPanel.tsx`，分镜视频 Tab 改用且手改/stale/meta 行为不变（对照现有分镜手测：编辑、恢复、vp-meta）
- [x] 2.2 为转场接入同一面板：`advancedSlot` 收纳「转场参考与边界」折叠（继承/排除/增补/路径/刷新），主 `vp-refs` 无第二套列表
- [x] 2.3 手改时于「画面与过渡」「声音描述」显示 `vp-field-note` footnote，与分镜运动提示词一致

## 3. TransitionPanel 布局 1:1

- [x] 3.1 重组 `gen-box vid-box` 顺序对齐 `Inspector` 视频 Tab（含 `vid-note`/`vid-refs` 句式）；成片时长移出 gen-box 中部
- [x] 3.2 移除或折叠 `tr-foot` 时间轴摘要，改接缝区一行说明或默认收起到高级区
- [x] 3.3 底栏文案改为「生成视频 / 重出视频 / 出片中…」，running 时保留「取消生成」；footnote 与分镜一致

## 4. 生成路径与元数据

- [x] 4.1 抽取 `videoOmitToasts()`（或复用分镜逻辑），`generateTransitionVideo` 在 running 前拦截 `blocking[0]` 并 toast 省略项
- [x] 4.2 成功出片写入转场 `VideoMeta`（prompt/model/createdAt/url），面板「当前视频的提示词」可展开
- [x] 4.3 扩展 `verify-transitions.mjs`：blocking 阻止路径、meta 字段、底栏文案探针（若可行）

## 5. 验收

- [x] 5.1 编写 `ACCEPTANCE.md`：分镜 S02 视频 Tab vs 转场生成右侧 DOM 顺序对照表、功能清单（preview=请求、meta、toast、单列表）
- [x] 5.2 本地执行 `node verify-transitions.mjs` 与相关 video 验证脚本全绿并记入 ACCEPTANCE

## Workflow follow-up

- 实施完成后 `/opsx-archive transition-video-workbench-1to1` 合并主 spec。
- 可与 `transition-video-shot-parity` 一并归档或先归档 parity 再本 change。
