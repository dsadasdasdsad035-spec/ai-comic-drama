/** server/lipsyncQa.mjs 的类型声明 */
export type LipSyncQaFrameResult = {
  at: number
  kind: 'silence' | 'speech'
  expect: 'closed' | 'open'
  path: string
}

export declare function analyzeLipSync(opts: {
  video: string
  audio?: string
  outDir: string
  ffmpeg?: string
  ffprobe?: string
  noise?: string
  minSilence?: number
}): Promise<{
  duration: number
  silenceIntervals: { start: number; end: number }[]
  frames: LipSyncQaFrameResult[]
  framesDir: string
}>
