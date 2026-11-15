/**
 * 预览用的转义工具。
 *
 * 角色名、外观描述、关键词都是自由文本，直接拼进 HTML 会被引号或尖括号逃逸。
 * 这里只做两件事：文本进 HTML 节点用 escapeHtml，数据进 <script> 用 jsonForScript。
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 文本节点与属性值共用；属性值两侧统一用双引号 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

/**
 * 把数据嵌入 <script> 的 JS 字面量。
 * 只把 < & > 转成 \u 形式不够——U+2028/2029 在老引擎里能断行，
 * 顺手一起转，代价为零。
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** 文件名安全化：保留可读性，去掉路径分隔符与控制字符 */
export function safeFileName(value: string, fallback = 'character'): string {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 60)
    .trim()
  return cleaned || fallback
}
