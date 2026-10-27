/** server/publish-queue.mjs 的类型声明（进程内发布队列，并发 1） */

export declare function queueDepth(): number
export declare function isRunning(jobId: string): boolean
export declare function enqueue(
  jobId: string,
  opts?: { root: string; appRoot?: string; projectsRoot?: string },
): { queued: boolean; reason?: string }
export declare function cancel(jobId: string, root: string): { running: boolean }
export declare function startQueue(root: string): string
export declare function resetQueueForTest(): void
export declare function setContextFactoryForTest(fn: ((profileDir: string) => Promise<unknown>) | null): void
export declare function activeJobCount(root: string): number
/** 草稿/人工验证场景留给用户的窗口数量 */
export declare function keptOpenWindowCount(): number
/** 关闭所有留给用户的窗口，返回关闭数量 */
export declare function closeKeptOpenWindows(): Promise<number>
