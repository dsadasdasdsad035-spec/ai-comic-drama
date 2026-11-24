#!/usr/bin/env bash
#
# 视频转白模的 Python 推理环境安装。
#
# 设计要点（见 openspec/changes/video-to-whitebox/design.md）：
# - 幂等：重复跑不重复下载。已装的组件跳过，只有缺失才装。
# - 全落在 <state-root>/.whitebox/ 下，因为桌面端应用目录只读；
#   服务端用 resolveStateRoot(appRoot) 解析同一个位置（见 server/whitebox.mjs）。
# - 跳过 xformers：它在 macOS 上没有任何 wheel（PyPI 86 个版本零个 macosx 包），
#   而 DA3 的 swiglu_ffn.py 是 try/except 守护的，缺失会自动回落纯 PyTorch 实现。
#
# 用法：
#   bash whitebox/install.sh                      # 装到 <仓库根>/.whitebox
#   bash whitebox/install.sh --state-root ~/data  # 装到指定目录
#   bash whitebox/install.sh --check              # 只体检，不安装
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_ROOT="$ROOT"
CHECK_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --state-root) STATE_ROOT="$2"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [ "$CHECK_ONLY" = "1" ]; then
  PY="$STATE_ROOT/.whitebox/venv/bin/python"
  if [ ! -x "$PY" ]; then
    echo "未安装：$STATE_ROOT/.whitebox/venv"
    exit 1
  fi
  exec "$PY" "$ROOT/whitebox/doctor.py" --state-root "$STATE_ROOT" --pretty
fi

# ---------------------------------------------------------------- 选解释器
#
# DA3 要求 numpy<2，而 numpy 1.26.4 只提供到 cp312 的 macOS wheel
# （cp313 上会走源码编译并失败）。所以 3.10–3.12 优先，3.13 明确拒绝。
pick_python() {
  for cand in python3.12 python3.11 python3.10 python3; do
    if ! command -v "$cand" >/dev/null 2>&1; then continue; fi
    if "$cand" - <<'PY' >/dev/null 2>&1
import sys
sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)
PY
    then
      command -v "$cand"
      return 0
    fi
  done
  return 1
}

PYTHON="$(pick_python || true)"
if [ -z "$PYTHON" ]; then
  cat >&2 <<'EOF'
找不到可用的 Python（需要 3.10–3.12）。

为什么不是 3.13：DA3 依赖 numpy<2，而 numpy 1.26.4 没有 cp313 的 macOS wheel，
装 3.13 会退化成源码编译并失败。

  brew install python@3.12
EOF
  exit 1
fi
echo "使用解释器：$PYTHON ($("$PYTHON" -V 2>&1))"

WB="$STATE_ROOT/.whitebox"
VENV="$WB/venv"
VENDOR="$WB/vendor/depth-anything-3"
mkdir -p "$WB/vendor"

# ---------------------------------------------------------------- venv
if [ ! -x "$VENV/bin/python" ]; then
  echo "→ 创建 venv：$VENV"
  "$PYTHON" -m venv "$VENV"
else
  echo "→ venv 已存在，复用：$VENV"
fi
# 用 `python -m pip` 而不是 bin/pip。
#
# 理由：venv 里的 bin/pip 是带绝对路径 shebang 的脚本，环境目录一旦被移动
# （桌面端要放到 ~/Library/Application Support/.../state，或用户手工搬家），
# 它就变成 "bad interpreter" 而失效，但 `python -m pip` 不受影响。
# 实机踩过：安装好的环境整体移到 state 根后，bin/pip 直接不可执行。
PIP=("$VENV/bin/python" -m pip)

# 钉住 numpy：任何一步把它升到 2.x 都会让 DA3 与 open3d 的组合崩掉。
CONSTRAINTS="$WB/constraints.txt"
echo 'numpy==1.26.4' > "$CONSTRAINTS"

# 新 venv 自带的是 pip 25.0.x，不认识 --resume-retries（25.2 才加）。
# 先升级一次；升级失败也不致命——下面的 install_step 会按实际能力决定用不用它。
"${PIP[@]}" install --quiet --upgrade pip >/dev/null 2>&1 || echo "  （pip 升级失败，将跳过断点续传选项）"

# 探测 --resume-retries 是否可用：大包下载中断后能续传很重要
# （实测 torch 的 111MB 直连断过两次），但不能因为它让整个安装失败。
RESUME_FLAG=()
if "${PIP[@]}" install --help 2>/dev/null | grep -q -- '--resume-retries'; then
  RESUME_FLAG=(--resume-retries 30)
fi

# ---------------------------------------------------------------- 依赖
#
# 分批装的理由不是洁癖：torch 有 111MB（实测本机直连断过两次），
# 和其余几十个小包混在一个命令里失败时没法判断到底是谁断的。
install_step() {
  local label="$1"; shift
  if "${PIP[@]}" install --quiet --constraint "$CONSTRAINTS" --timeout 180 --retries 10 "${RESUME_FLAG[@]}" "$@"; then
    echo "  ✓ $label"
  else
    echo "  ✗ $label 失败。可重跑本脚本续装（已下载的会复用）。" >&2
    exit 1
  fi
}

if "$VENV/bin/python" -c "import torch" >/dev/null 2>&1; then
  echo "→ torch 已装，跳过"
else
  echo "→ 安装 torch（约 111MB）…"
  install_step "torch" "numpy==1.26.4" "torch==2.13.0" "torchvision==0.28.0"
fi

if "$VENV/bin/python" -c "import open3d" >/dev/null 2>&1; then
  echo "→ open3d 已装，跳过"
else
  echo "→ 安装 open3d（约 450MB）…"
  install_step "open3d" open3d
fi

# 只装 DA3 runtime 真正 import 到的包。它的 pyproject 还列了 pre-commit 这类开发
# 依赖与 xformers——前者与运行时无关，后者 mac 上没有 wheel。
#
# 装完 pip 会打印几条 "depth-anything-3 requires fastapi/pre-commit/xformers/opencv-python
# which is not installed"。那是 DA3 的 pyproject 声明与我们实际路径的差异，不是故障：
# fastapi 只服务 `da3 backend`、pre-commit 是开发工具、xformers 有 try/except 兜底、
# opencv 我们用 headless 版（同一个 cv2 模块）。这些提示可以忽略。
echo "→ 安装 DA3 runtime 依赖…"
install_step "runtime deps" \
  einops huggingface_hub imageio omegaconf safetensors pillow \
  trimesh plyfile typer addict requests \
  opencv-python-headless pillow-heif matplotlib scipy uvicorn \
  pycolmap evo e3nn "moviepy==1.0.3"

# ---------------------------------------------------------------- DA3 源码
#
# 锁 commit 而不是跟 main：上游仍在活跃开发，接口与配置随时可能变。
# 不 pip install 它（会把 xformers 拖进来），而是落成源码目录 + PYTHONPATH。
DA3_COMMIT="3d835ec1a5802d64a8b8b15f817a1ab54809bfe4"
DA3_REPO="https://github.com/ByteDance-Seed/depth-anything-3.git"

if [ -d "$VENDOR/src/depth_anything_3" ]; then
  echo "→ DA3 源码已存在：$VENDOR"
else
  echo "→ 克隆 DA3 源码（commit ${DA3_COMMIT:0:8}）…"
  rm -rf "$VENDOR"
  if ! git clone --filter=blob:none --no-checkout "$DA3_REPO" "$VENDOR" 2>/dev/null; then
    echo "  ✗ 克隆失败。检查网络（本机访问 GitHub 需要代理）。" >&2
    exit 1
  fi
  git -C "$VENDOR" checkout --quiet "$DA3_COMMIT"
  echo "  ✓ $VENDOR"
fi

# 源码目录里有个 assets/examples/robot_unitree.mp4，克隆后会被 .git 拖着，
# 但我们只要 src/。留下整个目录是为了让 pip 的元数据（若有）保持可用。

echo
echo "✓ 环境就绪：$VENV"
echo "  下一步：装权重（约 516MB）"
echo "    $VENV/bin/python $ROOT/whitebox/fetch_weights.py --state-root $STATE_ROOT"
echo "  体检："
echo "    $VENV/bin/python $ROOT/whitebox/doctor.py --state-root $STATE_ROOT --pretty"
