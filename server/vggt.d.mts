export function cleanupVggtJobs(appRoot: string): void
export function isVggtAvailable(): boolean
export function resolveLocalVideoRef(appRoot: string, ref: string): string
export function submitVggtAnalyze(appRoot: string, body: Record<string, unknown>): Record<string, unknown>
export function getVggtJob(appRoot: string, id: string): Record<string, unknown> | null
export function cancelVggtJob(appRoot: string, id: string): Record<string, unknown>
