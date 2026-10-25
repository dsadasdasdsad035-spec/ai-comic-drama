/** server/video-analyze.mjs 的类型声明（探测、场景切分与证据帧） */

export declare const MIN_SHOT_SECONDS: number
export declare const DEFAULT_SCENE_THRESHOLD: number
export declare const MAX_FRAMES_PER_REQUEST: number

export interface MediaProbe {
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  bitrate: number | null
  vcodec: string
  acodec: string
  hasAudio: boolean
  streamDuration: number | null
}

export interface SceneShot {
  index: number
  start: number
  end: number
}

export interface SceneSplit {
  duration: number
  threshold: number
  shots: SceneShot[]
}

export interface ExtractedFrame {
  at: number
  file: string
  bytes: number
}

export declare function probeMedia(file: string): Promise<MediaProbe>
export declare function splitScenes(
  file: string,
  opts?: { threshold?: number; minShotSeconds?: number },
): Promise<SceneSplit>
export declare function extractFrame(file: string, at: number, outFile: string): Promise<ExtractedFrame>
export declare function extractShotFrames(
  file: string,
  opts: {
    sourceId: string
    sessionDir: string
    shots: Array<{ index: number; start: number; end: number; frames?: string[] }>
    framesDir?: string
    overwrite?: boolean
    at?: 'start' | 'mid' | 'end'
  },
): Promise<Array<{ index: number; frames: string[]; at?: number; skipped?: boolean; error?: string }>>
export declare function extractCover(file: string, outFile: string): Promise<ExtractedFrame>
export declare function ffmpegStatus(): { ok: boolean; ffmpeg: string; ffprobe: string }
