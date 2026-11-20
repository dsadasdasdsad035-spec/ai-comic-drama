export declare function readItchPropsManifest(appRoot: string): {
  schemaVersion: number
  samples: {
    id: string
    title: string
    pack: string
    license?: string
    itchUrl?: string
    categories?: string[]
    url: string
  }[]
  source?: string
  license?: string
  updatedAt?: string
}
export declare function itchPropsVendorReady(appRoot: string): boolean
export declare function parseItchPropUrl(url: string): string | null
export declare function resolveItchPropFile(appRoot: string, urlPath: string): string
export declare function importItchPropToProject(
  appRoot: string,
  projectName: string,
  sampleUrl: string,
  title: string,
): Promise<{ url: string; title: string; kind: string; note?: string }>