/**
 * 工具结果里「模型该看什么」的裁剪规则。
 * 运行时用它生成模型可见摘要，界面仍拿到完整结果；
 * 只有一处实现，模型看到的历史不会因入口不同而不一致。
 */
export function modelFacingResult(toolName: string, result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const o = result as Record<string, unknown>
  if (toolName === 'run_render') {
    // 首帧是给 UI 预览的 data URL，不进入模型上下文。
    const { firstFrame: _firstFrame, ...rest } = o
    return rest
  }
  if (toolName === 'capture_frames' && Array.isArray(o.frames)) {
    // 只保留时间点，帧图片留给 UI。
    return {
      ...o,
      frames: o.frames.map((f) => (f && typeof f === 'object' ? { t: (f as { t?: unknown }).t } : f)),
    }
  }
  return o
}
