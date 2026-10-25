# 镜头 Inspector 驾驶舱验收图

由 `node verify-shot-inspector.mjs` 生成。项目数据是脚本内 mock（`si-test`），不会写入真实项目。

- `si-day-360.png`：画面页，默认 360px；镜头参数折叠、参考展开、底部固定生成画面。
- `si-day-480.png`：拖宽到 480px 后的重排。
- `si-night-480.png`：夜间主题、480px。
- `si-audio-480.png`：声音页，台词、表演、配音和口型。
- `si-more-480.png`：更多页，手工参考 URL、镜头信息和 3D 调度入口。

同一脚本覆盖：四 tab、默认页、状态 chip、吸底操作、拖宽与折叠持久化、切换 tab 保留草稿、隐藏 tab 媒体暂停、删除确认、素材卡 Inspector 隔离。
