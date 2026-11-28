/** server/canvas-thumb.mjs — 画布素材卡预览缩略图 */
export declare function isCanvasThumbCandidate(ref: unknown): boolean

export declare function ensureCanvasThumbFile(
  appRoot: string,
  ref: string,
  w?: number,
): Promise<string | null>

export declare function handleCanvasThumb(
  req: unknown,
  res: { statusCode?: number; end: (body?: string) => void },
  url: string,
  appRoot: string,
  serveFile: (res: unknown, req: unknown, file: string, mime: string) => void,
): Promise<boolean>