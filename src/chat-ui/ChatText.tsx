import { ChatCodeBlock } from '@/chat-ui/ChatCodeBlock'

type Segment = { type: 'text'; text: string } | { type: 'code'; language: string; code: string }

/** 只识别成对 fenced code；未闭合 fence 继续作为普通文本。 */
export function splitFencedCode(text: string): Segment[] {
  const segments: Segment[] = []
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = fence.exec(text))) {
    if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index) })
    segments.push({ type: 'code', language: match[1].trim(), code: match[2] })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) })
  return segments.length ? segments : [{ type: 'text', text }]
}

export function ChatText({ text }: { text: string }) {
  const segments = splitFencedCode(text)
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === 'code' ? (
          <ChatCodeBlock key={`code-${i}`} code={segment.code} language={segment.language} />
        ) : (
          <div key={`text-${i}`} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {segment.text}
          </div>
        ),
      )}
    </>
  )
}
