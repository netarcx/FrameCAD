import { createHash } from 'crypto'

declare const __FRAMECAD_ADMIN_PIN_HASH__: string

/**
 * The admin-page PIN hash baked in at build time from the
 * FRAMECAD_ADMIN_PIN_HASH GitHub Actions secret. Empty string when no
 * secret was provided (e.g. local dev builds) — in that case the admin
 * page opens without a PIN prompt.
 */
const RAW_HASH: string = (typeof __FRAMECAD_ADMIN_PIN_HASH__ !== 'undefined'
  ? __FRAMECAD_ADMIN_PIN_HASH__
  : '').toLowerCase().trim()

const HEX64 = /^[0-9a-f]{64}$/
const HASH_VALID = HEX64.test(RAW_HASH)
const EMBEDDED_HASH = HASH_VALID ? RAW_HASH : ''

if (RAW_HASH && !HASH_VALID) {
  // Admin set the GH secret to something that isn't a lowercase 64-char
  // hex SHA-256 digest (e.g. they pasted the PIN itself, or it has
  // stray whitespace / wrong case). Log loudly and fall back to "no gate"
  // so admins don't get locked out by a misconfigured secret.
  console.error(
    '[admin-pin] FRAMECAD_ADMIN_PIN_HASH is set but is not a valid lowercase ' +
    'SHA-256 hex digest (expected 64 hex chars, got %d chars). Admin gate disabled.',
    RAW_HASH.length
  )
}

export function isPinRequired(): boolean {
  return EMBEDDED_HASH.length > 0
}

export function verifyPin(pin: string): boolean {
  if (!EMBEDDED_HASH) return true
  if (!pin) return false
  const hash = createHash('sha256').update(pin.trim(), 'utf-8').digest('hex').toLowerCase()
  // Constant-time-ish comparison
  if (hash.length !== EMBEDDED_HASH.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ EMBEDDED_HASH.charCodeAt(i)
  }
  return diff === 0
}
