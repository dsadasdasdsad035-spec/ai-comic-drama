export const MAX_CHAT_IMAGE_BYTES: number

export function placeholderText(label: string, reason: string): string

export function classifyChatImage(
  image: { label?: string; mimeType?: string; data?: string; bytes?: number },
  options: { providerKind?: string; vision?: boolean },
): { label: string; sent: boolean; reason?: string; mimeType?: string }

export function convertChatMessages<T extends { role?: string; content?: unknown }>(
  messages: T[],
  options: { providerKind?: string; vision?: boolean },
): T[]

export function imageContextLines(
  items: { label: string; sent: boolean; reason?: string }[],
): string[]
