# Proposal

## Why

要把一段参考视频变成可用的结构参考，现在只有两条路，都不通：

- **白模工作台**（素材 → 镜头语言 → 自定义白模）要求人**手写 Blender Python** 搭场景。看到一段想复用的运镜，只能靠眼睛估空间关系再手动摆盒子，无法从视频还原。
- **Fire3D**（[xiahongchi/Fire3D](https://github.com/xiahongchi/Fire3D)）看起来正是「视频转三维」的答案，但**已验证不可用**：它只接受已经带位姿/深度的数据集（iTHOR posed RGB-D、Imaginarium、ScanNet++ Pi3 序列、单图对齐点云），`pyproject.toml` 里没有任何位姿估计依赖（无 Pi3 / VGGT / COLMAP / MASt3R），"casual RGB video" 只存在于论文标题。它还要求 Linux + Python 3.10 + CUDA 12.8，release 协议在 96GB GPU 上验证——本机是 macOS + M4 Pro + 24GB，物理上跑不了。代码 MIT 但权重与 DINOv3 另有许可。

**Depth Anything 3 已实测可行**（本机真跑，非估算）：一个 mp4 进，一个白模 GLB 出，全链路约 6 秒、峰值内存 3.1GB。

## What Changes

- **新增素材页第 9 个 Tab「视频转白模」**。上传或选择一条视频 → 抽帧 → DA3-BASE 估深度与位姿 → TSDF 融合成三角网格 → 覆写 clay 材质、尺度归一 → 落成 `.glb` 进项目媒体目录，并自动登记成 `kind: 'model'` 素材卡。
- **产物直接接进已有查看器**。`isGltfAssetUrl()` 只认 `/project-assets/` 下的 `.glb/.gltf`，「场景三维」的 GLB 资产列表天然可见，无需改动查看器。白模可在那儿摆机位、出图、当分镜参考。
- **Python 边车**。推理在独立 Python 进程里跑（`python -m whitebox_worker`），Node 侧只负责排队、超时、取消、落盘与登记。环境缺失时 UI 明示缺什么、怎么装，不静默失败。
- **模型档位**。默认 DA3-BASE（0.12B，Apache-2.0 可商用）。GIANT/LARGE 精度更好但 **CC BY-NC 4.0**，本仓库有钱包、有发布、有对外服务，不纳入默认路径。

## Capabilities

### New Capabilities

- `video-whitebox`：从视频生成白模资产的能力面——Tab 入口、任务生命周期、GLB 产物契约、失败与降级、冒烟验收口径。

### Modified Capabilities

- `asset-media-picker`：素材页分类从 8 个增到 9 个；新增 `kind: 'model'` 的产物登记路径（该 kind 在 `server/cc0-props.mjs` 已有先例，但素材页没有产生它的入口）。

## Impact

- **前端**：`src/AssetBoard.tsx` 的 `MaterialTab` 加一个值 + Tab 按钮 + 懒加载组件；新增 `src/whitebox/` 目录（面板、任务轮询、GLB 预览）。
- **服务端**：新增 `server/whitebox.mjs`（队列、子进程、超时、取消、落盘、素材登记）与对应路由；`server/app.ts` 挂路由。
- **Python**：新增 `whitebox/` 目录（`da3_infer.py`、`mesh_whitebox.py`、`install.sh`、`weights.json`）。
- **依赖**：首次使用需约 2GB 磁盘（torch 1.2GB + DA3-BASE 权重 516MB + 其余）。这是本方案最大的部署成本，必须在 UI 里提前告知。
- **验收**：新增 `verify-video-whitebox.mjs`。**真跑模型**，不是 mock——环境不可用时明确输出 `SKIPPED(env)` 并以 0 退出，不伪装成通过。
- **许可**：DA3 代码 Apache-2.0，BASE/SMALL 权重 Apache-2.0，可商用。DA3 内部依赖 DINOv3 系结构但用的是自训权重，发布前需复核 `THIRD_PARTY_NOTICES` 口径。

## Out of Scope

- **不做语义分割**。产物是稠密三角网格表面，不是干净的墙/地/家具。要分物体得另接分割模型（Fire3D 那套级联），不在本次范围。
- **不做 3DGS / NeRF**。DA3 有 `infer_gs` 分支，但高斯泼溅是渲染表示、不是可编辑几何，摆不进「场景三维」。
- **不做视频→运镜轨迹**。位姿是副产品（`extrinsics` 已在 npz 里），但"从轨迹生成 bpy 运镜"是另一条链路，本次不接。
- **不做远程 GPU**。本机边车是本次唯一形态。
- **不做 GIANT/LARGE 档位**。许可不允许商用，代码里不预留切换开关，避免有人打开。
