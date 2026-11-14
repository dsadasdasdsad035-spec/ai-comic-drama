export declare function skillhubHomepage(namespace: string, slug: string): string
export declare function skillhubList(input?: {
  keyword?: string
  category?: string
  sortBy?: string
  page?: number
  pageSize?: number
}): Promise<{ total: number; page: number; pageSize: number; items: unknown[] }>
export declare function skillhubCategories(): Promise<Array<{ key: string; name: string }>>
export declare function skillhubDetail(
  slug: string,
  namespace?: string,
): Promise<Record<string, unknown>>
export declare function skillhubDownloadZip(slug: string, namespace?: string, version?: string): Promise<Buffer>
