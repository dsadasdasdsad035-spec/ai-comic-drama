# Tasks

## 1. Python 边车（先做，这是唯一有技术不确定性的部分）

- [x] 1.1 建 `whitebox/` 目录与 `install.sh`：创建 venv、装 torch（mac arm64 wheel）、装 DA3 其余依赖、**跳过 xformers**（源码里是 try/except 守护的，实测可缺）。脚本必须幂等，重复跑不重复下载
- [x] 1.2 写 `whitebox/weights.json`：记录 DA3-BASE 的 repo id、文件名、字节数（541518028）与 sha256；写 `fetch_weights.py` 支持断点续传（实测本机直连 CDN 会断，必须支持 `-C -`）
- [x] 1.3 写 `whitebox/da3_infer.py`：读视频 → 按 fps 抽帧（硬上限 12）→ DA3-BASE 在 MPS/CPU 推理 → 存 npz（depth/conf/extrinsics/intrinsics）。把 `KMP_DUPLICATE_LIB_OK=TRUE` 写进进程环境而非依赖调用方设置
- [x] 1.4 在 `da3_infer.py` 里处理 `extrinsics` 形状：实测是 `(N,3,4)`，补成 4×4。**不要**相信上游注释写的 `(N,4,4)`——两种都兼容
- [x] 1.5 写 `whitebox/mesh_whitebox.py`：逐帧反投影 → `UniformTSDFVolume`（**不用 ScalableTSDFVolume**，实测 mac arm64 恒返回空）→ `fix_normals` + 体积为负则 `invert` → 访问 `vertex_normals` 触发 NORMAL 写入 → clay 材质（灰、doubleSided）→ 包围盒最大边归一 → 导出 GLB
- [x] 1.6 在 `mesh_whitebox.py` 加断言：三角形数低于阈值时非零退出并输出可读原因，MUST NOT 写出空壳 GLB
- [x] 1.7 写 `whitebox/doctor.py`：输出 JSON 体检结果（python 版本、torch 版本、mps 可用、权重存在与校验和）。给服务端与冒烟测试共用
- [x] 1.8 用 `fixtures/` 里的一条真实短视频跑通 `da3_infer.py` + `mesh_whitebox.py`，记录实际耗时与峰值内存到 `design.md` 的实测表

## 2. 服务端任务编排

- [x] 2.1 新增 `server/whitebox.mjs`，照 `server/blender.mjs` 的形态：一次性作业目录、独立子进程、超时、取消、失败不产半成品
- [x] 2.2 写 `POST /api/whitebox/jobs`：校验项目与视频来源，创建作业，返回 jobId；环境不合格时返回明确错误码（`env-missing` 并附缺失项）
- [x] 2.3 写 `GET /api/whitebox/jobs/:id`：返回状态、阶段（抽帧/推理/网格化）、进度、错误原因、产物 url
- [x] 2.4 写 `DELETE /api/whitebox/jobs/:id`：取消运行中的作业，杀掉子进程组，清理作业目录，不产出 `.glb`
- [x] 2.5 写 `GET /api/whitebox/health`：透传 `doctor.py` 的结果，带 60 秒缓存（照 `blenderHealth` 的做法）
- [x] 2.6 产物落盘到项目媒体目录（`/project-assets/` 前缀），文件名 `whitebox-<ts>-<rand>.glb`；**不要**落 `public/videos`（`isGltfAssetUrl` 不认，产物会在 UI 里消失）
- [x] 2.7 成功后自动登记素材卡：`kind='model'`，标题含来源视频标识，note 注明「估算尺度 · 稠密重建 · 非语义分割」
- [x] 2.8 视频来源支持两种：引用项目已有 `kind='video'` 素材（零网络），或调用既有摄取能力上传新视频

## 3. 前端 Tab 与面板

- [x] 3.1 `src/AssetBoard.tsx` 的 `MaterialTab` 增加 `'whitebox'`，Tab 按钮排在「写作指南」之后，徽标规则与既有分类一致（未读取不显示数字）
- [x] 3.2 新建 `src/whitebox/` 目录：面板组件、任务轮询 hook、GLB 结果预览
- [x] 3.3 面板含：视频来源（选已有 / 上传）、抽帧 fps、最大帧数（硬上限 12）、目标尺寸、生成按钮
- [x] 3.4 环境体检结果展示：四项各自的状态与缺失时的修复指引；全部通过时显示将使用的设备（MPS/CPU）
- [x] 3.5 任务进度：显示当前阶段与已用时间；`running` 时可取消
- [x] 3.6 结果显示：产物文件名、三角形数、包围盒尺寸、一条「估算尺度」的说明；提供「在场景三维中打开」的跳转
- [x] 3.7 失败态：按错误码给出可读文案（环境缺失 / 视频过短 / 重建过稀 / 超时 / 取消），MUST NOT 只显示一个「失败」

## 4. 冒烟测试

- [x] 4.1 新建 `verify-video-whitebox.mjs`，分三段：环境体检、链路可达、端到端真跑
- [x] 4.2 环境体检段：断言 `doctor.py` 能输出合法 JSON；缺项时打印缺失清单
- [x] 4.3 链路可达段：起应用 → 建任务 → 轮询到终态；环境缺失时断言错误码为 `env-missing`（这是**必须通过**的断言，不是跳过项）
- [x] 4.4 端到端真跑段（环境可用时）：用真实短视频跑完整链路，断言 GLB magic、版本 2、含 POSITION 与 NORMAL、`doubleSided`、三角形数 > 1000、包围盒最大边在 6m ±10%
- [x] 4.5 端到端段断言素材卡：`kind='model'`、url 以 `/project-assets/` 开头、素材库界面能查到该卡
- [x] 4.6 环境不可用时第三段输出 `SKIPPED(env)` 与缺失清单，**进程退出码 0**；不得用 mock 产物冒充通过
- [x] 4.7 断言产物能被 Babylon 加载：用 NullEngine + `LoadAssetContainerAsync`（照 spike 的 `babylon-load-test.mjs`，需 XHR polyfill），检查网格数、顶点数、法线存在
- [x] 4.8 取消路径：建任务后立即取消，断言状态为 `cancelled` 且项目媒体目录无新增 `.glb`
- [x] 4.9 把 `verify-video-whitebox.mjs` 加进 `verify-all.mjs`，并确认它在无环境的机器上不会把整体跑红

## 5. 文档

- [x] 5.1 `README.md` 素材页章节加「视频转白模」一小节：做什么、产物是什么、首次约 2GB 下载、质量局限
- [x] 5.2 `docs/` 下新增一页说明推理环境安装、权重位置、如何手工放置权重（应对下载失败）、许可口径（DA3 BASE/SMALL 为 Apache-2.0；GIANT/LARGE 为 CC BY-NC 4.0，本项目不使用）
- [x] 5.3 在 `docs/deploy.md` 的能力表里注明：Docker 镜像不含 Python 推理环境，该功能在容器内不可用，需要宿主挂载
