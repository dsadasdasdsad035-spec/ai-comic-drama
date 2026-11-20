export declare function readCc0PropsManifest(appRoot: string): {
  schemaVersion: number
  samples: {
    id: string
    title: string
    source: string
    license?: string
    categories?: string[]
    url: string
  }[]
  source?: string
  updatedAt?: string
}
export declare function cc0PropsVendorReady(appRoot: string): boolean
export declare function parseCc0PropUrl(url: string): string | null
export declare function ensurePolyHavenModel(appRoot: string, assetId: string): Promise<string>
export declare function resolveCc0PropFile(appRoot: string, urlPath: string): string
export declare function listPolyHavenCacheFiles(dir: string): { rel: string; full: string; name: string }[]
export declare function importCc0PropToProject(
  appRoot: string,
  projectName: string,
  sampleUrl: string,
  title: string,
): Promise<{ url: string; title: string; kind: string; note?: string }>