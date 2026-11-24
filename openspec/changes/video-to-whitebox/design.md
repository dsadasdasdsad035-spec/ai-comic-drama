# Design

## Context

见 `proposal.md` — Why。以下是**在本机实测过**的事实，不是推演。所有结论都来自 2026-11-24 的 spike（macOS 25.6 / M4 Pro / 24GB）。

### 已验证的链路

```
视频.mp4
  │  ffmpeg / cv2 按 fps 抽帧（默认 2 fps，上限 12 帧）
  ▼
12 × RGB
  │  DA3-BASE @ MPS：process_res=504
  │  → depth (N,H,W) + extrinsics (N,3,4) + intrinsics (N,3,3)
  │  实测 1.4 秒，峰值内存 1.6GB
  ▼
depth + pose
  │  逐帧反投影成 RGDBImage → open3d UniformTSDFVolume(resolution=384)
  │  实测 2.0 秒，峰值内存 3.1GB
  ▼
TriangleMesh（实测 34k~70k 面）
  │  trimesh：fix_normals → 体积为负则 invert → clay 材质 → 尺度归一
  ▼
whitebox-<id>.glb（1.5~1.7MB）
  │  Babylon NullEngine 加载验证：顶点/三角/法线/双面材质全部正确
  ▼
项目媒体目录 → onAddAssetCard({kind:'model'}) → 场景三维可见
```

### 五个必须写进代码的坑（都已踩过）

**D1. open3d 0.20 的 mac arm64 版 `ScalableTSDFVolume` 恒返回空网格。**

不是参数错误——用官方文档式的平面测试（单帧、单位尺度、`voxel_length=0.01`）同样返回 0 顶点 0 三角。`UniformTSDFVolume` 在同样输入下正常出 1302 顶点 / 2460 三角。

**决定**：固定用 `UniformTSDFVolume`，`length` 取点云包围盒最大边 × 1.25，`resolution=384`。不写运行时探测——探测本身要跑两遍积分，成本比固定选择高。

**D2. DA3 的 `extrinsics` 实际是 `(N,3,4)`，不是源码注释写的 `(N,4,4)`。**

`utils/io/output_processor.py:117` 注释写 `(N, 4, 4)`，实测 `(4, 3, 4)`。直接求逆会崩。

**决定**：补全成 4×4（右下角补 1）后再 `np.linalg.inv`。对两种形状都兼容，不假设。

**D3. xformers 在所有 Python 版本的 macOS 上都没有 wheel。**

PyPI 86 个版本，零个 macosx 包。但 `model/dinov2/layers/swiglu_ffn.py:36` 是 `try: from xformers.ops import SwiGLU / except ImportError:` 守护的，缺失时回落到纯 PyTorch 的 `SwiGLUFFN`。注意力层用的是 `F.scaled_dot_product_attention`，压根不依赖 xformers。

**决定**：安装脚本跳过 xformers，只在依赖校验时把它列为「可选」。DA3 的 `pyproject.toml` 把它写成硬依赖是过时的。

**D4. torch 与 pycolmap 各带一份 libomp，同进程导入即崩。**

报错：`OMP: Error #15: Initializing libomp.dylib, but found libomp.dylib already initialized.`

**决定**：子进程环境强制 `KMP_DUPLICATE_LIB_OK=TRUE`。这是 Apple 平台的标准绕法，代价是并行区可能静默出错——对单线程推理无影响。

**D5. trimesh 导出 GLB 不自动写 NORMAL，且 TSDF 面朝向不一致。**

不写法线时 GLB 只有 `POSITION`，Babylon 光照会失真成纯色块。另外 TSDF 出来的网格体积可能为负（整体朝内），在查看器里像内壁。

**决定**：`fix_normals()` → 若 `tm.volume < 0` 则 `tm.invert()` → 访问 `tm.vertex_normals` 触发惰性计算（trimesh 只在被访问后才把 NORMAL 写进导出流）。材质设 `doubleSided: true`，法线仍有局部不一致时背面也能看到，不出现黑洞。

## Goals / Non-Goals

**Goals**

- 一条视频进，一个可加载的白模 GLB 出，全程本机、无网络、无云成本。
- 失败可解释：环境缺失、视频太短、重建太稀、超时，各有一条人能读懂的提示。
- 冒烟测试真跑模型，且**环境缺失时诚实报 SKIPPED**，绝不用 mock 冒充通过。
- 不碰「场景三维」的查看器代码——产物按既有 `isGltfAssetUrl` 契约落盘即可被看见。

**Non-Goals**

- 不做语义分割、不做物体级 mesh、不做纹理烘焙。
- 不做远程 GPU、不做多机队列。
- 不改白模工作台（bpy 那条链路独立存在）。
- 不为 GIANT/LARGE 预留档位开关（许可不允许，留开关等于给人误开的入口）。

## Decisions

### D6. 默认抽帧 2 fps、上限 12 帧

DA3 是**多视图**模型，帧间要有足够基线才能估位姿；但帧数越多显存与耗时线性涨。

实测：3.5 秒视频按 1 fps 抽只能拿 4 帧（间隔 1 秒，位移不足），按 4 fps 抽 12 帧效果好得多。你仓库那条 9.6 秒视频按 2 fps 抽正好 12 帧。

**决定**：默认 2 fps，硬上限 12 帧（超出则等间隔抽稀）。上限设 12 是因为 24GB 统一内存下 12 帧是实测的安全值，且 3.1GB 峰值留了充足余量。少于 4 帧直接报错——位姿估计需要基线。

### D7. 尺度归一：包围盒最大边归一，不做米制恢复

DA3-BASE 出的是**相对深度**（`is_metric={}`），尺度任意。实测同一条视频的包围盒最大边可能是 0.78 也可能 1.56，取决于视频内容，不是真实米数。

**决定**：meshing 后把包围盒最大边缩放到可配置的目标尺寸（默认 6m，约一间房），居中到原点。这不是"恢复真实尺度"，是"让它能进场景三维摆机位"。UI 上必须写清是估算尺度。

不做米制：DA3METRIC-LARGE 能出米制，但那是另一个 0.35B 模型、多一次推理，且对非标准视角的视频鲁棒性未知。需要真实尺度时那是后续增强。

### D8. Python 边车：一次性作业，不复用进程

参考 `server/blender.mjs` 的做法：每次转换是一个独立目录、独立进程、独立输出，失败或取消都不产出半成品。

**为什么不常驻**：模型加载 516MB 权重 + torch 初始化约 3 秒，常驻能省这 3 秒，但带来显存常占、进程僵死、版本漂移三个问题。而转换本身是低频重操作（不是每镜都跑），3 秒可忽略。

**不常驻的代价**：批量转 10 条视频要重复加载 10 次，约 30 秒额外开销。可接受，且 `da3 backend` 的常驻模式在 mac 上未验证，不在本次引入未验证的东西。

### D9. 环境缺失的处理：明示 + 引导，不自动安装

首次使用需要约 2GB 下载。自动装会在用户不知情时吃掉磁盘和带宽，且 torch 下载可能失败（实测本机 111MB 包断了两次）。

**决定**：

- UI 显示环境体检结果（Python 版本、torch 是否可用、MPS 是否可用、权重是否存在）。
- 缺什么显示什么，给一条可复制的安装命令。
- 权重按需下载（首次转换时触发），显示进度与已下载大小。
- **绝不静默降级成假产物**。

### D10. 冒烟测试：真跑，但诚实报 SKIPPED

`verify-video-whitebox.mjs` 分三段：

1. **环境体检**（不需模型）：Python 可执行、venv 存在、torch 可导入、MPS 可用。
2. **链路可达性**：`POST /api/whitebox/jobs` 建任务 → 轮询到终态。环境缺失时必须返回明确的 `env-missing` 错误码。
3. **端到端真跑**（环境可用时）：用 `fixtures/` 里一条短视频真跑，断言 GLB 存在、magic 合法、三角形数 > 1000、包围盒最大边在 [target×0.9, target×1.1] 区间、素材卡出现且 `kind='model'`。

环境不可用时：前两段照跑，第三段输出 `SKIPPED(env)` 并以 **0** 退出，同时在 stdout 打出缺什么。

**为什么这样定**：如果用 mock 让冒烟永远绿，那这次 change 的核心价值（"给一个视频能生成一个白模"）就从未被验证过。用非 0 退出又会让没装环境的开发者无法跑任何测试。SKIPPED 是唯一诚实且可操作的选择。

### D11. 产物落盘位置与命名

走 `mediaPath(appRoot, 'project-assets')` 的项目媒体目录（与既有素材一致），文件名 `whitebox-<timestamp>-<rand>.glb`。

**为什么不用 `public/videos`**：`isGltfAssetUrl` 只认 `/project-assets/` 与 `/cc0-props/` 与 `/itch-props/`。落错目录等于产物在 UI 里永远看不见。

### D12. 视频来源：从项目素材或上传

复用 `server/shot3d-ingest.mjs` 的摄取能力（平台链接 / 上传 → 项目 assets），避免重写一套下载。

**决定**：Tab 内提供「选已有视频素材」与「上传新视频」两个入口；选已有的直接从 `project.assets` 里挑 `kind='video'` 的条目，零网络。

## Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| 2GB 首次下载失败（实测本机断过两次） | 用户装不上 | 断点续传 + 显示已下载大小 + 允许手工放置权重 |
| 低视角/快速运镜视频重建质量差 | 产物是一层地面片层 | 在 UI 明示「重建质量取决于视频的视差与视角」，不做虚假承诺；保留原始 npz 供重跑 |
| mac arm64 的 open3d 后续版本回归 | 网格为空 | 断言三角形数，小于阈值即报错而非产出空 GLB |
| DA3 上游接口变动（该项目仍在活跃开发） | 边车崩 | 锁 commit（`fire3d` 那套 `install.sh` 的做法）；`weights.json` 记校验和 |
| 用户把白模当"精确几何"使用 | 误导 | UI 与产物备注写「估算尺度、稠密重建、非语义分割」 |
