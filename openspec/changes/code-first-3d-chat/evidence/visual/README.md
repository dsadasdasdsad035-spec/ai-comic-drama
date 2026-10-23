# 3D 代码工作台视觉验收

由 `verify-code-visual.mjs` 和 `verify-code-real.mjs` 生成。

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `workbench-desktop.png` | pass | 1600×1000，三栏布局、参考内容、代码预览、聊天/时间轴 |
| `workbench-day.png` | pass | 日间主题（像素校验：`#fffdf8` 面板） |
| `workbench-night.png` | pass | 夜间主题（像素校验：`#0e1620` 面板） |
| `workbench-900.png` | pass | 900px 窄屏，参考内容抽屉关闭，无横向溢出，预览保持 16:9 |
| `workbench-error.png` | pass | 手写语法错误：旧预览保留、错误可见、代码页签可修正 |
| `workbench-chat.png` | pass | 聊天完整代码改写成功，预览更新 |
| `workbench-legacy.png` | pass | 旧结构化只读预览、单一时间轴、转换入口 |
| `real-model.png` | pass | 真实代码模型（stage pick：`ark-plan-text-deepseek`）生成、保存、渲染成功 |

真实模型 smoke 项目：`real-code-1792676796783`，生成视频 `/videos/schedule-1792676931307-900dbd.mp4`，ffprobe 时长 2.000s、16:9。

纹理方向：沙箱对 ImageBitmap 使用 UV 翻转（`repeat.y=-1`、`offset.y=1`），因为 WebGL 的 `UNPACK_FLIP_Y_WEBGL` 对 ImageBitmap 不生效。
