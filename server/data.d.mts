/** server/data.mjs 的类型声明 */

export interface CanvasShot {
  id: string
  episode?: number
  no?: string
  seconds?: number
  size?: string
  move?: string
  dialogue?: unknown
  desc?: string
  keyframe_prompt?: string
  video_prompt?: string
  handEdited?: string[]
  orphan?: boolean
  [k: string]: unknown
}

export interface ProjectSummary {
  name: string
  title: string
  style: string
  aspect: string
  episodes: number
  shots: number
  seconds: number
  broken?: boolean
}

export interface ProjectData {
  name?: string
  style?: string
  aspect?: string
  episodes?: unknown[]
  characters?: unknown[]
  shots?: CanvasShot[]
  updated_at?: string
  [k: string]: unknown
}

export function safeProjectName(name: unknown): string
export function resolveRoot(appRoot: string): string
export function listProjects(root: string): ProjectSummary[]
export function readProject(root: string, name: string): ProjectData
export function writeProject(root: string, name: string, data: ProjectData): ProjectData
export function mergeShots(existing?: CanvasShot[], incoming?: CanvasShot[]): CanvasShot[]

export function createProject(root: string, name: string, init?: { title?: string; style?: string; aspect?: string }): ProjectData
