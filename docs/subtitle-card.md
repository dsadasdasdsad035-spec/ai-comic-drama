# 字幕素材卡

画布上的 **字幕素材卡**（`kind=subtitle`）用于从已连线的分镜文案 **一次生成 SRT 文件** 并下载，不写回镜头 `dialogue`。

1. 从分镜拖到字幕卡建立引用，可选 `dialogue` 或 `video_prompt`。
2. 在 Inspector 选择文本模型，点击 **生成 SRT**。
3. 可在文本框中手改正文后保存项目；点击 **下载 SRT 文件**（UTF-8 含 BOM）。

整集字幕导出仍走各镜 `dialogue`，与字幕卡独立。