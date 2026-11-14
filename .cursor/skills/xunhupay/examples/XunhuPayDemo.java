import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.*;
/**
 * 虎皮椒支付 Java SDK Demo
 *
 * 使用前请确认：
 * 1. 已获取 APPID 和 SECRET（虎皮椒后台「我的应用」）
 * 2. 已确认支付网关域名（后台「我的支付渠道」）
 * 3. notify_url 为公网可访问地址
 * 4. Java 11+（使用 java.net.http.HttpClient）
 */
public class XunhuPayDemo {

    // ═══════════════════════════════════════════════════════════════
    //  核心实现
    // ═══════════════════════════════════════════════════════════════

    private final String appid;
    private final String secret;
    private final String gateway;
    private final HttpClient httpClient;
    private final SecureRandom random;

    public XunhuPayDemo(String appid, String secret, String gateway) {
        this.appid      = appid;
        this.secret     = secret;
        this.gateway    = gateway.replaceAll("/+$", ""); // 去除末尾斜杠
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(java.time.Duration.ofSeconds(10))
                .build();
        this.random     = new SecureRandom();
    }

    public XunhuPayDemo(String appid, String secret) {
        this(appid, secret, "https://api.xunhupay.com");
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
    public String makeSign(Map<String, String> params) {
        // 过滤空值和 hash 字段
        List<String> keys = new ArrayList<>();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            String k = entry.getKey();
            String v = entry.getValue();
            if (!"hash".equals(k) && v != null && !v.isEmpty()) {
                keys.add(k);
            }
        }
        // ASCII 字典序排序
        Collections.sort(keys);

        // 拼接
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            if (i > 0) sb.append('&');
            sb.append(keys.get(i)).append('=').append(params.get(keys.get(i)));
        }
        sb.append(secret); // 末尾追加 secret

        return md5(sb.toString());
    }

    private static String md5(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new RuntimeException("MD5 计算失败", e);
        }
    }

    // ── 公共请求 ──────────────────────────────────────────────────

    private String nonceStr() {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder(32);
        for (int i = 0; i < 32; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }

    /**
     * POST JSON 请求（application/json;charset=UTF-8）
     */
    private String post(String uri, Map<String, String> params) {
        params.put("hash", makeSign(params));

        // 构建 JSON body
        String jsonBody = mapToJson(params);

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(gateway + uri))
                    .header("Content-Type", "application/json;charset=UTF-8")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8))
                    .timeout(java.time.Duration.ofSeconds(10))
                    .build();

            HttpResponse<String> response = httpClient.send(request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

            if (response.statusCode() != 200) {
                throw new RuntimeException("[xunhupay] HTTP " + response.statusCode());
            }
            return response.body();
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("[xunhupay] 请求失败: " + e.getMessage(), e);
        }
    }

    /**
     * 将 Map 转为 JSON 字符串（简易实现，无需引入外部库）
     */
    private String mapToJson(Map<String, String> map) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> entry : map.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append(escapeJson(entry.getKey())).append('"')
              .append(':')
              .append('"').append(escapeJson(entry.getValue())).append('"');
        }
        sb.append('}');
        return sb.toString();
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    // ── 1. 发起支付 ────────────────────────────────────────────────

    /**
     * @param tradeOrderId 商户唯一订单号
     * @param totalFee     金额（元）
     * @param title        商品标题
     * @param notifyUrl    异步回调地址（公网可访问）
     * @param returnUrl    同步跳转地址
     * @param callbackUrl  用户取消支付后跳转
     * @return JSON 字符串
     */
    public String createPayment(String tradeOrderId, double totalFee,
                                String title, String notifyUrl,
                                String returnUrl, String callbackUrl) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("version",        "1.1");
        params.put("appid",          appid);
        params.put("trade_order_id", tradeOrderId);
        params.put("total_fee",      String.format("%.2f", totalFee));
        params.put("title",          title);
        params.put("notify_url",     notifyUrl);
        params.put("return_url",     returnUrl != null ? returnUrl : "");
        params.put("callback_url",   callbackUrl != null ? callbackUrl : "");
        params.put("time",           String.valueOf(Instant.now().getEpochSecond()));
        params.put("nonce_str",      nonceStr());

        return post("/payment/do.html", params);
    }

    // ── 2. 查询订单 ────────────────────────────────────────────────

    /**
     * @param tradeOrderId 商户订单号（与 openOrderId 二选一）
     * @param openOrderId  平台订单号（与 tradeOrderId 二选一）
     * @return JSON 字符串，status: OD=已支付 | WP=待付款 | CD=已取消
     */
    public String queryOrder(String tradeOrderId, String openOrderId) {
        if (tradeOrderId == null && openOrderId == null) {
            throw new IllegalArgumentException("tradeOrderId 和 openOrderId 至少传一个");
        }

        Map<String, String> params = new LinkedHashMap<>();
        params.put("appid",     appid);
        params.put("time",      String.valueOf(Instant.now().getEpochSecond()));
        params.put("nonce_str", nonceStr());
        if (tradeOrderId != null) {
            params.put("out_trade_order", tradeOrderId);
        } else {
            params.put("open_order_id", openOrderId);
        }

        return post("/payment/query.html", params);
    }

    // ── 3. 退款 ────────────────────────────────────────────────────

    /**
     * 仅支持全额退款
     * @return JSON 字符串，refund_status: OD=已支付 | RD=退款中 | CD=已退款
     */
    public String refundOrder(String tradeOrderId, String openOrderId, String reason) {
        if (tradeOrderId == null && openOrderId == null) {
            throw new IllegalArgumentException("tradeOrderId 和 openOrderId 至少传一个");
        }

        Map<String, String> params = new LinkedHashMap<>();
        params.put("appid",     appid);
        params.put("reason",    reason != null ? reason : "");
        params.put("time",      String.valueOf(Instant.now().getEpochSecond()));
        params.put("nonce_str", nonceStr());
        if (tradeOrderId != null) {
            params.put("trade_order_id", tradeOrderId);
        } else {
            params.put("open_order_id", openOrderId);
        }

        return post("/payment/refund.html", params);
    }

    // ── 4. 验证回调通知 ────────────────────────────────────────────

    /**
     * 验证虎皮椒异步回调签名
     * @param postData 回调 POST 参数（key=value 的 Map）
     */
    public boolean verifyCallback(Map<String, String> postData) {
        String received = postData.getOrDefault("hash", "");
        String expected = makeSign(postData);
        return received.equals(expected);
    }


    // ═══════════════════════════════════════════════════════════════
    //  使用示例
    // ═══════════════════════════════════════════════════════════════

    public static void main(String[] args) {
        // 从环境变量读取密钥（不要硬编码）
        String appid  = System.getenv().getOrDefault("XUNHUPAY_APPID",  "your_appid");
        String secret = System.getenv().getOrDefault("XUNHUPAY_SECRET", "your_secret");

        XunhuPayDemo xunhu = new XunhuPayDemo(appid, secret);

        // ── 发起支付 ──────────────────────────────────────────────
        try {
            String result = xunhu.createPayment(
                "ORDER_" + System.currentTimeMillis() / 1000,
                9.90,
                "测试商品",
                "https://your-domain.com/notify/xunhupay",
                "https://your-domain.com/pay/return",
                ""
            );
            System.out.println("发起支付返回: " + result);
        } catch (Exception e) {
            System.err.println("发起支付失败: " + e.getMessage());
        }

        // ── 查询订单 ──────────────────────────────────────────────
        try {
            String result = xunhu.queryOrder("ORDER_1700000000", null);
            System.out.println("查询订单返回: " + result);
        } catch (Exception e) {
            System.err.println("查询订单失败: " + e.getMessage());
        }

        // ── 退款 ──────────────────────────────────────────────────
        try {
            String result = xunhu.refundOrder("ORDER_1700000000", null, "用户申请退款");
            System.out.println("退款返回: " + result);
        } catch (Exception e) {
            System.err.println("退款失败: " + e.getMessage());
        }

        // ── 验证回调签名示例 ──────────────────────────────────────
        Map<String, String> callbackData = new LinkedHashMap<>();
        callbackData.put("status",          "OD");
        callbackData.put("trade_order_id",  "ORDER_1700000000");
        callbackData.put("total_fee",       "9.90");
        callbackData.put("open_order_id",   "HPJ2024...");
        callbackData.put("appid",           appid);
        callbackData.put("time",            "1700000000");
        callbackData.put("nonce_str",       "abc123");
        // hash 由虎皮椒生成，此处为示例
        callbackData.put("hash",            "calculated_hash_value");

        boolean valid = xunhu.verifyCallback(callbackData);
        System.out.println("回调签名验证: " + (valid ? "通过" : "不通过"));
    }
}


// ══════════════════════════════════════════════════════════════════
//  Spring Boot 回调通知处理示例
// ══════════════════════════════════════════════════════════════════

/*
@RestController
@RequestMapping("/notify")
public class XunhuPayCallbackController {

    private final XunhuPayDemo xunhu;

    public XunhuPayCallbackController() {
        String appid  = System.getenv().getOrDefault("XUNHUPAY_APPID",  "");
        String secret = System.getenv().getOrDefault("XUNHUPAY_SECRET", "");
        this.xunhu = new XunhuPayDemo(appid, secret);
    }

    @PostMapping("/xunhupay")
    public String paymentNotify(@RequestParam Map<String, String> postData) {
        // 第一步：验签
        if (!xunhu.verifyCallback(postData)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "签名验证失败");
        }

        String status        = postData.get("status");           // OD=成功
        String tradeOrderId  = postData.get("trade_order_id");   // 商户订单号
        String totalFee      = postData.get("total_fee");        // 实际支付金额
        String openOrderId   = postData.get("open_order_id");    // 平台订单号
        String transaction_id   = postData.get("transaction_id");    // 交易号

        if ("OD".equals(status)) {
            // 第二步：校验金额（与数据库预存金额对比，防篡改）
            // 第三步：幂等检查（已处理过的订单直接返回 success）
            // 第四步：执行业务逻辑（更新订单状态、发货等）
        }

        // 必须返回字符串 "success"，否则虎皮椒会重复通知
        return "success";
    }
}
*/
