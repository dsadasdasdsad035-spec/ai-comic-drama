export type BillingUser = {
  id: number
  email: string
  email_verified: boolean
  is_admin?: boolean
}

export type BillingWallet = {
  credits: number
  available_credits: number
}

export type RechargePack = {
  id: string
  title: string
  price_cny: number
  credits_total: number
  credits_bonus?: number
}

async function billJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, credentials: 'include' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) {
    throw new Error(j.message || `请求失败 ${r.status}`)
  }
  return j as T
}

export async function fetchAuthMe(): Promise<{ user: BillingUser | null; wallet?: BillingWallet }> {
  return billJson('/api/auth/me')
}

export async function loginBilling(email: string, password: string) {
  return billJson<{ user: BillingUser }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export async function registerBilling(email: string, password: string) {
  return billJson<{ email: string; message: string }>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export async function logoutBilling() {
  return billJson('/api/auth/logout', { method: 'POST' })
}

export async function fetchRechargePacks(): Promise<RechargePack[]> {
  const j = await billJson<{ packs: RechargePack[] }>('/api/billing/packs')
  return j.packs
}

export async function startRecharge(packId: string) {
  return billJson<{ url_qrcode?: string; url?: string; trade_order_id: string }>('/api/billing/recharge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId }),
  })
}

export type RechargeOrderStatus = 'pending' | 'paid' | 'failed' | 'closed'

export async function fetchRechargeOrderStatus(tradeOrderId: string) {
  return billJson<{ status: RechargeOrderStatus; credits: number; paid_at?: string | null }>(
    `/api/billing/order?trade_order_id=${encodeURIComponent(tradeOrderId)}`,
  )
}

export async function fetchLedger(limit = 30) {
  return billJson<{ entries: unknown[] }>(`/api/billing/ledger?limit=${limit}`)
}

export async function fetchBillingSettingsAdmin() {
  return billJson<{ settings: Record<string, unknown> }>('/api/billing/settings')
}

export async function patchBillingSettingsAdmin(patch: Record<string, unknown>) {
  return billJson<{ settings: Record<string, unknown> }>('/api/billing/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export type ReconcileReport = {
  ok: boolean
  issues: string[]
  totals: { gifted_credits: number; recharged_credits: number; consumed_credits: number }
  channel: { platform_apimart_credits_owed: number; note: string }
  user_available_credits?: number
}

export async function fetchReconciliationReport() {
  return billJson<{ report: ReconcileReport }>('/api/billing/reconcile')
}