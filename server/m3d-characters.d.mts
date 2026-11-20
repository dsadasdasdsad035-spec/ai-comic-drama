export function readM3dCharactersManifest(appRoot: string): {
  schemaVersion: number
  samples: Array<{
    id: string
    title: string
    source: string
    license?: string
    categories?: string[]
    url: string
  }>
  entries?: unknown[]
  updatedAt?: string
}

export function m3dCharactersVendorReady(appRoot: string): boolean

export function readMergedCc0PropsManifest(appRoot: string): {
  schemaVersion: number
  source?: string
  license?: string
  updatedAt?: string
  sources?: string[]
  samples: Array<{
    id: string
    title: string
    source: string
    license?: string
    categories?: string[]
    url: string
  }>
  charactersReady?: boolean
}