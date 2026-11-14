# 虎皮椒支付 API 参数参考

## 发起支付接口

**地址**: `POST https://{gateway}/payment/do.html`

> 请求格式：`Content-Type: application/json;charset=UTF-8`

### 请求参数

| # | 参数名 | 类型 | 必填 | 说明 |
|---|--------|------|------|------|
| 1 | version | string(24) | 是 | API 版本号，固定值 `1.1` |
| 2 | appid | string | 是 | 应用 APP ID（后台「我的应用」获取） |
| 3 | trade_order_id | string | 是 | 商户系统唯一订单号，全局不可重复 |
| 4 | total_fee | string | 是 | 订单金额，单位**元**，保留两位小数，如 `9.90` |
| 5 | title | string | 是 | 商品标题 |
| 6 | notify_url | string | 是 | 支付成功异步回调地址（必须公网可访问） |
| 7 | return_url | string | 否 | 支付完成后同步跳转地址 |
| 8 | callback_url | string | 否 | 用户取消支付后跳转地址 |
| 9 | time | string | 是 | 当前时间戳（Unix 秒） |
| 10 | nonce_str | string(32) | 是 | 随机字符串，防重放攻击 |
| 11 | hash | string | 是 | MD5 签名（生成方式见下） |

> 支付类型（微信/支付宝）由 APPID 绑定的支付渠道自动决定，无需传 `type` 参数。

### 成功返回

```json
{
  "errcode": 0,
  "errmsg": "success",
  "hash": "...",
  "data": {
    "url":           "https://...",    // 支付跳转地址
    "url_qrcode":    "https://...",    // 二维码图片 URL
    "open_order_id": "HPJ2024..."      // 平台订单号
  }
}
```

### 失败返回

```json
{
  "errcode": 1,
  "errmsg": "错误描述"
}
```

---

## 查询订单接口

**地址**: `POST https://{gateway}/payment/query.html`

> 请求格式：`Content-Type: application/json;charset=UTF-8`

### 请求参数

| # | 参数名 | 类型 | 必填 | 说明 |
|---|--------|------|------|------|
| 1 | appid | string | 是 | APP ID |
| 2 | out_trade_order | string | 二选一 | 商户订单号 |
| 3 | open_order_id | string | 二选一 | 平台内部订单号 |
| 4 | time | string | 是 | 时间戳 |
| 5 | nonce_str | string(32) | 是 | 随机字符串 |
| 6 | hash | string | 是 | 签名 |

### 返回

```json
{
  "errcode": 0,
  "errmsg": "success",
  "hash": "...",
  "data": {
    "open_order_id": "HPJ2024...",
    "status": "OD"
  }
}
```

**status 枚举**

| 值 | 含义 |
|----|------|
| `OD` | 已支付（Order Done） |
| `WP` | 待付款（Waiting for Payment） |
| `CD` | 已取消（Cancelled） |

---

## 退款接口

**地址**: `POST https://{gateway}/payment/refund.html`

> 仅支持**全额退款**，不支持部分金额退款。
> 请求格式：`Content-Type: application/json;charset=UTF-8`

### 请求参数

| # | 参数名 | 类型 | 必填 | 说明 |
|---|--------|------|------|------|
| 1 | appid | string | 是 | APP ID |
| 2 | trade_order_id | string | 二选一 | 商户订单号 |
| 3 | open_order_id | string | 二选一 | 平台内部订单号 |
| 4 | reason | string | 否 | 退款原因 |
| 5 | time | string | 是 | 时间戳 |
| 6 | nonce_str | string(32) | 是 | 随机字符串 |
| 7 | hash | string | 是 | 签名 |

### 返回

```json
{
  "errcode": 0,
  "errmsg": "success",
  "hash": "...",
  "trade_order_id":  "HPJ2024...",
  "transaction_id":  "4200003...",
  "out_refund_no":   "HPJ2024...",
  "refund_fee":      "9.90",
  "reason":          "",
  "refund_status":   "CD",
  "refund_time":     "2026-05-18 12:00:00"
}
```

**refund_status 枚举**

| 值 | 含义 |
|----|------|
| `OD` | 已支付（尚未退款） |
| `RD` | 退款中 |
| `CD` | 已退款 |

---

## 异步回调通知参数

虎皮椒向 `notify_url` 以 POST 表单方式发送以下参数（`Content-Type: application/x-www-form-urlencoded`）：

| 参数名 | 说明 |
|--------|------|
| trade_order_id | 商户订单号 |
| total_fee | 实际支付金额（元） |
| transaction_id | 交易单号 |
| open_order_id | 平台订单号|
| order_title | 订单标题|
| status | 支付状态，`OD` 为支付成功 |
| plugins | 插件ID | 当传入此参数时才会有返回
| attach | 备注 | 当传入此参数时才会有返回
| appid | 支付渠道ID |
| time | 时间戳 |
| nonce_str | 随机字符串 |
| hash | 签名（**必须验证**） |

> 回调处理完成后必须返回字符串 `success`（纯文本），否则虎皮椒会在一段时间内重复通知。
> 同一订单可能收到多次回调，业务层需做幂等处理。

---

## Hash 签名算法

```
步骤一：收集所有请求参数，过滤掉值为空字符串或 None 的参数，并排除 hash 字段本身
步骤二：按参数名 ASCII 码从小到大排序（字典序升序）
步骤三：拼接为 URL 查询字符串：key1=val1&key2=val2&...
步骤四：在字符串末尾直接追加 secret（不加任何分隔符）
步骤五：对完整字符串计算 MD5，输出小写十六进制（32位）
```

**示例**

```
参数：appid=test123  nonce_str=abc  time=1700000000  total_fee=9.90
secret：mysecret

拼接结果：appid=test123&nonce_str=abc&time=1700000000&total_fee=9.90mysecret

hash = md5("appid=test123&nonce_str=abc&time=1700000000&total_fee=9.90mysecret")
     = "a3c2e1..."（小写32位）
```

---

## 常见错误及处理

| errcode | errmsg 关键词 | 处理方式 |
|---------|--------------|---------|
| 0 | success | 成功 |
| 1 | 签名错误 | 检查 SECRET 是否正确、参数值是否转为字符串、是否包含空值参数 |
| 1 | appid不存在 | 检查 APPID 是否正确 |
| 1 | 订单号已存在 | `trade_order_id` 重复，换新的订单号 |
| 1 | 金额格式错误 | `total_fee` 确保为字符串且保留两位小数 |

---

## 官方文档

- 发起支付：https://www.xunhupay.com/doc/api/pay.html
- 查询接口：https://www.xunhupay.com/doc/api/search.html
- 退款接口：https://www.xunhupay.com/doc/api/refund.html
- 准备工作：https://www.xunhupay.com/doc/prepare.html
