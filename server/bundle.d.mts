export type BundleFile = {
  id: string
  path: string
  name: string
  kind: 'text' | 'image' | 'other'
  size: number
  textPreview?: string
  encoding?: string
}

export type BundleRejected = { path: string; reason: string }

export type OpenBundleResult = {
  bundleId: string
  files: BundleFile[]
  rejected: BundleRejected[]
  ignored: string[]
  warnings: string[]
  limits: { maxEntries: number; maxTotalBytes: number; maxPreviewChars: number }
}

export declare function openBundle(bytes: Buffer): OpenBundleResult
export declare function getBundle(id: string): unknown | null
export declare function readBundleFile(
  bundleId: string,
  fileId: string,
): { bytes: Buffer; file: BundleFile } | null
export declare function cleanupBundle(id: string): boolean
export declare function cleanupAllBundles(): void
