import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 2 ** 15
const r = 8
const p = 1
const maxmem = 64 * 1024 * 1024
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N, r, p, maxmem }, (error, key) => error ? reject(error) : resolve(key))
})

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== String(N) || parts[2] !== String(r) || parts[3] !== String(p)) return false
  const salt = Buffer.from(parts[4]!, 'base64url')
  const expected = Buffer.from(parts[5]!, 'base64url')
  if (salt.length !== 16 || expected.length !== 64) return false
  if (salt.toString('base64url') !== parts[4] || expected.toString('base64url') !== parts[5]) return false
  const actual = await derive(password, salt)
  return timingSafeEqual(actual, expected)
}
