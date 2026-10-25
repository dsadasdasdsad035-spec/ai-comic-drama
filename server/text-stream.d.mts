export declare type ToolCallDelta = {
  index: number
  id: string
  name: string
  delta: string
}

export declare type FinalToolCall = {
  id: string
  name: string
  arguments: string
}

export declare class ChatStreamParser {
  text: string
  reasoningChars: number
  done: boolean
  finishReason: string
  error: string
  usage: Record<string, unknown> | null
  push(chunk: string): {
    deltas: string[]
    chars: number
    done: boolean
    finishReason: string
    error: string
    toolDeltas: ToolCallDelta[]
  }
  consumeLine(line: string): string | null
  consumeContent(content: string): string
  consumeToolCall(raw: unknown): void
  takeToolDeltas(): ToolCallDelta[]
  finalToolCalls(): FinalToolCall[]
  flush(): string
  end(): {
    text: string
    chars: number
    done: boolean
    finishReason: string
    error: string
    toolCalls: FinalToolCall[]
    toolDeltas: ToolCallDelta[]
    usage: Record<string, unknown> | null
  }
}
