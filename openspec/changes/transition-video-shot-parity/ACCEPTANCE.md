# 验收：transition-video-shot-parity

## 自动

- `node verify-transitions.mjs` 全部通过（含双镜合并、关键帧提交参考、morph 互斥空 refImages）

## 预览 = 请求

- [ ] 转场「生成」展开后，最终发送正文与网络请求 `prompt` 一致
- [ ] morph + 2.5：面板「将提交」参考图为 0，`refImages` 为空；列表仍显示参考并标互斥原因
- [ ] 关键帧 / 非互斥：`refImages` 与面板将提交 URL 一致
- [ ] 有参考视频时，首条与 `refVideos` 一致

## 与分镜对照

- [ ] 转场面板有出片模型、分辨率、原生音频（禁用）、参考图编号列表
- [ ] 上/下镜 `refExtras`、连线角色、相邻镜 token 出现在转场参考列表
- [ ] 分镜视频 Tab 仍可用（`VideoOutgoingModelRow` 无回归）

## 转场级配置

- [ ] `excludeRefIds` 排除后不出现在将提交列表
- [ ] 关闭「继承两镜画布参考」后仅增补 token 与结构锚点
- [ ] 增补参考持久化 `refIds`

## 交互回归

- [ ] 手改 / 旧快照 / 底栏 blocking 禁用 / 打开上镜下镜 仍正常
