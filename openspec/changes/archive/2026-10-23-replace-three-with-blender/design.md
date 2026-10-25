# Design

## Context

见 `proposal.md - Why`。当前实现的关键约束：

- 3D 代码在 `allow-scripts` iframe 中执行，运行时是 esbuild 打出的 749 KB 单文件（`src/sandbox/runtime.ts` → `runtime.generated.js`），只 import Three.js core。
- 录制在浏览器内用 `MediaRecorder` 按墙钟推进（`runtime.ts` 的 `recordVideo`），产物是 webm；父页面转 dataURL 提交 `/api/save-video`，服务端用 `-t duration` 转 mp4。
- 应用是纯本地的：Vite 中间件直接读写 SQLite 与项目目录，服务端已持有 ffmpeg/ffprobe 的调用能力（`vite.config.ts`），适合承载本机渲染进程。
- `SceneCode` 已有 `version` / `abiVersion` / `codeHash` / `source`，`abiVersion` 是现成的引擎契约号。
- 旧结构化 3D 只剩只读预览在用（`LegacyScenePreview` + `schedule3d.ts` 的 `buildScheduleScene`）；`SceneScheduleEditor.tsx` 已无引用。
- 本机当前未安装 Blender。

## Goals / Non-Goals

**Goals:**

- 用一个执行后端（本机 Blender 进程）替换全部 Three.js 执行路径，不保留双运行时。
- 渲染输出帧精确；同一 `t` 的抓帧与视频帧一致。
- 保持每镜代码为唯一场景真相、试运行准入、失败不覆盖、过期指纹、按镜隔离这些既有不变量。
- 预览在不具备实时渲染的前提下仍然可用：代理片 + 单帧渲染。
- 安全模型如实降级，并把影响写进 UI 与规格，不保留"沙箱"措辞。

**Non-Goals:**

- 不做场景级 `.blend` 作为场景真相（见决策 1）。
- 不做每镜引擎二选一、不做 Three.js 兼容层或双 ABI。
- 不做云渲染、渲染农场、多机分发。
- 不做 glTF/FBX 资产导入管线；素材仍只有图片与视频关键帧。
- 不在 v1 引入容器级隔离；受限执行是尽力而为，不是真沙箱。
- 不保留旧结构化 3D 的只读 3D 画面。

## Decisions

### 1. 每镜 Python 脚本，而不是场景级 `.blend`

每镜仍保存一段可执行代码（`SceneCode.code`），Blender 每次从空场景执行它。

**为什么**：`scene-code-runtime` 的核心不变量是"每镜独立、代码是唯一真相、可哈希、可撤销、可试运行准入"。`.blend` 是二进制容器：无法做代码级 diff/哈希/撤销，无法让聊天按行改写，无法在试运行失败时只回退一段文本，也会把同场镜头的状态耦合在一起（违反"不共享可变对象"）。每镜脚本还能直接沿用现成的过期指纹与来源标记。

**代价**：跨镜空间连续性仍只能靠把上一镜代码作为参考文本，没有结构性继承——但这是现状，不是回退。场景级 `.blend` 作为未来能力保留（读同一目录下的片场文件），不在本变更内。

**Alternatives**：场景级 `.blend` + 每镜机位（连续性最好，但要重写数据模型、撤销、指纹、聊天与并发模型）；两者并存（维护成本乘法，且没有共享表示）。

### 2. 本机 Blender 子进程 + 固定作业协议，不做云渲染

```
浏览器                       本机 Node（Vite 中间件）                  Blender 进程
代码台/聊天 ──POST /api/blender/render──► 作业队列 ──spawn──► blender --background
   ▲                                        │                  --factory-startup
   │ GET progress（轮询）                    │                  --python host.py
   └────────────────────────────────────────┘                  -- job.json
                                            │                        │
                                            │             frames/0001.png ...
                                            ├── ffmpeg ──► .mp4 ──► public/videos
                                            └── 抽帧 ────► .jpg ──► public/generated
```

- 作业目录：`<repo>/.blender-jobs/<jobId>/`，内含 `job.json`、`assets/`、`frames/`、`out/`。成功或失败后只保留 mp4 与抽取的关键帧，帧序列删除。
- 进度：`host.py` 向 stdout 打 JSON 行（`{"type":"progress","frame":42,"total":180}`），Node 逐行解析并更新内存中的作业状态；客户端轮询 `/api/blender/progress?id=`。不用 SSE，少一个长连接生命周期。
- 作业状态只在内存；dev server 重启时先扫 `.blender-jobs/` 清残留目录，并 kill 记录的 pid。
- 并发：默认同时 2 个 Blender 进程，超出排队。渲染进程与 UI 同机，保留 1 个核给界面。

**Alternatives**：云渲染（违反本地优先与既有 Non-Goal）；浏览器内 WASM Blender（不存在可用实现）。

### 3. ABI：`build(ctx)` / `pose(t, mode)` / `dispose()`，宿主驱动帧

```python
def build(ctx):
    # ctx.scene / ctx.camera / ctx.camera_data / ctx.width / ctx.height
    # ctx.aspect / ctx.duration / ctx.fps / ctx.mode / ctx.shot
    # ctx.asset(key) -> str | None   只读副本的绝对路径
    # ctx.assets() -> list[dict]

def pose(t, mode):
    # 只改场景状态；不渲染、不读墙钟、不写文件

def dispose():
    # 释放自定义数据块、节点组、临时贴图
```

宿主逐帧：`scene.frame_set(round(t*fps))` → `pose(t, mode)` → `scene.render.filepath = frames/%04d.png` → `bpy.ops.render.render(write_still=True)`。

**为什么**：保留现有"同一 `t` 同一画面"的纯函数契约。宿主拥有渲染设置、分辨率、帧率、输出路径，代码不能改这些——否则代码可以静默改变输出规格，绕过时长与画幅契约。

**Alternatives**：让代码自己调 `bpy.ops.render.render` 或自己 `frame_set`（代码能改输出规格、能跳帧、能写任意路径，破坏指纹与时长契约）。

### 4. 素材：一次性工作目录 + 只读副本 + 稳定键

宿主为每个作业创建 `assets/`，把选中的图片与视频关键帧写成 `assets/<safeKey>.<ext>`，并在 `job.json` 里给出 `{key, label, kind, width, height, videoDuration?, frameTime?, path}`。代码只能通过 `ctx.asset(key)` 拿路径。

- 键与缺失语义不变：缺失素材记入 `missingAssets`，代码须有兜底。
- 写入保护：`assets/` 以只读方式打开（Node 写完后 `chmod 0444`），代码写失败不影响项目原图。
- 不提供项目目录、家目录或上一镜输出的路径。

### 5. 三档渲染

2026-10-23 在本机（Blender 5.2.2 LTS / Apple Silicon）实测，10 帧耗时含启动与编码：

| 引擎 | 320p | 540p | 1080p |
|---|---|---|---|
| Workbench | 101 ms/帧 | 121 ms/帧 | 181 ms/帧 |
| EEVEE | 383 ms/帧 | 221 ms/帧 | 442 ms/帧 |
| Cycles | 121 ms/帧 | 404 ms/帧 | 2547 ms/帧 |

结论：EEVEE 在 `--background` 下可用，1080p 6 秒镜头约 80 秒，满足预演；Workbench 更快但只有白模；Cycles 只作回退与特殊镜头。原始数据见 `evidence/blender-spike.json`。

| 档位 | 用途 | 分辨率 | 引擎/采样 | 帧 | 预算 |
|---|---|---|---|---|---|
| trial | 代码准入 | 320p | EEVEE / 8 | 首尾 2 帧 | 15 s |
| proxy | 时间轴预览 | 540p 短边 | EEVEE / 16 | 15 fps | 60 s |
| final | 定稿 | 项目分辨率 | EEVEE / 32 | 30 fps | 按镜头时长 × 预算 |

回退规则：EEVEE 不可用时全链路回落 Cycles CPU，proxy 降到 12 fps；两种引擎都不可用时禁用渲染并输出诊断。

**为什么 15 fps 代理**：代理只服务于时间轴判断，不做下游参考；90 帧对 6 秒镜头约 20 秒，拖拽仍然够顺。

### 6. 视频：帧序列 + 现有 ffmpeg，帧精确

`frames = round(effectiveSeconds * fps)`；`ffmpeg -framerate 30 -i frames/%04d.png -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4`。产物时长严格等于 `frames / fps`。

**为什么**：现在的墙钟录制会因场景变重而变慢，`/api/save-video` 再用 `-t` 截断，可能只留下前半段动作。帧序列渲染把时长从"实际跑了多久"变成"指定了多少帧"，同时消掉 webm → base64 → JSON 的大包往返。抽帧也改为从同一帧序列取，保证"抓帧 = 视频第 t 秒"。

### 7. 数据模型与迁移

```ts
type SceneCode = {
  version: 2
  abiVersion: 2
  runtime: 'blender'
  engineVersion: string       // 例如 "4.5.3 LTS"
  code: string
  codeHash: string
  source: 'ai' | 'manual' | 'legacy-converted' | 'fallback'
  motionNote?: string
  updatedAt: string
}
```

- 旧记录（`abiVersion: 1`、无 `runtime`）按 `runtime: 'three'` 只读处理：可查看、可复制，不能渲染；提供"转换为 Blender 代码"的一次性动作，复用 `legacy-converted` 来源。
- `SceneCodeMeta` 增加 `runtime`、`engineVersion`、`fps`、`frames`、`tier`、`width`、`height`；指纹覆盖 `codeHash + runtime + engineVersion + abiVersion + 素材内容哈希 + duration + aspect + width/height + fps`。
- 旧结构化 `shotScene`/`shotBlocking` 保留字段，不再渲染；转换动作沿用现有生成管线，输入换成旧结构化 JSON。

**Alternatives**：保留 Three.js 兼容层（永久背上 749 KB 运行时与 second runtime 的维护成本，且用户已明确要全部替换）。

### 8. 安全：如实降级为"本地受信执行 + 静态准入"

- 准入：字节上限；必须定义 `build`/`pose`；禁止 `os`/`sys`/`subprocess`/`socket`/`urllib`/`requests`/`shutil`/`pathlib` 写入类调用、`eval`/`exec`/`compile`/`__import__`、`bpy.ops.wm`/`export`/`import`、`bpy.data.libraries.load`、`bpy.app`。
- 启动：`--factory-startup` 屏蔽用户插件与偏好；`--python-exit-code 1` 让脚本异常反映为进程退出码；工作目录固定为作业目录。
- 设备：首次启用时在设置页显示一次性告知——3D 代码以本机用户权限运行；不做每次运行确认（会破坏聊天闭环）。
- 明确不做：容器、`sandbox-exec`、seccomp、内存/CPU 配额。

**为什么**：Python 在 Blender 内没有可用的真沙箱；把它包装成"沙箱"会误导。静态准入挡住常见误写与明显破坏，真正的隔离留给后续容器化。

### 9. Agent 工具映射

| 旧工具 | 新工具 | 变化 |
|---|---|---|
| `run_sandbox` | `run_render` | 提交 trial 作业，返回可渲染判定与首尾帧 |
| `capture_frames` | `capture_frames` | 从 proxy/final 产物取帧；不足时补渲单帧 |
| `review_frames` | 不变 | 同一视觉验收通路 |
| `set_scene_code` | 不变 | 准入改跑 Python 静态检查 |

工具数量不增加；agent 拿不到 Blender 控制台、shell、文件读写或任意求值入口。

### 10. 版本钉死

`engineVersion` 参与准入与指纹。支持范围由环境变量 `BLENDER_MIN_VERSION`/`BLENDER_MAX_VERSION` 声明（默认 4.2–6.0，本机实测并钉在 5.2.2 LTS）；版本不符时禁用渲染并说明期望版本，避免 bpy API 漂移（例如 4.0 改过 Principled 的 socket 名、5.x 的引擎枚举从 `BLENDER_EEVEE_NEXT` 回到 `BLENDER_EEVEE`）导致同一段代码时好时坏。

## Risks / Trade-offs

- **[EEVEE 在 `--background` 下起不来]** → 第 0 个任务先实测；失败则全链路回落 Cycles CPU，proxy 降帧降采样；两种都失败则禁用并输出诊断。
- **[反馈从秒级变分钟级，聊天循环变慢]** → trial 限定 2 帧/320p/15 s；agent 修复轮次与渲染次数上限沿用现有配置并下调；UI 全程可取消。
- **[模型写 bpy 的一次通过率低于写 Three.js]** → 提示词内嵌可运行的最小模板与版本号；试运行错误回传行号与 bpy 报错原文；保留修复轮次。
- **[安全承诺降级]** → 静态准入 + 只读素材 + `--factory-startup` + 一次性目录 + 设置页告知；不宣称沙箱。
- **[Blender 未安装/版本不符/装在非标准路径]** → 健康检查覆盖 `PATH`、`/Applications/Blender.app/Contents/MacOS/Blender` 与环境变量覆盖；未通过时禁用而非静默失败。
- **[进程泄漏或磁盘膨胀]** → 记录子进程 pid，server 关闭与重启时清理；作业结束删除帧序列；并发上限 2。
- **[旧镜头失去 3D 画面]** → 只读说明 + 显式转换入口；旧视频仍可播放；转换失败不影响旧数据。
- **[并发渲染拖慢界面]** → 并发上限 + 队列 + 进度可见；必要时对子进程降优先级。

## Migration Plan

1. 部署后首次打开项目：无 Blender → 3D 入口禁用并显示指引；已有代码尚不能渲染。
2. 安装 Blender 并通过健康检查后：新镜头走 Blender 生成；旧 `abiVersion: 1` 代码显示"需要转换"。
3. 用户逐镜转换（或批量重生成）；旧视频保留并标过期，直到重新渲染。
4. 回滚：还原代码即可回到 Three.js 运行时；期间生成的 `abiVersion: 2` 代码在旧版本中不可渲染（未知字段由 `shots.extra` 保留，不会丢数据）。
5. 切换完成后删除 `three` 依赖与 `build:sandbox`，避免残留双运行时。

## Open Questions

- 是否需要"严格模式"（每次渲染前确认）作为可选开关，留到有用户反馈后再加。
