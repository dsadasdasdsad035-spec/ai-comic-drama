# Design

## Context

见 `proposal.md` 的 Why。当前实现有四条约束会直接影响方案：

- **聊天能力已经存在，但和产物绑定**：`SkillChat` 依赖 `WorkbenchChatAdapter` 的 `writeContract` / `writeTool` / `ownDraft` / `applyDraft`，`createStageToolSet` 在构造时强依赖输出契约；`WORKBENCH_PROFILES` 与 `WorkbenchSurface` 固定为五个产物工作台。
- **技能注册表是数据驱动的**：`skills/<id>/SKILL.md` 的 frontmatter 只允许 `Stage` 白名单内的环节与 `KNOWN_TOOL_IDS` 内的工具（`src/skills/parse.ts`、`src/skills/validate.ts`、`src/skills/tools.ts`）。技能不能携带可执行脚本。
- **线程存储按四元键定位**：`chat_threads(project, surface, episode, shot_id)`，无列表、无标题，单条 1MB（`server/db.mjs`）。项目名走 `safeProjectName`，空项目名不合法。
- **媒体能力分散在路由里**：抽帧 `/api/frames`、图片理解 `/api/vision`（dataURL ≤4MB）、视频理解 `/api/video-vision`（仅公网 URL）、视频上传方舟 Files API 在 `server/files.mjs`；`vite.config.ts` 已经过大，新能力不应继续堆进去。

本机现状（影响默认值）：ffmpeg / ffprobe 存在，Docker 28.5.1 与 Python 3.13.7 存在，`yt-dlp` 未安装，仓库无 ASR 实现。

## Goals / Non-Goals

**Goals:**

- 创意会话完全不依赖项目存在，且不污染现有五工作台的数据与保存语义。
- 「链接 → 下载 → probe → 切分 → 抽帧 → 逐镜反推 → 提示词包」在 P1 内可完整走通。
- 复用现有模型表、能力路由、技能注册表、聊天渲染与 LangGraph 循环，不新建第二套模型层。
- 所有付费调用在发出前可见、可取消；Seedance 2.0+ 每次确认。
- 下载能力可插拔，默认零外部服务依赖。

**Non-Goals:**

- 不做全站单线程聊天，不改五个工作台的宿主技能与草稿合并。
- 不做 ASR（P1 只预留接口与 UI 占位），不做图集 / 直播 / 评论抓取。
- 不做自动发布、批量搬运、验证码或风控规避。
- 不把 DTK 作为默认依赖，不内嵌 Python 运行时。
- 不做逐帧还原；反推目标是语义与镜头语言可复现，不宣称还原原始提示词。

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │                创意视图                       │
                    │  ┌──────────┐  ┌────────────────────────┐  │
                    │  │ 会话列表  │  │ CreativeChat            │  │
                    │  │ (标题/模式)│  │ header / messages /     │  │
                    │  └──────────┘  │ composer / inspector    │  │
                    │                └───────────┬────────────┘  │
                    └────────────────────────────┼───────────────┘
                                                 │
                         ┌───────────────────────┴───────────────────────┐
                         │  runStageAgent（复用：LangGraph + ZCodeChatModel）│
                         └───────────────────────┬───────────────────────┘
                                                 │ tools
     ┌───────────────────────────────────────────┼───────────────────────────────────────────┐
     │                                           │                                           │
┌────┴─────┐                            ┌────────┴────────┐                          ┌───────┴──────┐
│ 会话读工具 │                            │ 媒体工具          │                          │ 产物/生成工具  │
│ read_*    │                            │ ingest / probe /  │                          │ submit_reverse│
│ 活会话状态 │                            │ split / frames    │                          │ generate_*    │
└────┬─────┘                            └────────┬────────┘                          └───────┬──────┘
     │                                           │                                           │
     │                                           v                                           v
     │                              ┌──────────────────────────┐                 ┌──────────────────┐
     │                              │ server/ingest.mjs        │                 │ 现有 /api/generate│
     │                              │  adapters: upload/direct │                 │ /api/seedance     │
     │                              │  yt-dlp/dtk (optional)   │                 │ /api/voice        │
     │                              └────────────┬─────────────┘                 └──────────────────┘
     │                                           │
     │                              ┌────────────v─────────────┐
     │                              │ server/video-analyze.mjs │
     │                              │ ffprobe / scene split /  │
     │                              │ evidence frames          │
     │                              └────────────┬─────────────┘
     │                                           │
     v                                           v
┌──────────────────────────────────────────────────────────────────────────────┐
│ 创意存储：creatives/<sessionId>/{sources,frames,artifacts} + 同库 4 张新表     │
└──────────────────────────────────────────────────────────────────────────────┘
```

数据流（P1 主路径）：

```
链接/上传 → ingest_source → probe_source → split_scenes → extract_frames
                                                              │
                                                              v
                                             read_video_shots / read_frame_detail
                                                              │
                                                              v
                                                 (vision model 逐镜理解)
                                                              │
                                                              v
                                              submit_reverse_pack → reverse-v1 校验
                                                              │
                                    ┌─────────────────────────┼──────────────────────┐
                                    v                         v                      v
                              导出 JSON/文本            生成复刻片段            晋升项目
                                                        (成本确认)          (createProject/patchProject)
```

## Decisions

### D1. 创意是独立实体：新表 + 独立目录，不复用 `chat_threads`

**决定**：新增 `creative_sessions`、`creative_threads`、`creative_sources`、`creative_shots`、`creative_artifacts` 五张表；源文件落 `creatives/<sessionId>/`。

**理由**：

- `chat_threads` 的主键要求非空 `project`，且 `safeProjectName` 拒绝空串；用 `__creative__` 之类的占位项目会污染项目列表、导出与删除语义。
- 创意需要会话列表、标题、模式、最近更新时间；这些是 `chat_threads` 没有的字段。
- 源视频与证据帧必须外置。四元键 + 1MB 上限的线程表不适合做素材索引。

**备选**：

- 复用 `chat_threads`，`surface='creative'`，`shot_id=sessionId`，`project='__creative__'`。改动最小，但项目边界与清理逻辑会变得含糊，且删除项目时可能误删创意。否决。
- 单表 `creative_artifacts` 存所有内容（含 shots JSON）。查询简单，但逐镜状态（未分析 / 已完成 / 失败）需要频繁部分更新，JSON 整块替换会丢并发结果。拆出 `creative_shots`。

线程键：`creative_threads.session_id` 一对一。模式存在 session 上，不按模式拆线程（模式切换保留历史是 spec 要求）。

### D2. 新建 `CreativeChat`，复用底层 primitives，不强塞进 `SkillChat`

**决定**：`src/creative/CreativeChat.tsx` 自己持有 `useAgentMessages` + `runStageAgent` + `ChatThreadShell` / `ChatThreadBody` / `WorkbenchHeader` / `StageToolUis`；不实现 `WorkbenchChatAdapter`。

**理由**：

- `SkillChat` 的编排逻辑只有约 100 行（begin / updateEvent / patchAssistant / abort / history），真正难的是聊天壳渲染与工具协议，而这两层都能直接复用。
- 强行实现 `WorkbenchChatAdapter` 会带进 `applyDraft`、`saveDraft`、`ownDraft`、`WorkbenchProfile.saveMode`、`WORKBENCH_BUILTINS` 等产物语义；创意没有「宿主草稿」，只能提供空实现，后续维护者会误以为创意也走草稿合并。
- 不改 `SkillChat` 可以把五个工作台回归风险降到零。

**备选**：

- 扩展 `SkillChat` 支持 `writeContract: null`。改动小，但 `stageTools`、`WorkbenchInspector`、`WORKBENCH_PROFILES` 都要加分支；且创意工具远超 `read_*` + `submit_*`。否决。
- 完全独立实现消息渲染。重复度高且会丢失已修好的聊天样式与可访问性。否决。

`WorkbenchHeader` 的入参已经是通用形状（标题、范围、模型、状态、统计、只读技能、检查器），创意直接传入 `scope='会话'`、`readonly=[]`、`actions=[]` 即可，不必改签名。

### D3. 扩展 `Stage` 与技能注册表，而不是新建注册表

**决定**：

- `Stage` 增加 `creative`；`STAGE_RUNTIME.creative = { maxTokens: 8192, temperature: 0.4, output: 'reverse-v1' }`（仅在反推模式下使用；策划模式可覆盖为 `null` 输出，由技能 frontmatter 的 `output` 决定）。
- `src/skills/parse.ts` 的 `STAGES` 白名单加入 `creative`。
- 新增 `skills/creative-plan/SKILL.md`（策划：把一句想法拆成可拍方向与镜头草案，不产出 `reverse-v1`）。
- 新增 `skills/video-reverse/SKILL.md`（反推：读切分与证据帧，产出 `reverse-v1`）。
- `src/skills/contracts.ts` 新增 `reverse-v1` zod schema；`src/skills/tools.ts` 的 `KNOWN_TOOL_IDS` 加入新工具 id。

**理由**：注册表已经处理了内置 / 覆盖分层、版本、锁定契约与设置页编辑。另起一套会让用户面对两套技能编辑器。

**注意**：`createStageToolSet` 目前总是在构造时解析 `submitSchema` 并抛错。创意工具集不复用它，改为 `src/creative/tools.ts` 独立构造 `DynamicStructuredTool[]`；`bindSkillTools` 仍可复用（它只按 manifest 过滤名字）。

### D4. 工具分四簇，写产物与付费调用分离

**决定**：

| 簇 | 工具 | 副作用 |
|---|---|---|
| 会话读 | `read_creative_session`、`read_creative_source`、`read_video_shots`、`read_frame_detail` | 只读 |
| 媒体 | `ingest_source`、`probe_source`、`split_scenes`、`extract_frames` | 写本地文件与源记录，不产生模型费用 |
| 产物 | `submit_reverse_pack` | 只写 `creative_artifacts`，不写项目 |
| 生成 | `generate_image`、`generate_video`、`generate_voice` | 产生费用，必须过确认闸门 |

**理由**：媒体与产物工具可以自由重试；生成工具不能。把两者放在同一层会让「重试」按钮有机会重复扣费。

`submit_reverse_pack` 在工具内做 `reverse-v1` 校验；不合格直接返回 `{ok:false, error}`，由 `runStageAgent` 转成 `ToolMessage(status:'error')`，模型可自行修正一次。

### D5. 摄取适配器：统一接口，默认只开本地上传与直链

**决定**：

```
IngestInput = { kind: 'upload'|'url', url?, file?, platform? }
IngestAdapter = {
  id: 'upload'|'direct'|'ytdlp'|'dtk'
  available(): { ok: boolean; reason?: string }
  ingest(input, ctx): Promise<{ file, meta }>
}
```

- `upload`：前端 multipart 或 base64 → 服务端写盘。首期用现有 `readJson` + base64（限制 200MB 前先落临时文件），避免引入 multipart 解析依赖。
- `direct`：服务端 fetch 流式写盘，校验 `content-type` 与最大字节数，拒绝内网地址（SSRF 防护）。
- `ytdlp`：`execFile` 调用，参数白名单，输出目录由服务端指定；不解析 stdout 以外内容，不执行用户参数。
- `dtk`：`POST {baseUrl}/api/v1/parse_url` + `download_media`，带 `Authorization`；只接受 http/https 且非内网。

**理由**：DTK 能力最全，但它需要 Postgres + Redis + 浏览器容器；把它设为必需会让本地形态倒退成多服务编排（与 `DEPLOY-CHECKLIST.md` 的方向相反）。适配器让重能力可选，同时保留将来替换实现的空间。

**备选**：直接 npm 依赖某个抖音解析库。这类库签名更新频繁，维护风险高于子进程调用 yt-dlp。否决。

### D6. 本地视频反推以「抽帧 + 图片理解」为主路径

**决定**：

- 默认：`extract_frames` 产出证据帧 → 逐镜调用 `/api/vision`（dataURL，单张 ≤4MB，必要时先缩放）→ 结构化结果。
- 仅当源视频有公网 URL 且用户显式选择「视频理解」时，才走 `/api/video-vision`。
- 需要把本地视频变成公网地址时，复用 `server/files.mjs` 上传方舟换 `download_url`，并在发起前明确告知会上传。

**理由**：`/api/video-vision` 明确拒绝本地路径；`/api/vision` 是已验证的稳定路径。抽帧还能给用户证据，满足「证据可追溯」。

**代价**：时序信息（连续运动、转场节奏）只能从多帧推断，精度低于真正的视频理解。这写进风险，并在 UI 上标注档位。

### D7. 模型绑定分两层，创意的选择不污染全局默认

**决定**：

- 对话文本模型：`stageModels.creative`，解析顺序沿用 `resolveStageModel`（手选 > 环节默认 > `defaults.text`）。
- 其它能力：`creative.models[cap]` 覆盖，未设置时回落 `defaults[cap]`。
- 能力托盘直接读写 `creative.models`；提供「恢复跟随全局」。

**理由**：如果托盘直接写 `defaults`，用户只是在创意里试一个图像模型，就会改掉全站出图默认值。分层后两边互不影响，又不需要新模型表。

**备选**：完全复用 `StagePick`（localStorage）。创意会话需要跨设备/跨浏览器一致，且要随会话记录审计，localStorage 不够。否决。

### D8. 成本闸门放在宿主，不交给模型

**决定**：`generate_*` 工具在真正发请求前调用宿主的 `confirmCost()`；宿主弹出确认卡（调用次数、模型、单价、合计），用户确认后工具才继续。`agentLimits` 之外再加 `creativeLimits`：`maxShots`、`maxFramesPerShot`、`maxPaidCallsPerTurn`。

**理由**：模型无法可靠估算价格，也无法保证不重复调用。闸门放在工具执行层，模型只能「请求」，不能「决定花钱」。

**规则**：Seedance 2.0 / 2.5 的真实视频生成每次确认，不读「本会话不再询问」。这条与既有 `seedance-real-call-confirmation` 记忆一致。

### D9. 体积与引用

**决定**：

- 线程消息只存 `sourceId`、`artifactId`、镜头索引与摘要；序列化时复用 `shrinkResult` 的折叠策略。
- 单条创意线程上限与 `chat_threads` 一致（1MB），超限返回 `thread-too-large` 并建议新建会话。
- 源视频默认上限 200MB；证据帧单张 ≤4MB；单会话源视频数量上限 20。
- 删除会话时清理 `creatives/<sessionId>/`；删除源视频时只清理该源目录。

### D10. 晋升映射固定，复用现有写入路径

**决定**：`promote` 接受 `{ sessionId, artifactId, target: 'new'|'existing', projectName?, episode? }`。

`reverse-v1` → `ProjectShot` 映射：

| reverse 字段 | ProjectShot |
|---|---|
| `shots[i].keyframe_prompt` | `keyframe_prompt` |
| `shots[i].video_prompt` | `video_prompt` |
| `shots[i].start/end` | `seconds`（差值，保留两位） |
| `shots[i].size` | `size` |
| `shots[i].camera` | `move` |
| `shots[i].subject/action` | `desc` |
| `source.url` | 源引用写入 `extra.creative_source` |
| `shots[i].evidence_frames` | `extra.creative_evidence` |

新建项目走 `createProject` + `patchProject`；写入现有项目走 `patchProject({ shots })`，并在服务端按 `shotId` 合并，保留已有 `handEdited` 字段。`shotId` 用 `creative-<sessionId>-<idx>` 生成，稳定可重复。

### D11. 服务端模块边界

**决定**：

- `server/ingest.mjs`：适配器接口、下载、SSRF 防护、源记录 CRUD。
- `server/video-analyze.mjs`：ffprobe、场景切分、抽帧、封面。
- `server/creative.mjs`：会话 / 线程 / 产物 / 晋升的存储操作。
- `vite.config.ts` 只增加薄路由转发，业务逻辑不写在路由里。

**理由**：`vite.config.ts` 体积已经影响维护；独立模块也便于将来抽 `server/index.mjs` 时直接挂载。

### D12. 分期与开关

**决定**：

- P1：会话、上传/直链、probe、切分、抽帧、反推、导出、晋升。
- P2：`yt-dlp` 与 DTK 适配器、源素材库、切分灵敏度 UI。
- P3：能力托盘、生成工具、成本闸门、原片/复刻对比。
- P4：ASR、批量链接、反推模板。

每期通过 `creative` 视图内的能力可用性判断降级（例如未绑定视觉模型时禁用反推），不做隐藏的功能开关。

## Risks / Trade-offs

- **平台反爬与条款** → 只保留用户显式触发、单条链接、低频请求；不做批量；不做验证码/风控规避；错误信息不暴露内部请求细节。DTK / yt-dlp 均为可选，用户自行承担合规责任。
- **本地视频转公网带来的隐私面** → 上传方舟前必须显式确认，且默认路径不依赖上传（抽帧 + 图片理解）。
- **场景切分与真实剪辑点不一致** → 提供灵敏度与「手动合并/拆分」入口；反推结果按切分时间范围为准，不以模型输出覆盖。
- **多帧推断时序的精度上限** → 档位标注（快速 / 标准），结果带 `confidence`，低置信度镜头显式提示。
- **成本失控** → `maxPaidCallsPerTurn` + 会话级确认 + Seedance 每次确认；超限直接拒绝并说明原因。
- **线程 1MB 上限** → 只存引用与摘要；大产物走 artifact 表与文件；超限错误可恢复。
- **视觉模型对画面文字的误读** → 证据帧保留原始时间点，结论可回看；不把 OCR 结果当事实写入提示词。
- **DTK 版本/端点漂移** → 适配器只依赖 `parse_url` 与 `download_media` 两个稳定端点；失败时返回可读错误并提示改用直链/上传。
- **`Stage` 扩展的兼容性** → `STAGE_RUNTIME` 是 `Record<Stage, ...>`，新增键会在编译期强制补齐；`stageModels` 是 Partial，旧设置不需要迁移。
- **ffmpeg 在部署环境缺失 xfade/libass** → 创意只依赖基础解码与抽帧；不引入新的滤镜硬依赖。

## Migration Plan

1. **无数据迁移**：新表在首次访问创意接口时 `CREATE TABLE IF NOT EXISTS`；旧项目、旧线程、旧设置保持不变。
2. **设置增量**：`AppSettings.creative` 为可选字段，缺省即默认值（仅本地上传 + 直链、标准档、每次确认）。
3. **回滚**：移除创意导航与路由即可停用；`creatives/` 目录与五张表可独立删除，不影响项目数据。若需保留内容，先导出 `reverse-v1` JSON。
4. **部署**：P1 不需要新服务；生产环境需确保 `creatives/` 位于可写持久卷，且与 `projects/` 同样不纳入版本控制（加入 `.gitignore`）。

## Open Questions

- ASR 走哪个渠道（方舟、MiniMax 还是本地 whisper）留到 P4，接口先固定为 `read_audio_transcript` 返回带时间戳的文本。
- 抖音图集（多图作品）是否按「每图一镜」处理，需要真实样本验证后再定。
- 成本单价的默认值是否复用 `pricing`，还是为创意单独校准，等 P3 实测后决定。
