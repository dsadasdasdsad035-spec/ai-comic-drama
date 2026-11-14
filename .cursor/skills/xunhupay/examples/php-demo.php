<?php
/**
 * 虎皮椒支付 PHP SDK Demo
 *
 * 使用前请确认：
 * 1. 已获取 APPID 和 SECRET（虎皮椒后台「我的应用」）
 * 2. 已确认支付网关域名（后台「我的支付渠道」）
 * 3. notify_url 为公网可访问地址
 */

class XunhuPay
{
    private $appid;
    private $secret;
    private $gateway;

    public function __construct(string $appid, string $secret, string $gateway = 'https://api.xunhupay.com')
    {
        $this->appid   = $appid;
        $this->secret  = $secret;
        $this->gateway = rtrim($gateway, '/');
    }

    // ── 签名算法 ──────────────────────────────────────────────────

    /**
     * 生成签名 hash
     * 1. 过滤空值，排除 hash 字段
     * 2. 参数名 ASCII 字典序升序排列
     * 3. 拼接 key=value&key=value 格式
     * 4. 末尾追加 secret
     * 5. MD5 小写十六进制
     */
    public function makeSign(array $params): string
    {
        $filtered = [];
        foreach ($params as $k => $v) {
            if ($k !== 'hash' && $v !== '' && $v !== null) {
                $filtered[$k] = (string) $v;
            }
        }
        ksort($filtered); // ASCII 字典序
        $parts = [];
        foreach ($filtered as $k => $v) {
            $parts[] = "{$k}={$v}";
        }
        $signStr = implode('&', $parts) . $this->secret;
        return md5($signStr);
    }

    // ── 公共请求 ──────────────────────────────────────────────────

    /**
     * POST JSON 请求（application/json;charset=UTF-8）
     */
    private function post(string $uri, array $params): array
    {
        $params['hash'] = $this->makeSign($params);
        $jsonBody = json_encode($params, JSON_UNESCAPED_UNICODE);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $this->gateway . $uri,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $jsonBody,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json;charset=UTF-8',
                'Content-Length: ' . strlen($jsonBody),
            ],
        ]);
        $body = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if (curl_errno($ch)) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException("[xunhupay] HTTP 请求失败: {$err}");
        }
        curl_close($ch);

        $result = json_decode($body, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new RuntimeException("[xunhupay] 响应 JSON 解析失败: {$body}");
        }
        return $result;
    }

    /**
     * 生成 32 位随机字符串
     */
    private function nonceStr(): string
    {
        return bin2hex(random_bytes(16));
    }

    // ── 1. 发起支付 ────────────────────────────────────────────────

    /**
     * @param string $tradeOrderId 商户唯一订单号
     * @param float  $totalFee     金额（元）
     * @param string $title        商品标题
     * @param string $notifyUrl    异步回调地址（公网可访问）
     * @param string $returnUrl    同步跳转地址
     * @param string $callbackUrl  用户取消支付后跳转
     * @return array ["url" => ..., "url_qrcode" => ..., "open_order_id" => ...]
     */
    public function createPayment(
        string $tradeOrderId,
        float  $totalFee,
        string $title,
        string $notifyUrl,
        string $returnUrl   = '',
        string $callbackUrl = ''
    ): array {
        $params = [
            'version'        => '1.1',
            'appid'          => $this->appid,
            'trade_order_id' => $tradeOrderId,
            'total_fee'      => sprintf('%.2f', $totalFee),
            'title'          => $title,
            'notify_url'     => $notifyUrl,
            'return_url'     => $returnUrl,
            'callback_url'   => $callbackUrl,
            'time'           => (string) time(),
            'nonce_str'      => $this->nonceStr(),
        ];

        $result = $this->post('/payment/do.html', $params);

        if (($result['errcode'] ?? -1) !== 0) {
            throw new RuntimeException(
                "[xunhupay] 发起支付失败: " . ($result['errmsg'] ?? 'unknown')
                . " (code=" . ($result['errcode'] ?? '') . ")"
            );
        }

        return $result['data'];
    }

    // ── 2. 查询订单 ────────────────────────────────────────────────

    /**
     * @param string|null $tradeOrderId 商户订单号（与 openOrderId 二选一）
     * @param string|null $openOrderId  平台订单号（与 tradeOrderId 二选一）
     * @return array status: OD=已支付 | WP=待付款 | CD=已取消
     */
    public function queryOrder(?string $tradeOrderId = null, ?string $openOrderId = null): array
    {
        if (!$tradeOrderId && !$openOrderId) {
            throw new InvalidArgumentException('tradeOrderId 和 openOrderId 至少传一个');
        }

        $params = [
            'appid'     => $this->appid,
            'time'      => (string) time(),
            'nonce_str' => $this->nonceStr(),
        ];
        if ($tradeOrderId) {
            $params['out_trade_order'] = $tradeOrderId;
        } else {
            $params['open_order_id'] = $openOrderId;
        }

        return $this->post('/payment/query.html', $params);
    }

    // ── 3. 退款 ────────────────────────────────────────────────────

    /**
     * 仅支持全额退款
     * @return array refund_status: OD=已支付 | RD=退款中 | CD=已退款
     */
    public function refundOrder(
        ?string $tradeOrderId = null,
        ?string $openOrderId  = null,
        string  $reason       = ''
    ): array {
        if (!$tradeOrderId && !$openOrderId) {
            throw new InvalidArgumentException('tradeOrderId 和 openOrderId 至少传一个');
        }

        $params = [
            'appid'     => $this->appid,
            'reason'    => $reason,
            'time'      => (string) time(),
            'nonce_str' => $this->nonceStr(),
        ];
        if ($tradeOrderId) {
            $params['trade_order_id'] = $tradeOrderId;
        } else {
            $params['open_order_id'] = $openOrderId;
        }

        return $this->post('/payment/refund.html', $params);
    }

    // ── 4. 验证回调通知 ────────────────────────────────────────────

    /**
     * 验证虎皮椒异步回调签名
     * @param array $postData 回调 POST 数据（$_POST）
     */
    public function verifyCallback(array $postData): bool
    {
        $received = $postData['hash'] ?? '';
        $expected = $this->makeSign($postData);
        return $received === $expected;
    }
}


// ══════════════════════════════════════════════════════════════════
//  使用示例
// ══════════════════════════════════════════════════════════════════

// 从环境变量读取密钥（不要硬编码）
$appid  = getenv('XUNHUPAY_APPID')  ?: 'your_appid';
$secret = getenv('XUNHUPAY_SECRET') ?: 'your_secret';

$xunhu = new XunhuPay($appid, $secret);

// ── 发起支付 ──────────────────────────────────────────────────────
try {
    $result = $xunhu->createPayment(
        'ORDER_' . time(),
        9.90,
        '测试商品',
        'https://your-domain.com/notify/xunhupay',
        'https://your-domain.com/pay/return'
    );
    echo "支付链接: {$result['url']}\n";
    echo "二维码:   {$result['url_qrcode']}\n";
    echo "平台单号: {$result['open_order_id']}\n";
} catch (Exception $e) {
    echo "错误: {$e->getMessage()}\n";
}

// ── 查询订单 ──────────────────────────────────────────────────────
$result = $xunhu->queryOrder('ORDER_1700000000');
echo "订单状态: {$result['data']['status']}\n"; // OD / WP / CD

// ── 退款 ──────────────────────────────────────────────────────────
$result = $xunhu->refundOrder('ORDER_1700000000', null, '用户申请退款');
echo "退款状态: {$result['refund_status']}\n"; // OD / RD / CD


// ══════════════════════════════════════════════════════════════════
//  回调通知处理示例（以原生 PHP 为例）
// ══════════════════════════════════════════════════════════════════

// notify.php — 将此文件部署到公网，地址填入 notify_url
/*
<?php
require_once __DIR__ . '/XunhuPay.php';

$appid  = getenv('XUNHUPAY_APPID')  ?: 'your_appid';
$secret = getenv('XUNHUPAY_SECRET') ?: 'your_secret';
$xunhu  = new XunhuPay($appid, $secret);

// 回调通知以 POST 表单方式接收
$data = $_POST;
if (!$data) {
    http_response_code(400);
    echo 'empty data';
    exit;
}

// 第一步：验签
if (!$xunhu->verifyCallback($data)) {
    http_response_code(400);
    echo 'sign error';
    exit;
}

$status         = $data['status'];           // OD=成功
$tradeOrderId   = $data['trade_order_id'];   // 商户订单号
$totalFee       = $data['total_fee'];         // 实际支付金额
$openOrderId    = $data['open_order_id'];     // 平台订单号
$transaction_id = $data['transaction_id'];    // 交易号

if ($status === 'OD') {
    // 第二步：校验金额（与数据库预存金额对比，防篡改）
    // 第三步：幂等检查（已处理过的订单直接返回 success）
    // 第四步：执行业务逻辑（更新订单状态、发货等）
}

// 必须返回字符串 "success"，否则虎皮椒会重复通知
echo 'success';
*/
