import type { IncomingMessage } from 'node:http'

export type BillingGuardError = {
  status: number
  kind: string
  code: string
  message: string
}

export type ApimartBillingCtx = {
  skipBilling?: boolean
  session?: { userId: number; email: string; emailVerified: boolean }
  error?: BillingGuardError
  cap?: string
  model?: string
  holdCredits?: number
  estimateCredits?: number
  traceId?: string
  qty?: number
  seconds?: number
}

export function isPlatformApimartKey(provider: { apiKey?: string; kind?: string } | undefined): boolean
export function billingDecision(
  provider: { apiKey?: string; kind?: string } | undefined,
  req: IncomingMessage,
): ApimartBillingCtx & { reason?: string }
export function guardApimartText(args: {
  provider?: { apiKey?: string; kind?: string }
  req: IncomingMessage
  model: string
  body: Record<string, unknown>
}): ApimartBillingCtx
export function finalizeApimartText(ctx: ApimartBillingCtx | null | undefined, usage: unknown): void
export function guardApimartImage(args: {
  provider?: { apiKey?: string; kind?: string }
  req: IncomingMessage
  model: string
  n?: number
  specKey?: string
}): ApimartBillingCtx
export function finalizeApimartImage(ctx: ApimartBillingCtx | null | undefined, actualCredits?: number | null): void
export function guardApimartVideo(args: {
  provider?: { apiKey?: string; kind?: string }
  req: IncomingMessage
  model: string
  seconds: number
  res?: string
}): ApimartBillingCtx
export function finalizeApimartVideo(ctx: ApimartBillingCtx | null | undefined, actualCredits?: number | null): void
export function releaseApimartHold(ctx: ApimartBillingCtx | null | undefined): void
export function upstreamApimartBillingMessage(err: Error): BillingGuardError & { kind: string }