"""
虎皮椒支付环境依赖检查脚本
用法：python scripts/check_env.py
"""
import sys
import os

PASS = "[OK]"
FAIL = "[FAIL]"
WARN = "[WARN]"

errors = []
warnings = []

# ── 1. Python 版本检查 ────────────────────────────────────────────
major, minor = sys.version_info[:2]
if major < 3 or (major == 3 and minor < 7):
    errors.append(f"Python >= 3.7 required, current: {major}.{minor}")
    print(f"{FAIL} Python 版本: {major}.{minor}（需要 3.7+）")
else:
    print(f"{PASS} Python 版本: {major}.{minor}")

# ── 2. requests 库检查 ────────────────────────────────────────────
try:
    import requests
    print(f"{PASS} requests 已安装: {requests.__version__}")
except ImportError:
    errors.append("requests 未安装，请执行: pip install requests")
    print(f"{FAIL} requests 未安装 -> 执行: pip install requests")

# ── 3. hashlib / secrets 标准库检查 ──────────────────────────────
try:
    import hashlib, secrets
    print(f"{PASS} hashlib / secrets 标准库可用")
except ImportError as e:
    errors.append(str(e))
    print(f"{FAIL} 标准库缺失: {e}")

# ── 4. 环境变量检查 ───────────────────────────────────────────────
appid  = os.environ.get("XUNHUPAY_APPID")
secret = os.environ.get("XUNHUPAY_SECRET")

if not appid:
    warnings.append("环境变量 XUNHUPAY_APPID 未设置")
    print(f"{WARN} XUNHUPAY_APPID 未设置（可稍后配置）")
else:
    print(f"{PASS} XUNHUPAY_APPID 已设置")

if not secret:
    warnings.append("环境变量 XUNHUPAY_SECRET 未设置")
    print(f"{WARN} XUNHUPAY_SECRET 未设置（可稍后配置）")
else:
    print(f"{PASS} XUNHUPAY_SECRET 已设置")

# ── 5. 签名算法自测 ───────────────────────────────────────────────
try:
    import hashlib

    def _make_sign(params, sec):
        filtered = {k: str(v) for k, v in params.items()
                    if v not in ("", None) and k != "hash"}
        query = "&".join(f"{k}={filtered[k]}" for k in sorted(filtered))
        return hashlib.md5((query + sec).encode("utf-8")).hexdigest()

    test_params = {"appid": "test", "nonce_str": "abc",
                   "time": "1700000000", "total_fee": "9.90"}
    result = _make_sign(test_params, "mysecret")
    expected = hashlib.md5(
        "appid=test&nonce_str=abc&time=1700000000&total_fee=9.90mysecret"
        .encode("utf-8")
    ).hexdigest()

    if result == expected:
        print(f"{PASS} 签名算法自测通过")
    else:
        errors.append(f"签名算法自测失败: got={result}, expected={expected}")
        print(f"{FAIL} 签名算法自测失败")
except Exception as e:
    errors.append(f"签名算法异常: {e}")
    print(f"{FAIL} 签名算法异常: {e}")

# ── 汇总 ──────────────────────────────────────────────────────────
print()
if errors:
    print("=" * 50)
    print(f"检查完成，发现 {len(errors)} 个错误需修复：")
    for e in errors:
        print(f"  {FAIL} {e}")
    sys.exit(1)
elif warnings:
    print("=" * 50)
    print(f"检查完成，{len(warnings)} 个警告（不影响开发，上线前需配置）：")
    for w in warnings:
        print(f"  {WARN} {w}")
    sys.exit(0)
else:
    print("=" * 50)
    print("所有检查通过，环境就绪，可以开始集成虎皮椒支付。")
    sys.exit(0)
