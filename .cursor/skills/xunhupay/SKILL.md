---
name: xunhupay-payment
description: 虎皮椒支付（xunhupay）API集成，支持发起支付、查询订单、退款、验证回调通知、签名生成。当用户需要对接虎皮椒支付、集成微信/支付宝个人收款接口、处理虎皮椒支付回调签名验证、生成支付二维码时使用。
---

# 虎皮椒支付（XunhuPay）集成

## 前置条件

开始集成前，确认以下条件已满足：

| 条件 | 说明 |
|------|------|
| 虎皮椒账号 | 已注册并完成支付渠道配置 |
| APPID & SECRET | 在虎皮椒后台「我的应用」中获取 |
| 支付网关域名 | 在后台「我的支付渠道」查看实际网关地址，**可能不是** `api.xunhupay.com` |
| `notify_url` | 必须是公网可访问的 HTTP/HTTPS 地址，不可为 localhost |
| Python 依赖 | `requests` 库，运行 `pip install requests` 安装 |

> 如环境依赖未就绪，先运行 `python scripts/check_env.py` 自动检查（见 [scripts/check_env.py](scripts/check_env.py)）。

---

## 多语言示例

| 语言 | 文件 | 依赖 |
|------|------|------|
| Python | [examples/xunhupay_demo.py](examples/xunhupay_demo.py) | `requests`（`pip install requests`） |
| Go | [examples/xunhupay_demo.go](examples/xunhupay_demo.go) | Go 1.16+（无第三方依赖） |
| PHP | [examples/php-demo.php](examples/php-demo.php) | `curl` 扩展（通常默认启用） |
| Java | [examples/XunhuPayDemo.java](examples/XunhuPayDemo.java) | Java 11+ |

所有语言示例均包含：签名算法、发起支付、查询订单、退款、回调验证五大功能。

---

## 安全设计原则

- **APPID / SECRET 不得硬编码**，必须通过环境变量或配置文件注入
- 回调处理中**必须先验签**，拒绝签名不匹配的请求
- 验签通过后，**还需校验金额和订单号**，防止篡改
- 幂等处理：同一 `trade_order_id` 的成功回调可能重复发送，业务层需去重

```python
import os
APPID  = os.environ["XUNHUPAY_APPID"]   # 从环境变量读取
SECRET = os.environ["XUNHUPAY_SECRET"]  # 从环境变量读取
```

---

## 核心接口地址

```
发起支付：POST https://{gateway}/payment/do.html
查询订单：POST https://{gateway}/payment/query.html
退款申请：POST https://{gateway}/payment/refund.html
```

> `{gateway}` 以虎皮椒后台「我的支付渠道」显示的实际网关为准（如 `api.xunhupay.com`）。
> 所有接口使用 `POST JSON` 格式提交（`Content-Type: application/json;charset=UTF-8`）。

---

## 签名算法（hash）

```python
import hashlib

def make_sign(params: dict, secret: str) -> str:
    """
    1. 过滤空值参数，排除 hash 字段本身
    2. 按参数名 ASCII 字典序升序排列
    3. 拼接为 key=value&key=value 格式
    4. 末尾直接追加 secret（无任何连接符）
    5. 对整串做 MD5，返回小写十六进制
    """
    filtered = {k: str(v) for k, v in params.items()
                if v not in ("", None) and k != "hash"}
    query = "&".join(f"{k}={filtered[k]}" for k in sorted(filtered))
    return hashlib.md5((query + secret).encode("utf-8")).hexdigest()
```

---

## 执行流程

### 1. 发起支付

```python
import time, random, string, requests

GATEWAY = "https://api.xunhupay.com"  # 替换为后台实际网关

def create_payment(appid, secret, trade_order_id, total_fee,
                   title, notify_url, return_url="", callback_url=""):
    """
    支付类型（微信/支付宝）由 APPID 绑定的支付渠道自动决定，无需传参。
    返回: {"url": ..., "url_qrcode": ..., "open_order_id": ...}
    """
    params = {
        "version":        "1.1",
        "appid":          appid,
        "trade_order_id": trade_order_id,  # 商户唯一订单号（全局不可重复）
        "total_fee":      f"{float(total_fee):.2f}",  # 单位：元，保留两位小数
        "title":          title,
        "notify_url":     notify_url,      # 异步回调地址（公网可访问）
        "return_url":     return_url,      # 支付完成后同步跳转
        "callback_url":   callback_url,    # 用户取消支付后跳转
        "time":           str(int(time.time())),
        "nonce_str":      "".join(random.choices(string.ascii_letters + string.digits, k=32)),
    }
    params["hash"] = make_sign(params, secret)

    resp = requests.post(f"{GATEWAY}/payment/do.html", json=params, timeout=10)
    resp.raise_for_status()
    result = resp.json()

    if result.get("errcode") != 0:
        raise ValueError(f"[xunhupay] 发起支付失败: {result.get('errmsg')} (code={result.get('errcode')})")

    return {
        "url":           result["data"]["url"],          # 支付跳转地址
        "url_qrcode":    result["data"]["url_qrcode"],   # 二维码图片 URL
        "open_order_id": result["data"]["open_order_id"],
    }
```

### 2. 查询订单

```python
def query_order(appid, secret, trade_order_id=None, open_order_id=None):
    """
    trade_order_id / open_order_id 二选一传入。
    返回 status: OD=已支付 | WP=待付款 | CD=已取消
    """
    if not trade_order_id and not open_order_id:
        raise ValueError("trade_order_id 和 open_order_id 至少传一个")

    params = {
        "appid":     appid,
        "time":      str(int(time.time())),
        "nonce_str": "".join(random.choices(string.ascii_letters + string.digits, k=32)),
    }
    if trade_order_id:
        params["out_trade_order"] = trade_order_id
    else:
        params["open_order_id"] = open_order_id

    params["hash"] = make_sign(params, secret)

    resp = requests.post(f"{GATEWAY}/payment/query.html", json=params, timeout=10)
    resp.raise_for_status()
    return resp.json()
    # result["data"]["status"]: OD / WP / CD
```

### 3. 退款

```python
def refund_order(appid, secret, trade_order_id=None, open_order_id=None, reason=""):
    """
    仅支持全额退款，不支持部分退款。
    refund_status: OD=已支付 | RD=退款中 | CD=已退款
    """
    if not trade_order_id and not open_order_id:
        raise ValueError("trade_order_id 和 open_order_id 至少传一个")

    params = {
        "appid":     appid,
        "reason":    reason,
        "time":      str(int(time.time())),
        "nonce_str": "".join(random.choices(string.ascii_letters + string.digits, k=32)),
    }
    if trade_order_id:
        params["trade_order_id"] = trade_order_id
    else:
        params["open_order_id"] = open_order_id

    params["hash"] = make_sign(params, secret)

    resp = requests.post(f"{GATEWAY}/payment/refund.html", json=params, timeout=10)
    resp.raise_for_status()
    return resp.json()
```

### 4. 验证回调通知

```python
def verify_callback(post_data: dict, secret: str) -> bool:
    """验证虎皮椒异步回调签名，通过返回 True"""
    received = post_data.get("hash", "")
    expected = make_sign(post_data, secret)
    return received == expected


# ── Flask 回调处理示例 ──────────────────────────────────────────────
from flask import Flask, request, abort

app = Flask(__name__)

@app.route("/notify/xunhupay", methods=["POST"])
def payment_notify():
    data = request.form.to_dict()

    # 第一步：验签
    if not verify_callback(data, SECRET):
        abort(400, "签名验证失败")

    status          = data.get("status")           # OD=成功
    trade_order_id  = data.get("trade_order_id")   # 商户订单号
    total_fee       = data.get("total_fee")        # 实际支付金额
    open_order_id   = data.get("open_order_id")    # 平台订单号
    transaction_id   = data.get("transaction_id")    # 交易号

    if status == "OD":
        # 第二步：校验金额（与数据库预存金额对比，防篡改）
        # 第三步：幂等检查（已处理过的订单直接返回 success）
        # 第四步：执行业务逻辑（更新订单状态、发货等）
        pass

    return "success"  # 必须返回字符串 "success"，否则虎皮椒会重复通知
```

---

## 故障排查

| 现象 | 排查方向 |
|------|---------|
| `errcode != 0` | 检查 APPID/SECRET 是否正确；检查签名参数是否包含空值 |
| 签名验证失败 | 确认参数值均已转为字符串；确认 SECRET 无多余空格 |
| 回调未收到 | 确认 `notify_url` 公网可访问；检查服务器防火墙/端口 |
| 二维码无法扫码 | 确认支付渠道已在虎皮椒后台启用；检查网关域名是否正确 |
| 重复扣款 | 检查业务层幂等逻辑，同一 `trade_order_id` 不可重复创建 |
| 退款失败 | 虎皮椒不支持部分退款；确认订单状态为 `OD` 后再申请 |

---

## 详细参数参考

完整请求/返回/回调参数说明见 [reference.md](reference.md)。
