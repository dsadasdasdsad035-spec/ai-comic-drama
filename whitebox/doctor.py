#!/usr/bin/env python3
"""推理环境体检：输出 JSON，给服务端路由与冒烟测试共用。

为什么要有这个：环境不满足时最糟的失败模式是「点了没反应」，用户不知道
是缺 Python、缺 torch、还是缺那 516MB 权重。四项分别检查、逐项给出修复方法。

用法：
  python doctor.py --state-root /path            # JSON
  python doctor.py --state-root /path --pretty   # 人读
退出码：0 = 全部就绪；1 = 有缺项（JSON 里写明缺什么）
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "weights.json"
MIN_PY = (3, 10)
MAX_PY = (3, 12)


def whitebox_root(state_root: Path) -> Path:
    return state_root / ".whitebox"


def describe_root(state_root: Path | None, runtime_root: Path | None) -> tuple[Path, Path]:
    """解析出（状态根, 环境根）。

    为什么需要两种：
    - 用户自装：环境在 <state-root>/.whitebox/
    - 随安装包：环境在 <appRoot>/whitebox-runtime/，没有 .whitebox 这一层

    服务端已经知道自己是哪一种（server/whitebox.mjs 的 whiteboxRoot），
    所以直接用 --runtime-root 把环境根传进来，不再让它猜。
    """
    if runtime_root is not None:
        return (state_root or runtime_root), runtime_root
    root = state_root or HERE.parent
    return root, whitebox_root(root)


def install_hint(state_root: Path, runtime_root: Path | None = None) -> str:
    """给出可复制的修复命令。

    随包环境的缺失是**构建问题**，不是用户能装的——这时不能让他去跑
    install.sh（装了也没用，服务端优先读随包那份）。所以单独给一句说明。
    """
    repo = HERE.parent
    if runtime_root is not None:
        return (
            f"随安装包的推理环境不完整（{runtime_root}）。这是构建问题，"
            "请联系打包方用 BUNDLE_WHITEBOX=1 重新构建；或在终端手工装到 state 根"
            "后改用默认构建。"
        )
    return f"bash {repo}/whitebox/install.sh --state-root {state_root}"


def check_python() -> dict:
    ver = sys.version_info[:2]
    ok = MIN_PY <= ver <= MAX_PY
    return {
        "ok": ok,
        "value": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "required": f">= {MIN_PY[0]}.{MIN_PY[1]}, <= {MAX_PY[0]}.{MAX_PY[1]}",
        "reason": "" if ok else "DA3 依赖 numpy<2，而 numpy 1.26 没有 cp313 的 macOS wheel",
    }


def probe_venv_interpreter(venv_python: Path) -> dict:
    """探测 venv 自己的解释器与 torch，而不是当前跑 doctor 的这名解释器。

    为什么必须区分：doctor 可能被系统 python 调用（服务端不知道 venv 在不在），
    这时 `import torch` 在本进程里可能成功（系统装了 torch）却和 venv 无关，
    报出一个假的 ✓ 比报 ✗ 更危险——用户会以为装好了。
    """
    if not venv_python.is_file():
        return {
            "ok": False,
            "python": None,
            "torch": None,
            "device": None,
            "reason": f"venv 不存在：{venv_python}",
        }

    # 子进程一次问完三件事，避免三次进程启动（每次都要算 torch 的动态链接）
    script = (
        "import json,sys\n"
        "out={'python': '%d.%d.%d' % sys.version_info[:3], 'torch': None, 'device': None}\n"
        "try:\n"
        "    import torch\n"
        "    out['torch']=torch.__version__\n"
        "    out['device']='mps' if torch.backends.mps.is_available() else 'cpu'\n"
        "except Exception as e:\n"
        "    out['error']=str(e)\n"
        "print(json.dumps(out))\n"
    )
    try:
        proc = subprocess.run(
            [str(venv_python), "-c", script],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
            env={**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE"},
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "python": None, "torch": None, "device": None, "reason": f"无法执行：{exc}"}

    raw = (proc.stdout or "").strip().splitlines()
    payload = {}
    for line in reversed(raw):
        try:
            payload = json.loads(line)
            break
        except json.JSONDecodeError:
            continue
    if not payload:
        tail = ((proc.stderr or "").strip().splitlines() or [""])[-1]
        return {
            "ok": False,
            "python": None,
            "torch": None,
            "device": None,
            "reason": f"解释器无响应（退出码 {proc.returncode}）{('：' + tail) if tail else ''}",
        }

    py_ver = payload.get("python")
    versions = tuple(int(p) for p in (py_ver or "0.0.0").split(".")[:2])
    torch_ver = payload.get("torch")
    ok_py = MIN_PY <= versions <= MAX_PY
    ok = bool(ok_py and torch_ver)
    reason = ""
    if not ok_py:
        reason = f"Python {py_ver} 不在 {MIN_PY[0]}.{MIN_PY[1]}–{MAX_PY[0]}.{MAX_PY[1]}（numpy<2 无该版本 wheel）"
    elif not torch_ver:
        reason = f"torch 未安装：{payload.get('error', '')}"
    return {
        "ok": ok,
        "python": py_ver,
        "torch": torch_ver,
        "device": payload.get("device"),
        "reason": reason,
    }


def check_source(vendor_src: Path) -> dict:
    ok = (vendor_src / "depth_anything_3").is_dir()
    return {
        "ok": ok,
        "value": str(vendor_src) if ok else None,
        "reason": "" if ok else f"DA3 源码缺失：{vendor_src}",
    }


def check_weights(model_dir: Path) -> dict:
    """只查存在与字节数，不每次算 sha256——516MB 的全量哈希要几秒，
    体检是高频调用（UI 每次进 Tab 都可能问），不能让它卡住界面。"""
    if not MANIFEST.is_file():
        return {"ok": False, "value": None, "reason": f"权重清单缺失：{MANIFEST}"}
    try:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"ok": False, "value": None, "reason": f"权重清单不可读：{exc}"}

    key = manifest.get("default")
    spec = (manifest.get("models") or {}).get(key)
    if not spec:
        return {"ok": False, "value": None, "reason": f"清单里没有档位 {key}"}

    missing = []
    total_bytes = 0
    for entry in spec.get("files", []):
        total_bytes += int(entry.get("bytes") or 0)
        path = model_dir / entry["name"]
        if not path.is_file():
            missing.append(entry["name"])
        elif int(entry.get("bytes") or 0) and path.stat().st_size != int(entry["bytes"]):
            missing.append(f"{entry['name']}（大小不符）")

    return {
        "ok": not missing,
        "value": {
            "model": key,
            "dir": str(model_dir),
            "bytes": total_bytes,
            "license": spec.get("license", ""),
        },
        "reason": "" if not missing else f"缺失：{', '.join(missing)}",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state-root", default=None, help="用户自装时的状态根（环境在 <state-root>/.whitebox）")
    ap.add_argument("--runtime-root", default=None, help="直接指定环境根（随安装包时用）")
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args()

    runtime_root = Path(args.runtime_root).expanduser().resolve() if args.runtime_root else None
    state_root, wb = describe_root(
        Path(args.state_root).expanduser().resolve() if args.state_root else None,
        runtime_root,
    )
    vendor_src = wb / "vendor" / "depth-anything-3" / "src"
    model_dir = wb / "models" / "da3-base"
    venv_python = wb / "venv" / "bin" / "python"

    probe = probe_venv_interpreter(venv_python)
    # 顺序固定下来，UI 按这个顺序展示（python → torch → device → source → weights）
    checks = {
        "python": {
            "ok": bool(probe.get("python")) and probe["ok"],
            "value": probe.get("python"),
            "required": f">= {MIN_PY[0]}.{MIN_PY[1]}, <= {MAX_PY[0]}.{MAX_PY[1]}",
            "reason": probe.get("reason", "") if not probe.get("python") else "",
        },
        "torch": {
            "ok": bool(probe.get("torch")),
            "value": probe.get("torch"),
            "reason": "" if probe.get("torch") else (probe.get("reason") or "torch 未安装"),
        },
        "device": {
            "ok": bool(probe.get("device")),
            "value": probe.get("device"),
            "reason": ""
            if probe.get("device") == "mps"
            else ("MPS 不可用，将使用 CPU（较慢）" if probe.get("device") else "无法判断设备"),
        },
        "source": check_source(vendor_src),
        "weights": check_weights(model_dir),
    }
    missing = [name for name, c in checks.items() if not c["ok"]]
    ok = not missing

    payload = {
        "ok": ok,
        "stateRoot": str(state_root),
        "venv": str(venv_python),
        "venvExists": venv_python.is_file(),
        "checks": checks,
        "missing": missing,
        "installHint": "" if ok else install_hint(state_root, runtime_root),
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
    }

    if args.pretty:
        print(f"状态根：{payload['stateRoot']}")
        print(f"venv   ：{payload['venv']}{'' if payload['venvExists'] else '  （不存在）'}")
        for name, c in checks.items():
            mark = "✓" if c["ok"] else "✗"
            value = c["value"] if not isinstance(c["value"], dict) else c["value"].get("model", "")
            print(f"  {mark} {name}: {value or '-'}")
            if c["reason"]:
                print(f"      {c['reason']}")
        if not ok:
            print(f"\n缺失：{', '.join(missing)}")
            print(f"修复：{payload['installHint']}")
    else:
        print(json.dumps(payload, ensure_ascii=False))

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
