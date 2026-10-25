# Proposal

## Why

当前创作链路从「已有剧本 / 镜头」开始，外部参考视频（抖音、B 站、TikTok 等）无法进入工作台；把一条爆款视频拆成可复用的分镜与提示词，仍靠手工截图、人眼分析和复制粘贴。与此同时，现有五个工作台聊天都是**产物绑定型**：一个宿主技能、一份草稿、按项目 / 集 / 镜定位的线程，无法承接「还没有项目、先自由探索」的创作场景。

统一模型表、能力路由、技能注册表和聊天壳已经具备，缺的是一条把「抓取 → 抽帧 → 逐镜反推 → 再生成」串起来的自由会话层。

## What Changes

- 新增独立「创意」视图，聊天即主界面；创意会话不绑定项目，支持多条会话、命名、搜索与恢复；源视频、镜头分析、提示词包、生成结果以卡片出现在对话里。
- 新增媒体摄取层：支持本地上传与直链下载；提供可选的 `yt-dlp` 子进程适配器与可选的 DTK（Douyin_TikTok_Download_API）HTTP 适配器。统一做 probe（时长 / 分辨率 / 帧率 / 音轨）、场景切分与证据帧抽取，源视频落本地创意目录。
- 新增 `video-reverse` 技能与 `reverse-v1` 契约：逐镜输出时间范围、景别、运镜、主体动作、光影、色彩、音频、`keyframe_prompt`、`video_prompt`、证据帧与置信度；字段与现有提示词工作台对齐，反推结果可直接回灌或出片。
- 新增能力托盘：文本、视觉、视频理解、图像、三视图、视频、视频参考、配音按能力各绑一个模型；每次工具调用显示实际使用的模型，可换模型重试；沿用现有「按能力显式路由、失败不回退」规则。
- 新增成本闸门：抽帧、视觉 / 视频理解、生图、生视频、配音前显示预计调用次数与费用；默认单次确认；Seedance 2.0 / 2.5 真实调用必须人工确认。
- 同一会话支持显式模式切换（策划 / 反推 / 复刻）：切换宿主技能时保留历史与素材，工具集随模式变化。
- 新增显式「晋升项目」：把创意产物写入新建或现有项目；不自动写项目，保留来源链接与证据帧引用。
- 工具契约：`ingest_source`、`probe_source`、`split_scenes`、`extract_frames`、`read_creative_source`、`read_video_shots`、`read_frame_detail`、`submit_reverse_pack`、`generate_image`、`generate_video`、`generate_voice`。
- 非目标：不做全站单线程聊天；不做自动发布、搬运或批量养号；不做验证码 / 风控规避；不把 DTK 设为默认依赖；首期不做 ASR（接口预留）；不改变五个工作台现有的保存与合并语义。

## Capabilities

### New Capabilities

- `creative-session`: 创意会话实体、多线程列表与恢复、项目独立边界、产物卡片、导出与晋升。
- `media-ingest`: 摄取适配器、平台元数据、probe、场景切分、证据帧、本地源素材库与合规边界。
- `video-reverse`: 反推技能、`reverse-v1` 契约、逐镜规格与证据、提示词包、下游复用。
- `creative-chat`: 聊天优先的创意界面、能力托盘与多模型绑定、媒体卡片、成本确认、模式切换与失败恢复。

### Modified Capabilities

- `workbench-shell`: 新增非项目视图「创意」，全局带在该视图隐藏项目与集，导航由七视图变为八视图。
- `project-context`: 创意会话明确不绑定项目；切换项目不影响创意；只有显式晋升才写入项目。

## Impact

- 代码：新增 `src/creative/*`、`server/ingest.mjs`、`server/video-analyze.mjs`、`skills/video-reverse/SKILL.md`、`skills/creative-plan/SKILL.md`；扩展 `src/skills/contracts.ts`、`src/skills/tools.ts`、`src/App.tsx` 视图导航；复用 `src/agent/SkillChat.tsx` 的聊天壳模式与 `src/chat-ui/*` 的渲染层。
- 接口：新增 `/api/creative/*`（列表、摄取、probe、场景切分、抽帧、源文件）；复用 `/api/vision`、`/api/video-vision`、`/api/generate`、`/api/seedance`、`/api/voice`、`/api/text`。浏览器仍不持有渠道 Key。
- 数据：在同一 SQLite 中新增 `creative_sessions`、`creative_threads`、`creative_sources`、`creative_artifacts` 表；源视频与证据帧落 `creatives/<id>/`，不进仓库、不进线程消息体。
- 依赖：P1 只依赖现有 ffmpeg / ffprobe，无新增 npm 包。`yt-dlp` 与 DTK 均为可选适配器，未安装或未配置时给出可读禁用原因，不阻塞本地上传与直链。
- 兼容：现有项目数据、五工作台线程与保存语义不变；创意目录与表可独立删除；晋升只走现有 `createProject` / `patchProject`。
- 风险：平台反爬与条款、下载内容版权、线程 1MB 上限、本地视频不能直送 `/api/video-vision`、多模型调用成本。对应边界写入 design 与 specs。
