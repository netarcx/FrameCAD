import { createHash } from 'crypto'
import { getEffectiveGlobalAdmin, getGlobalAdminState, saveGlobalAdmin } from './global-admin'

declare const __FRAMECAD_ADMIN_PIN_HASH__: string

/**
 * The admin-page PIN hash baked in at build time from the
 * FRAMECAD_ADMIN_PIN_HASH GitHub Actions secret. Empty string when no
 * secret was provided (the upstream public binary). Forks bake one in
 * to lock down their build; end users can additionally set their own
 * per-machine PIN through the admin panel — that override wins over
 * the build-time default.
 */
const RAW_HASH: string = (typeof __FRAMECAD_ADMIN_PIN_HASH__ !== 'undefined'
  ? __FRAMECAD_ADMIN_PIN_HASH__
  : '').toLowerCase().trim()

const HEX64 = /^[0-9a-f]{64}$/
const EMBEDDED_HASH = HEX64.test(RAW_HASH) ? RAW_HASH : ''

if (RAW_HASH && !HEX64.test(RAW_HASH)) {
  // The build-time secret is set but isn't a lowercase 64-char hex
  // SHA-256 digest (e.g. someone pasted the PIN itself). Log loudly
  // and ignore so admins don't get locked out by a misconfigured secret.
  console.error(
    '[admin-pin] FRAMECAD_ADMIN_PIN_HASH is set but is not a valid lowercase ' +
    'SHA-256 hex digest (expected 64 hex chars, got %d chars). Build-time PIN ignored.',
    RAW_HASH.length
  )
}

/**
 * Resolve the active PIN hash. User-set PIN wins; otherwise fall back
 * to the build-time embedded hash; otherwise empty (no PIN required).
 */
async function activeHash(): Promise<string> {
  try {
    const effective = await getEffectiveGlobalAdmin()
    const userHash = (effective.adminPinHash || '').toLowerCase().trim()
    if (HEX64.test(userHash)) return userHash
  } catch { /* fall through */ }
  return EMBEDDED_HASH
}

export async function isPinRequired(): Promise<boolean> {
  return (await activeHash()).length > 0
}

export async function verifyPin(pin: string): Promise<boolean> {
  const expected = await activeHash()
  if (!expected) return true
  if (!pin) return false
  const hash = createHash('sha256').update(pin.trim(), 'utf-8').digest('hex').toLowerCase()
  if (hash.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Persist a new admin PIN locally. Empty string clears the user override
 * (falling back to the build-time PIN if any, otherwise no PIN). The PIN
 * is hashed with SHA-256 before being written — the plaintext never
 * leaves this function.
 */
export async function setUserAdminPin(pin: string): Promise<void> {
  const trimmed = (pin || '').trim()
  const state = await getGlobalAdminState()
  const next = { ...state.effective }
  if (!trimmed) {
    next.adminPinHash = undefined
  } else {
    next.adminPinHash = createHash('sha256').update(trimmed, 'utf-8').digest('hex').toLowerCase()
  }
  await saveGlobalAdmin(next)
}
