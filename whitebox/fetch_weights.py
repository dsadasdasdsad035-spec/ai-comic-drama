#!/usr/bin/env python3
"""下载 DA3 权重，支持断点续传与校验和。

为什么不用 huggingface_hub.snapshot_download：实测本机直连 HF 的 CDN 会在
中途僵住（10 分钟零字节增长），而 snapshot_download 一旦卡住既不重试也不
报错，只能杀进程。这里用 curl 子进程 + `-C -` 续传，每轮有硬超时，断了
就再来一轮，进度可见。

用法：
  python fetch_weights.py --state-root /path            # 下载默认档位
  python fetch_weights.py --state-root /path --model da3-base
  python fetch_weights.py --state-root /path --check     # 只校验，不下载
  python fetch_weights.py --state-root /path --from FILE # 从本地文件拷入（应对内网/离线）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "weights.json"

# 单轮 curl 的硬超时。太短会让慢速网络一直重来，太长则卡住时看不到进展。
CURL_TIMEOUT_SEC = 240
MAX_ROUNDS = 60


def model_dir(state_root: Path, model: str) -> Path:
    return state_root / ".whitebox" / "models" / model


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def log(msg: str) -> None:
    print(msg, flush=True)


def resolve_https_proxy() -> str:
    """解析代理，顺序与 server/apimart-network.mjs 的 resolveSystemHttpsProxy 一致。

    HuggingFace 在本机直连返回 000（超时），必须走系统代理。不自动探测的话，
    用户得自己记得设 HTTPS_PROXY，而这个失败模式表现为「卡住不动」而不是报错，
    很难自己诊断出来。
    """
    for key in ("SB_HTTPS_PROXY", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        value = str(os.environ.get(key) or "").strip()
        if value:
            return value

    # macOS：读系统网络代理设置
    try:
        out = subprocess.run(
            ["scutil", "--proxy"], capture_output=True, text=True, timeout=3, check=False
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ""

    def has(pattern: str) -> bool:
        import re

        return bool(re.search(pattern, out))

    def grab(pattern: str) -> str:
        import re

        m = re.search(pattern, out)
        return m.group(1) if m else ""

    if has(r"HTTPSEnable\s*:\s*1"):
        host, port = grab(r"HTTPSProxy\s*:\s*(\S+)"), grab(r"HTTPSPort\s*:\s*(\d+)")
        if host and port:
            return f"http://{host}:{port}"
    if has(r"HTTPEnable\s*:\s*1"):
        host, port = grab(r"HTTPProxy\s*:\s*(\S+)"), grab(r"HTTPPort\s*:\s*(\d+)")
        if host and port:
            return f"http://{host}:{port}"
    return ""


def download_one(entry: dict, dest: Path, proxy: str = "", timeout: int = CURL_TIMEOUT_SEC) -> None:
    """断点续传下载单个文件，直到字节数达标。

    用 .part 中间文件：没有它就无法区分「下了一半」与「下完了」，
    而 curl 的 -C - 只能在目标文件已存在时续传。
    """
    url = entry["url"]
    want = int(entry["bytes"])
    part = dest.with_suffix(dest.suffix + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)

    if dest.exists() and dest.stat().st_size == want:
        log(f"  = {entry['name']} 已存在（{want} 字节）")
        return

    # 如果正式文件存在但大小不对，先当中间文件续传
    if dest.exists() and not part.exists():
        dest.rename(part)

    for round_no in range(1, MAX_ROUNDS + 1):
        have = part.stat().st_size if part.exists() else 0
        if have >= want:
            break
        pct = have * 100 // want if want else 0
        log(f"  ↓ {entry['name']} {have // 1024} / {want // 1024} KB ({pct}%) 第 {round_no} 轮")

        cmd = [
            "curl",
            "-sL",
            "--fail",
            "--max-time", str(timeout),
            "-C", "-",
            "-o", str(part),
        ]
        if proxy:
            cmd += ["--proxy", proxy]
        cmd.append(url)
        try:
            # 不 check=True：curl 因超时退出时 -C - 的进度仍然有效，下一轮接着续
            subprocess.run(cmd, check=False)
        except OSError as exc:
            raise SystemExit(f"无法执行 curl（{exc}）。确认 curl 在 PATH 里。") from exc

        if part.exists() and part.stat().st_size >= want:
            break

    if not part.exists() or part.stat().st_size < want:
        have = part.stat().st_size if part.exists() else 0
        raise SystemExit(
            f"下载未完成：{entry['name']} 只有 {have} / {want} 字节。\n"
            f"可以重跑本脚本续传，或用 --from 指定本地已下载的文件。"
        )

    part.replace(dest)
    log(f"  ✓ {entry['name']} 下载完成")


def verify(entry: dict, dest: Path) -> tuple[bool, str]:
    if not dest.exists():
        return False, "缺失"
    want = int(entry["bytes"])
    have = dest.stat().st_size
    if have != want:
        return False, f"字节数不符（{have} ≠ {want}）"
    expected = str(entry.get("sha256") or "")
    if expected:
        actual = sha256_of(dest)
        if actual != expected:
            return False, f"sha256 不符（{actual[:12]}… ≠ {expected[:12]}…）"
    return True, "ok"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state-root", default=str(HERE.parent), help="状态根，权重落在 <state-root>/.whitebox/models/")
    ap.add_argument("--model", default=None, help="档位键名，默认取 manifest 的 default")
    ap.add_argument("--check", action="store_true", help="只校验，不下载")
    ap.add_argument("--from", dest="from_file", default=None, help="从本地文件拷入（应对离线环境）")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出最终状态")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    model_key = args.model or manifest["default"]
    spec = manifest["models"].get(model_key)
    if not spec:
        raise SystemExit(f"未知档位：{model_key}（可选：{', '.join(manifest['models'])}）")

    state_root = Path(args.state_root).expanduser().resolve()
    dest_dir = model_dir(state_root, model_key)
    proxy = resolve_https_proxy()
    log(f"档位 {model_key} → {dest_dir}")
    if not args.check:
        log(f"网络：{'经系统代理 ' + proxy if proxy else '直连（若卡住请设 HTTPS_PROXY）'}")

    results = {}
    for entry in spec["files"]:
        dest = dest_dir / entry["name"]

        if args.check:
            ok, why = verify(entry, dest)
            log(f"  {'✓' if ok else '✗'} {entry['name']}: {why}")
            results[entry["name"]] = {"ok": ok, "reason": why}
            continue

        # --from 只接管大文件。config.json 只有 1.2KB，网络拿得到，
        # 没必要让用户为一个 1KB 文件准备本地副本。
        if args.from_file and entry["name"] == "model.safetensors":
            src = Path(args.from_file).expanduser().resolve()
            if not src.is_file():
                raise SystemExit(f"源文件不存在：{src}")
            ok, _why = verify(entry, dest)
            if ok:
                log(f"  = {entry['name']} 已存在且校验通过")
            else:
                log(f"  从本地拷入：{src} → {dest}")
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dest)

        ok, _why = verify(entry, dest)
        if not ok:
            download_one(entry, dest, proxy=proxy)
        ok, why = verify(entry, dest)
        log(f"  {'✓' if ok else '✗'} {entry['name']}: {why}")
        results[entry["name"]] = {"ok": ok, "reason": why}

    all_ok = all(v["ok"] for v in results.values())
    if args.json:
        print(json.dumps({"model": model_key, "dir": str(dest_dir), "ok": all_ok, "files": results}, ensure_ascii=False))
    if not all_ok:
        log("权重不完整。重跑本脚本续传，或用 --from 指定本地 model.safetensors。")
        return 1
    log(f"✓ 权重就绪：{dest_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
