# VGGT POC Gate 清单

POC 通过后再开 Phase 2（Blender `pose(t)` 草稿）。

- [ ] 同一参考 mp4 连续跑 2 次，关键帧位姿趋势人工判定一致
- [ ] 实拍样例 ≥3 条：`confidence` 为 high 或 medium
- [ ] 强风格 AI 样例 ≥1 条：UI 显示 low + warnings，复制到聊天需二次确认
- [ ] 分析失败/取消后 `sceneCode`、`schedule_video` 与 DB 快照不变（`verify-vggt-poc.mjs`）
- [ ] Agent 仅凭粘贴 `motionSummaryZh` 可在 ≤2 轮内写出方向正确的机位（人工评）
