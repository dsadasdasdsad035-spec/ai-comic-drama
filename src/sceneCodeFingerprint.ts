import type { SceneCodeAssetRef, SceneCodeMeta } from './types'
import { shortHash } from './scheduleGeometry'

export type SceneCodeFingerprintInput = {
  codeHash: string
  abiVersion: number
  assets: Pick<SceneCodeAssetRef, 'key' | 'kind' | 'contentHash'>[]
  duration: number
  aspect: string
  mode: 'clean' | 'review'
}

export function normalizeCodeText(code: string): string {
  return String(code || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function fallbackHex(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ bytes[i], 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(normalizeCodeText(data))
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data)
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return fallbackHex(bytes)
}

export async function codeHashOf(code: string): Promise<string> {
  return sha256Hex(normalizeCodeText(code))
}

export async function assetContentHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  return sha256Hex(bytes)
}

export function stableAssetKey(source: SceneCodeAssetRef['source'], value: string): string {
  const raw = String(value || '').trim()
  const readable =
    source === 'character' || source === 'design'
      ? raw
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 36)
      : ''
  return `${source}:${readable || shortHash(raw)}`
}

export function sceneCodeFingerprint(input: SceneCodeFingerprintInput): string {
  const assets = [...input.assets]
    .map((a) => [a.key, a.kind, a.contentHash] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
  return shortHash(
    JSON.stringify({
      version: 1,
      abiVersion: Number(input.abiVersion) || 1,
      codeHash: input.codeHash,
      assets,
      duration: Number(input.duration.toFixed(3)),
      aspect: input.aspect,
      mode: input.mode,
    }),
  )
}

export function metaMatchesFingerprint(meta: SceneCodeMeta | undefined, fingerprint: string): boolean {
  return Boolean(meta && meta.version === 1 && meta.fingerprint === fingerprint)
}

export function codeAssetSignature(assets: Pick<SceneCodeAssetRef, 'key' | 'kind' | 'contentHash'>[]): string {
  return shortHash(
    JSON.stringify(
      [...assets]
        .map((a) => [a.key, a.kind, a.contentHash])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
  )
}
