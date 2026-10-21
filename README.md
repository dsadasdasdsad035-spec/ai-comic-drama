# ai-comic-drama · 分镜画布（storyboard-canvas）

AI 漫剧的可视化分镜工作台：分镜卡片自由排布 → 生成静帧 → 图生视频 → 台词配音 → 连播预览 → 一键导出带字幕成片。

## 运行

```bash
npm install
npm run dev      # http://127.0.0.1:5273
```

需要本机有 **ffmpeg（带 libass）**；API key 从以下位置读取：

- `~/.canghe-skills/.env` → `ARK_API_KEY`（Seedream 出图 / Seedance 出片）
- 任意上述 `.env` 或环境变量 → `ELEVENLABS_API_KEY`（可选，缺失则退回 macOS `say`）

## 能力

| 区块 | 说明 |
| --- | --- |
| 分镜画布 | React Flow 卡片拓扑 + Konva 图层，可调坐标/景别/运镜/台词 |
| 角色板 | 生成角色三视图，注入 `lookEn` 到分镜提示词保持一致性 |
| 环节模型 | 剧本 / 角色 / 镜头表 / 提示词在设置页绑定默认模型，工作台可临时手选（本机记忆） |
| AI 出图 | Seedream 4.5 多候选并发，选中的併入画布合成约束图 |
| 图生视频 | Seedance 任务式生成 + 轮询，卡片内直出预览 |
| 3D 调度参考 | 调度视频经方舟 Files API 上传后作为 `reference_video`（Seedance 2.0/2.5，默认关闭） |
| 台词配音 | ElevenLabs（有 key）或 macOS `say`（无 key），按角色选音色与语速 |
| 连播预览 | 按镜头时长推进，支持视频真实时长校正、字幕开关、上一镜/下一镜 |
| 导出成片 | 单条 ffmpeg 命令完成拼条 + 字幕 + 混音 |

## 导出管线（核心）

一条 `ffmpeg` 命令，不落中间文件：

1. **画面归一化**：每段 `scale=W:H:force_original_aspect_ratio=decrease:in_range=auto:out_range=tv` + `pad` 补黑边（不裁切），统一 `fps=24 / setsar=1 / yuv420p` 后 `concat`
2. **字幕**：有 libass 时生成 SRT 走 `subtitles` 滤镜；没有则退回前端 canvas 渲整帧透明 PNG + `overlay`
3. **混音**：每条配音 `adelay` 对齐镜头起点，再 `amix` + `apad/atrim` 到总长

### 踩过的坑（别改回去）

- **色彩范围**：jpeg 静帧是 full range、Seedance 视频是 tv range，不统一会输出 `yuvj420p` 导致部分播放器偏亮。必须 `out_range=tv` + `-color_range tv`
- **ASS 颜色是 `&HAABBGGRR`**：alpha 在前。`OutlineColour=&HC8000000` 是 78% 透明，等于没描边；不透明要写 `&H00000000`
- **配音起点要用探针出的真实时长**：视频实际长度与名义镜头时长常差零点几秒，用名义值会累积错位
- **超长配音必须在镜头末尾收掉**：否则会溢出盖住后续镜头的声音，并与字幕截断点不一致；用 `atrim` + 0.12s `afade`
- React Flow 在冒泡阶段吞掉 Esc / 方向键，预览器的按键监听必须走捕获阶段（capture）

## 目录

```
src/
  App.tsx            主布局 / 状态
  ShotNode.tsx       分镜卡片（出图、出片、配音角标）
  Preview.tsx        连播预览 + 导出面板
  Inspector.tsx      右侧属性面板
  Timeline.tsx       底部时间轴
  CharacterBoard.tsx 角色板
  subtitles.ts       无 libass 时的字幕位图渲染
  vite.config.ts     同时作为 dev 后端（所有 API + ffmpeg 合成）
verify-*.mjs         Playwright 端到端验证脚本（需先 npm run dev）
```

> 后端全部写在 `vite.config.ts` 里，没有独立 server。

## 脚本

```bash
node verify-subs.mjs     # 配音 + 字幕 + 导出全链路
node verify-video.mjs    # 图生视频
node verify-voice.mjs    # 配音
```
