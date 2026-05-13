/**
 * Build-time team / fork branding values. Sourced from environment
 * variables at compile time (see electron.vite.config.ts `define`
 * block) and inlined as string literals by Vite. Kept in this thin
 * module — separate from `global-admin.ts` — so callers that only need
 * the baked-in defaults can read them without importing `electron`
 * (e.g. unit tests, the parts.ts default-prefix helper).
 */

declare const __TRENTCAD_DEFAULT_PROJECT_PREFIX__: string
declare const __TRENTCAD_DEFAULT_TEAM_NAME__: string
declare const __TRENTCAD_DEFAULT_ISSUE_REPO__: string

function pick(v: string | undefined): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export function getBuildDefaultPrefix(): string | null {
  try {
    if (typeof __TRENTCAD_DEFAULT_PROJECT_PREFIX__ === 'undefined') return null
    return pick(__TRENTCAD_DEFAULT_PROJECT_PREFIX__)
  } catch { return null }
}

export function getBuildDefaultTeamName(): string | null {
  try {
    if (typeof __TRENTCAD_DEFAULT_TEAM_NAME__ === 'undefined') return null
    return pick(__TRENTCAD_DEFAULT_TEAM_NAME__)
  } catch { return null }
}

/** Bug-report destination repo (`owner/name`). Forks override via the
 *  TRENTCAD_DEFAULT_ISSUE_REPO env var. Returns null if unset so the
 *  caller can fall back to the upstream tracker. */
export function getBuildDefaultIssueRepo(): string | null {
  try {
    if (typeof __TRENTCAD_DEFAULT_ISSUE_REPO__ === 'undefined') return null
    return pick(__TRENTCAD_DEFAULT_ISSUE_REPO__)
  } catch { return null }
}
