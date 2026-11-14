import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(password), salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':')
  if (parts.length !== 2) return false
  const [saltHex, hashHex] = parts
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const hash = scryptSync(String(password), salt, 64)
  if (expected.length !== hash.length) return false
  return timingSafeEqual(hash, expected)
}