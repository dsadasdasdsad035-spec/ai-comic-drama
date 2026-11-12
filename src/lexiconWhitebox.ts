import type { ProjectData } from './api'
import type { ScheduleMeta, SceneCode, SceneCodeMeta } from './types'
import type { WorkbenchEntry } from './SceneCodeWorkbench'

/** 项目级自定义镜头语言白模（素材 → 镜头语言，非按镜调度） */
export type LexiconWhiteboxSheet = {
  id: string
  title: string
  seconds?: number
  motionNote?: string
  sceneCode?: SceneCode
  sceneCodeMeta?: SceneCodeMeta
  video?: string
  scheduleMeta?: ScheduleMeta
  updatedAt?: string
}

export function newLexiconWhiteboxSheet(title?: string): LexiconWhiteboxSheet {
  const id = `lex-wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  return {
    id,
    title: (title || '自定义白模').trim() || '自定义白模',
    seconds: 4,
    motionNote: '',
    updatedAt: new Date().toISOString(),
  }
}

/** 白模工作台的入口参数：只带条目自身的数据，不再伪装成分镜节点。 */
export function lexiconSheetToEntry(sheet: LexiconWhiteboxSheet): WorkbenchEntry {
  return {
    id: sheet.id,
    title: sheet.title,
    seconds: sheet.seconds ?? 4,
    ...(sheet.motionNote ? { motionNote: sheet.motionNote } : {}),
    ...(sheet.sceneCode ? { code: sheet.sceneCode } : {}),
    ...(sheet.sceneCodeMeta ? { codeMeta: sheet.sceneCodeMeta } : {}),
    ...(sheet.video ? { video: sheet.video } : {}),
    ...(sheet.scheduleMeta ? { scheduleMeta: sheet.scheduleMeta } : {}),
  }
}

export function mergeLexiconSheet(
  sheets: LexiconWhiteboxSheet[],
  id: string,
  patch: Partial<LexiconWhiteboxSheet>,
): LexiconWhiteboxSheet[] {
  let found = false
  const next = sheets.map((s) => {
    if (s.id !== id) return s
    found = true
    return { ...s, ...patch, id: s.id, updatedAt: patch.updatedAt ?? new Date().toISOString() }
  })
  if (!found) next.push({ ...newLexiconWhiteboxSheet(), ...patch, id })
  return next
}

export function listLexiconWhitebox(project: ProjectData | null | undefined): LexiconWhiteboxSheet[] {
  const raw = project?.lexiconWhitebox
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => {
      const id = String((s as LexiconWhiteboxSheet)?.id || '').trim()
      if (!id) return null
      return {
        ...(s as LexiconWhiteboxSheet),
        id,
        title: String((s as LexiconWhiteboxSheet)?.title || id).trim() || id,
      }
    })
    .filter(Boolean) as LexiconWhiteboxSheet[]
}

export function lexiconWhiteboxSavePatch(
  input: { sceneCode: SceneCode; sceneCodeMeta?: SceneCodeMeta },
  existing?: LexiconWhiteboxSheet,
): LexiconWhiteboxSheet {
  const base = existing ?? { id: '', title: '' }
  return {
    ...base,
    sceneCode: input.sceneCode,
    ...(input.sceneCodeMeta ? { sceneCodeMeta: input.sceneCodeMeta } : {}),
    motionNote: input.sceneCode.motionNote || base.motionNote || '',
    updatedAt: new Date().toISOString(),
  }
}

export function lexiconWhiteboxRenderPatch(
  input: {
    sceneCode: SceneCode
    sceneCodeMeta?: SceneCodeMeta
    video: string
    scheduleMeta: ScheduleMeta
  },
  existing?: LexiconWhiteboxSheet,
): LexiconWhiteboxSheet {
  return {
    ...lexiconWhiteboxSavePatch(input, existing),
    video: input.video,
    scheduleMeta: input.scheduleMeta,
  }
}
