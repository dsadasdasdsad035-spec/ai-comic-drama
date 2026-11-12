import type { LexiconWhiteboxSheet } from './lexiconWhitebox'
import type { CodeEditorRendered, CodeEditorSave } from './SceneCodeWorkbench'
import { lexiconWhiteboxRenderPatch, lexiconWhiteboxSavePatch } from './lexiconWhitebox'

export function applyLexiconSave(
  sheets: LexiconWhiteboxSheet[],
  sheetId: string,
  input: CodeEditorSave,
): LexiconWhiteboxSheet[] {
  const existing = sheets.find((s) => s.id === sheetId)
  const patch = lexiconWhiteboxSavePatch(input, existing)
  return sheets.map((s) => (s.id === sheetId ? { ...s, ...patch } : s))
}

export function applyLexiconRender(
  sheets: LexiconWhiteboxSheet[],
  sheetId: string,
  input: CodeEditorRendered,
): LexiconWhiteboxSheet[] {
  const existing = sheets.find((s) => s.id === sheetId)
  const patch = lexiconWhiteboxRenderPatch(input, existing)
  return sheets.map((s) => (s.id === sheetId ? { ...s, ...patch } : s))
}
