export type StreamEvent = { type?: string; [key: string]: unknown }

/**
 * 解析代理发来的 SSE 块。纯函数，便于单测：
 * - 只认 `data:`，忽略注释与其它字段
 * - 支持跨 chunk 边界：未闭合的事件留到下一次 push
 * - 坏 JSON 静默丢弃，不影响后续事件
 */
export class SseEventParser {
  private buffer = ''

  push(text: string): StreamEvent[] {
    this.buffer += String(text || '')
    const out: StreamEvent[] = []
    for (;;) {
      const match = this.buffer.match(/\r?\n\r?\n/)
      if (!match || match.index == null) break
      const block = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')
      if (!data) continue
      try {
        out.push(JSON.parse(data) as StreamEvent)
      } catch {
        /* 坏事件丢弃，继续读后续 */
      }
    }
    return out
  }

  get pending(): string {
    return this.buffer
  }
}
