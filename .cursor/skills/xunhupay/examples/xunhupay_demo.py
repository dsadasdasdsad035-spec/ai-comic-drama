"""
虎皮椒支付 Python SDK Demo

使用前请确认：
1. 已获取 APPID 和 SECRET（虎皮椒后台「我的应用」）
2. 已确认支付网关域名（后台「我的支付渠道」）
3. notify_url 为公网可访问地址
4. 安装依赖：pip install requests
"""

import hashlib
import time
import random
import string
import os
import requests


class XunhuPay:
    """虎皮椒支付 SDK"""

    def __init__(self, appid: str, secret: str, gateway: str = "https://api.xunhupay.com"):
        self.appid = appid
        self.secret = secret
        self.gateway = gateway.rstrip("/")

    # ── 签名算法 ──────────────────────────────────────────────────

    def make_sign(self, params: dict) -> str:
        """
        生成签名 hash
        1. 过滤空值，排除 hash 字段
        2. 参数名 ASCII 字典序升序排列
        3. 拼接 key=value&key=value 格式
        4. 末尾追加 secret
        5. MD5 小写十六进制
        """
        filtered = {
            k: str(v) for k, v in params.items()
            if v not in ("", None) and k != "hash"
        }
        query = "&".join(f"{k}={filtered[k]}" for k in sorted(filtered))
        return hashlib.md5((query + self.secret).encode("utf-8")).hexdigest()

    # ── 公共请求 ──────────────────────────────────────────────────

    @staticmethod
    def _nonce_str() -> str:
        return "".join(random.choices(string.ascii_letters + string.digits, k=32))

    def _post(self, uri: str, params: dict) -> dict:
        """POST JSON 请求"""
        params["hash"] = self.make_sign(params)

        resp = requests.post(
            f"{self.gateway}{uri}",
            json=params,
            timeout=10,
        )
        resp.raise_for_status()
        result = resp.json()
        return result

    # ── 1. 发起支付 ────────────────────────────────────────────────

    def create_payment(
        self,
        trade_order_id: str,
        total_fee: float,
        title: str,
        notify_url: str,
        return_url: str = "",
        callback_url: str = "",
    ) -> dict:
        """
        发起支付（支付类型由 APPID 绑定的渠道自动决定）

        :return: {"url": ..., "url_qrcode": ..., "open_order_id": ...}
        """
        params = {
            "version": "1.1",
            "appid": self.appid,
            "trade_order_id": trade_order_id,
            "total_fee": f"{total_fee:.2f}",
            "title": title,
            "notify_url": notify_url,
            "return_url": return_url,
            "callback_url": callback_url,
            "time": str(int(time.time())),
            "nonce_str": self._nonce_str(),
        }

        result = self._post("/payment/do.html", params)

        if result.get("errcode") != 0:
            raise ValueError(
                f"[xunhupay] 发起支付失败: {result.get('errmsg')} "
                f"(code={result.get('errcode')})"
            )

        return result["data"]

    # ── 2. 查询订单 ────────────────────────────────────────────────

    def query_order(
        self,
        trade_order_id: str = None,
        open_order_id: str = None,
    ) -> dict:
        """
        查询订单状态

        :param trade_order_id: 商户订单号（与 open_order_id 二选一）
        :param open_order_id: 平台订单号（与 trade_order_id 二选一）
        :return: status: OD=已支付 | WP=待付款 | CD=已取消
        """
        if not trade_order_id and not open_order_id:
            raise ValueError("trade_order_id 和 open_order_id 至少传一个")

        params = {
            "appid": self.appid,
            "time": str(int(time.time())),
            "nonce_str": self._nonce_str(),
        }
        if trade_order_id:
            params["out_trade_order"] = trade_order_id
        else:
            params["open_order_id"] = open_order_id

        return self._post("/payment/query.html", params)

    # ── 3. 退款 ────────────────────────────────────────────────────

    def refund_order(
        self,
        trade_order_id: str = None,
        open_order_id: str = None,
        reason: str = "",
    ) -> dict:
        """
        退款（仅支持全额退款）

        :return: refund_status: OD=已支付 | RD=退款中 | CD=已退款
        """
        if not trade_order_id and not open_order_id:
            raise ValueError("trade_order_id 和 open_order_id 至少传一个")

        params = {
            "appid": self.appid,
            "reason": reason,
            "time": str(int(time.time())),
            "nonce_str": self._nonce_str(),
        }
        if trade_order_id:
            params["trade_order_id"] = trade_order_id
        else:
            params["open_order_id"] = open_order_id

        return self._post("/payment/refund.html", params)

    # ── 4. 验证回调通知 ────────────────────────────────────────────

    def verify_callback(self, post_data: dict) -> bool:
        """
        验证虎皮椒异步回调签名
        回调以 POST 表单方式发送（application/x-www-form-urlencoded）
        """
        received = post_data.get("hash", "")
        expected = self.make_sign(post_data)
        return received == expected


# ══════════════════════════════════════════════════════════════════
#  使用示例
# ══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # 从环境变量读取密钥（不要硬编码）
    appid = os.environ.get("XUNHUPAY_APPID", "your_appid")
    secret = os.environ.get("XUNHUPAY_SECRET", "your_secret")

    xunhu = XunhuPay(appid, secret)

    # ── 发起支付 ──────────────────────────────────────────────────
    try:
        result = xunhu.create_payment(
            trade_order_id=f"ORDER_{int(time.time())}",
            total_fee=9.90,
            title="测试商品",
            notify_url="https://your-domain.com/notify/xunhupay",
            return_url="https://your-domain.com/pay/return",
        )
        print(f"支付链接: {result['url']}")
        print(f"二维码:   {result['url_qrcode']}")
        print(f"平台单号: {result['open_order_id']}")
    except Exception as e:
        print(f"发起支付失败: {e}")

    # ── 查询订单 ──────────────────────────────────────────────────
    try:
        result = xunhu.query_order(trade_order_id="ORDER_1700000000")
        print(f"订单状态: {result['data']['status']}")  # OD / WP / CD
    except Exception as e:
        print(f"查询订单失败: {e}")

    # ── 退款 ──────────────────────────────────────────────────────
    try:
        result = xunhu.refund_order(
            trade_order_id="ORDER_1700000000",
            reason="用户申请退款",
        )
        print(f"退款状态: {result.get('refund_status')}")  # OD / RD / CD
    except Exception as e:
        print(f"退款失败: {e}")


# ══════════════════════════════════════════════════════════════════
#  Flask 回调通知处理示例
# ══════════════════════════════════════════════════════════════════

# from flask import Flask, request, abort
#
# app = Flask(__name__)
#
# @app.route("/notify/xunhupay", methods=["POST"])
# def payment_notify():
#     xunhu = XunhuPay(
#         os.environ["XUNHUPAY_APPID"],
#         os.environ["XUNHUPAY_SECRET"],
#     )
#
#     # 回调以 POST 表单方式发送
#     data = request.form.to_dict()
#
#     # 第一步：验签
#     if not xunhu.verify_callback(data):
#         abort(400, "签名验证失败")
#
#     status         = data.get("status")           # OD=成功
#     trade_order_id = data.get("trade_order_id")   # 商户订单号
#     total_fee      = data.get("total_fee")        # 实际支付金额
#     open_order_id  = data.get("open_order_id")    # 平台订单号
#
#     if status == "OD":
#         # 第二步：校验金额（与数据库预存金额对比，防篡改）
#         # 第三步：幂等检查（已处理过的订单直接返回 success）
#         # 第四步：执行业务逻辑（更新订单状态、发货等）
#         pass
#
#     return "success"  # 必须返回字符串 "success"
