export declare const MAX_ENTRIES: number
export declare const MAX_TOTAL_BYTES: number
export declare const MAX_IMAGE_BYTES: number
export declare const MAX_TEXT_BYTES: number
export type ZipEntry = {
  path: string
  encoding: string
  safeName: string
  dir: boolean
  method: number
  crc: number
  compSize: number
  rawSize: number
  localOffset: number
  unixMode: number
  flags: number
  junk: boolean
  unsafe: string | null
}
export declare function decodeEntryName(raw: Buffer, flags: number): { name: string; encoding: string }
export declare function unsafeReason(entryPath: string, unixMode: number): string | null
export declare function listZip(buf: Buffer): ZipEntry[]
export declare function entryKind(entry: ZipEntry): 'image' | 'text' | 'other'
export declare function limitFor(entry: ZipEntry): number
export declare function readEntry(buf: Buffer, entry: ZipEntry, opts?: { limit?: number }): Buffer
export declare function extractZip(
  buf: Buffer,
  entries: ZipEntry[],
  destDir: string,
  fsmod: unknown,
): {
  written: { id: string; path: string; name: string; kind: string; size: number; encoding: string; bytes: Buffer }[]
  rejected: { path: string; reason: string }[]
  ignored: string[]
  warnings: string[]
}
