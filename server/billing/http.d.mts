import type { IncomingMessage, ServerResponse } from 'node:http'

export function initBilling(appRoot: string): void
export function handleBillingHttp(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>,
  appRoot: string,
): Promise<boolean>