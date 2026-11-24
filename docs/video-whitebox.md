# 视频转白模：推理环境

素材页「视频转白模」用一个本机 Python 边车跑 [Depth Anything 3](https://github.com/ByteDance-Seed/depth-anything-3)，把视频重建为白模 GLB。这份文档只讲环境：装什么、装在哪、坏了怎么修。

链路本身的设计取舍见 `openspec/changes/video-to-whitebox/design.md`。

## 为什么是一个独立 Python 环境

应用主进程是 Node。DA3 是 PyTorch 模型，必须跑在 Python 里。两种做法：

- **嵌入主进程**（比如 onnx / tfjs）——DA3 没有可用的导出，且它依赖 open3d 的 CUDA/CPU 算子，塞不进 Node。
- **一次性子进程**（本方案）——每次转换起一个独立进程，跑完退出。代价是每次都要重新加载 516MB 权重（首次冷启动约 27 秒，权重进页缓存后约 3 秒）；换来的是显存不常占、进程僵死不影响主应用、版本漂移可控。

转换是低频重操作（不是每镜都跑），这个代价可以接受。

## 安装

```bash
bash whitebox/install.sh
```

脚本幂等：已装的组件跳过，重复跑安全。它做四件事：

1. 挑一个 Python 3.10–3.12（**3.13 不行**，见下）。
2. 在 `<state-root>/.whitebox/venv` 建 venv。
3. 分批装依赖：torch → open3d → DA3 运行时依赖。
4. 克隆 DA3 源码到 `<state-root>/.whitebox/vendor/depth-anything-3`，**锁定 commit**。

### 装在哪：`--state-root` 决定一切

脚本把**所有运行时内容**（venv、DA3 源码、权重）写进 `<state-root>/.whitebox/`，脚本自己从哪个目录被调用无关紧要——可以放在只读的应用包里。

`<state-root>` 的默认值与你的启动方式有关：

| 启动方式 | state 根 | 说明 |
|---|---|---|
| `desktop:dev` / 打包后的 .app | `~/Library/Application Support/storyboard-canvas/state` | Electron 用 `app.getPath('userData')` 推导，见 `desktop/main/data-roots.mjs` |
| `npm run dev` / `npm start` | 仓库根 | 未注入 `SB_STATE_ROOT` 时的回退 |

**dev 与桌面端不是同一个位置。** 在仓库根装完，再开 `desktop:dev` 会看到体检全红（`venv 不存在：…/state/.whitebox/venv/bin/python`）。要么按上表给对 `--state-root`，要么把已有的 `.whitebox` 整体移过去（venv 搬家可用，`install.sh` 已改用 `python -m pip` 所以不依赖 shebang 绝对路径）。

桌面端的准确命令（面板上的「安装」提示会直接给出这一行，路径带空格要引号）：

```bash
bash "<仓库>/whitebox/install.sh" --state-root "$HOME/Library/Application Support/storyboard-canvas/state"
```

### 打包分发：两种构建方式

桌面端有两条打包路径，区别只在**带不带那 2GB 推理环境**。

| 构建方式 | 命令 | dmg 体积 | 用户首次使用 |
|---|---|---|---|
| 默认 | `npm run desktop:dist` | 约 1GB | 要自己在终端装环境（约 2GB、10 分钟） |
| 自带环境 | `npm run desktop:dist:bundled` | 约 3GB | **打开即用**，无需安装 |

自带的实现：`desktop/scripts/bundle-whitebox.mjs` 预先装好一套可搬迁的环境到
`desktop/bin/whitebox/`（约 2.1GB），打包时作为 `app/whitebox-runtime/` 塞进
`Contents/Resources`。服务端 `server/whitebox.mjs` 的 `whiteboxRoot()` 会优先
探测这个位置，找到就用它；找不到才回退到用户 state 根里的 `.whitebox/`。

自带环境里有什么：

| 组件 | 体积 | 说明 |
|---|---|---|
| `python/` | 约 50MB | python-build-standalone 3.12.16（aarch64），解压即用，不依赖系统 Python |
| `venv/` | 约 1.5GB | 预装 torch 2.13 / open3d / DA3 依赖，`--copies` 建法（不软链到构建机） |
| `vendor/` | 约 47MB | DA3 源码，锁定 commit，已删 `.git` |
| `models/da3-base/` | 约 516MB | DA3-BASE 权重 |

自己构建这一份：

```bash
npm run desktop:whitebox:bundle    # 约 10–20 分钟，需要网络
npm run desktop:whitebox:verify    # 只自检，不重建
```

构建脚本会做三件容易出错的事，都是实机踩过的：

1. **用 `--copies` 建 venv**。默认的 venv 把 `bin/python` 做成软链接指向构建机的
   解释器，搬进 .app 后直接 `bad interpreter`。
2. **重写 `pyvenv.cfg`** 的 `home` / `executable` 指向随包解释器。
3. **删掉 DA3 的 `.git`**：几十 MB 元数据运行时无用，还会让签名扫描变慢。

构建完脚本会跑一次真导入自检（`import torch, open3d` + `from depth_anything_3.api import ...`），
不通过就报错退出——不会产出「文件都在但跑不起来」的包。

#### 自带环境的限制

- **只支持 Apple Silicon**。随包解释器是 aarch64，Intel Mac 跑不了。做双架构要双份
  环境（约 4.2GB），当前不做。
- **首次启动不下载任何东西**，但要额外占约 2.1GB 磁盘。
- **签名慢**：`python/` 与 `venv/` 里有约 370 个 Mach-O（`.so` / `.dylib`），
  `sign-nested.mjs` 会逐个 codesign，比默认构建多花 2–8 分钟。
- 如果随包环境损坏（比如构建时网络中断），体检会明确说「这是构建问题，
  请联系打包方用 BUNDLE_WHITEBOX=1 重新构建」——不会误导用户去跑 install.sh。

### 默认构建（不带环境）的用户要做什么

`.app` 只带 `whitebox/` 的脚本（约 100KB），用户首次使用时：

1. 打开「素材 → 视频转白模」，面板报缺什么，并给出**带 `--state-root` 的完整安装命令**（路径已解析成用户自己机器的绝对路径）。
2. 复制那行命令到终端执行，装到自己的 state 根。
3. 回到面板点「重新检测」。

需要注意的前提：

- **系统自带 Python 不够**。macOS 的 `/usr/bin/python3` 是 3.9，低于我们的下限。用户需要自己装 3.10–3.12（`brew install python@3.12` 或 python.org 安装包）。`install.sh` 在找不到合格解释器时会打印这两条路径。
- **需要网络**：装依赖走 PyPI，克隆 DA3 源码走 GitHub，下权重走 HuggingFace。后两者在受限网络里需要代理（脚本会自动读系统代理）。

装完还要下权重：

```bash
<state-root>/.whitebox/venv/bin/python whitebox/fetch_weights.py --state-root <state-root>
```

### 为什么必须是 Python 3.10–3.12

DA3 依赖 `numpy<2`，而 numpy 1.26.4 只提供到 cp312 的 macOS wheel。装 3.13 会让 pip 退化成源码编译，然后失败在一个与 numpy 无关的 meson 报错上——排查起来很费时间。

检查当前解释器：

```bash
python3 -c "import sys; print(sys.version_info[:2])"
```

macOS 上装 3.12：`brew install python@3.12`。

### 为什么跳过 xformers

`install.sh` 不装 xformers。理由：它在 macOS 上**没有任何 wheel**（PyPI 86 个版本，零个 macosx 包），而 DA3 的 `model/dinov2/layers/swiglu_ffn.py` 把它包在 `try/except ImportError` 里——缺失时自动回落到纯 PyTorch 的 `SwiGLUFFN`，注意力层用的是 `F.scaled_dot_product_attention`，压根不碰 xformers。

装完 pip 会打印几条 `depth-anything-3 requires ... which is not installed` 的警告。那是 DA3 的 `pyproject.toml` 声明比实际路径宽，**不是故障**：

| 警告项 | 为什么可以忽略 |
|---|---|
| `xformers` | 有 try/except 兜底 |
| `fastapi` / `uvicorn` | 只服务 `da3 backend` 常驻模式，本方案不启动它 |
| `pre-commit` | 开发工具 |
| `opencv-python` | 我们用 `opencv-python-headless`，同一个 `cv2` 模块 |

## 权重

清单在 `whitebox/weights.json`：

| 档位 | 参数 | 许可 | 本项目是否使用 |
|---|---|---|---|
| `da3-base` | 0.12B | Apache-2.0 | **是（唯一档位）** |
| `da3-small` | 0.08B | Apache-2.0 | 未纳入，但许可允许 |
| `da3-large` | 0.35B | CC BY-NC 4.0 | 否 |
| `da3-giant` | 1.15B | CC BY-NC 4.0 | 否 |
| `da3nested-*` | 1.40B | CC BY-NC 4.0 | 否 |

**许可口径**：代码 Apache-2.0；BASE/SMALL 权重 Apache-2.0，可商用；LARGE/GIANT/NESTED 是 **CC BY-NC 4.0，禁止商业使用**。本仓库有钱包、有发布、有对外服务，所以只用 BASE，代码里也不预留档位切换开关——留开关等于给人误开的入口。

`DA3-BASE` 的文件：`model.safetensors` 精确 541,518,028 字节，sha256 `e01067dc1659613083d9145a9a2547ccdbe6ccbbf83c4fe7b3e8a4e2bdae78b5`（与 HuggingFace 的 blob 名一致，是内容寻址的自证）。

### 下载失败怎么办

`fetch_weights.py` 用 curl 子进程 + `-C -` 断点续传，每轮 240 秒硬超时，断了自动续。实测本机直连 CDN 会中途僵住，所以它还会自动读系统代理（macOS 走 `scutil --proxy`，与 `server/apimart-network.mjs` 同一套顺序：`SB_HTTPS_PROXY` → `HTTPS_PROXY` → 系统设置）。

如果网络实在不行，手工放：

```bash
# 1. 从任何能上网的地方下载 model.safetensors 与 config.json
# 2. 打开 HuggingFace 页面：https://huggingface.co/depth-anything/DA3-BASE/tree/main
# 3. 放到：
<state-root>/.whitebox/models/da3-base/model.safetensors
<state-root>/.whitebox/models/da3-base/config.json

# 4. 校验
<state-root>/.whitebox/venv/bin/python whitebox/fetch_weights.py --state-root <state-root> --check
```

或者直接从本地文件拷入（只接管大文件，config.json 仍走网络）：

```bash
<state-root>/.whitebox/venv/bin/python whitebox/fetch_weights.py \
  --state-root <state-root> --from /path/to/model.safetensors
```

## 体检

```bash
<state-root>/.whitebox/venv/bin/python whitebox/doctor.py --state-root <state-root> --pretty
```

五项，缺哪项写哪项：

| 项 | 期望 | 常见问题 |
|---|---|---|
| `python` | 3.10–3.12 | 3.13 会因 numpy<2 失败 |
| `torch` | 已装且可导入 | Mac 上要 arm64 wheel |
| `device` | `mps` 或 `cpu` | 没有 MPS 时回落 CPU，慢几倍但能跑 |
| `source` | DA3 源码存在 | 克隆失败通常是网络 |
| `weights` | 两个文件都在且大小对 | 只查字节数不每次算 sha256（516MB 哈希要几秒） |

UI 的「重新检测」按钮走 `GET /api/whitebox/health?refresh=1`，绕过 60 秒缓存。

## 排障

### `OMP: Error #15: ... libomp.dylib already initialized`

torch 与 pycolmap 各带一份 OpenMP 运行时。子进程环境必须设 `KMP_DUPLICATE_LIB_OK=TRUE`。`server/whitebox.mjs` 与 `whitebox/*.py` 都已经设了；手工跑脚本时自己加：

```bash
KMP_DUPLICATE_LIB_OK=TRUE <venv>/bin/python whitebox/da3_infer.py ...
```

### `TSDF 融合产出空网格`

两种可能：

1. **open3d 版本退化**。`0.20` 的 mac arm64 版 `ScalableTSDFVolume` 恒返回空网格（连官方文档式的单帧平面测试都是 0 顶点）。我们的代码固定用 `UniformTSDFVolume`；如果有人在 `mesh_whitebox.py` 里改回去，就会撞上这个。
2. **输入视频没有视差**。相机只平移一小段、或画面几乎是平的，重建不出一层以上的面。

### `重建过于稀疏：只有 N 个三角面`

这是**有意的失败**，不是 bug。阈值 1000 面——低于它说明输入不适合重建（视差不足、场景扁平、或抽到的帧几乎静止）。给一个空壳 GLB 报成功比明确失败更有害。

处理办法：换一条有相机运动的视频，或提高抽帧帧率（面板上的「抽帧帧率」）。

### 本机实测数据（M4 Pro / 24GB）

| 视频 | 三角面 | 说明 |
|---|---|---|
| 低机位推进（3.5s，抽 12 帧） | 58,461 | 有层次，质量好 |
| 转场合集（9.6s，含硬切） | 23,662 | 硬切破坏位姿连贯性，面数减半 |
| 扁平动画场景（4s，纯环绕） | 431 → 被阈值拒绝 | 场景本身是平的，只重建出一层 |

峰值内存：推理 1.5 GB，网格化 2.8 GB。单任务不会同时跑两段，所以峰值约 2.8 GB。
