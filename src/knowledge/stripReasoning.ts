/**
 * 剥掉模型输出里的推理块（前端侧副本）。
 *
 * 为什么前端也要一份：问答走 SSE 原样透传，服务端不解析事件，所以流式累积发生
 * 在浏览器里。这里与 `server/knowledge.mjs` 的 `stripReasoning` 保持同一行为，
 * 由 `verify-knowledge.mjs` 对两侧做一致性断言，避免只改一边。
 *
 * 实测：MiniMax 系模型经 AnythingLLM 调用会在正文前输出 `<think>…</think>`（英文），
 * 上游原样并进 `textResponse`。
 */
export function stripReasoning(text: string): string {
  let out = String(text || '')
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    if (next === out) break
    out = next
  }
  // 未闭合（流式截断）：从开标签起整段丢弃
  out = out.replace(/<think(?:ing)?>[\s\S]*$/gi, '')
  return out.trim()
}

/**
 * 剥掉命中片段里的上游元数据头（前端侧副本）。
 *
 * 与 `server/knowledge.mjs` 的 `stripChunkMetadata` 同行为。为什么前端也要：
 * 流式问答的 `sources` 是 SSE 原样透传，服务端的归一化只作用于非流式路径，
 * 所以不在这里再剥一次，引用卡里就会出现 `<document_metadata>sourceDocument: …`
 * —— 实测真实上游正是如此。
 */
export function stripChunkMetadata(text: string): string {
  return String(text || '')
    .replace(/<document_metadata>[\s\S]*?<\/document_metadata>/gi, '')
    .trim()
}

/** 把上游 SSE 送来的 sources 归一成界面要的形状（剥元数据头、收字段） */
export function normalizeStreamSources(raw: unknown): { title: string; text: string; score: number }[] {
  const list = Array.isArray(raw) ? raw : []
  return list
    .map((s: any) => ({
      title: String(s?.title || s?.metadata?.title || s?.chunkSource || '').trim(),
      text: stripChunkMetadata(s?.chunk || s?.text || ''),
      score: Number(s?.score ?? s?.similarity ?? 0) || 0,
    }))
    .filter((s) => s.title || s.text)
}
