import { describe, it, expect, vi } from 'vitest'

// Mock electron's `app` — it's only used by getConfigPath which the
// canonPath unit tests don't exercise. The vi.mock factory has to
// return both shapes (`app` named export + default) so different
// importers in the chain resolve correctly.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-userdata' }
}))

import { canonPath } from './config'

describe('canonPath', () => {
  it('returns empty string for empty input', () => {
    expect(canonPath('')).toBe('')
  })

  it('returns POSIX root unchanged', () => {
    // Test only validates non-Windows behavior since the host runs on Linux.
    if (process.platform === 'win32') return
    expect(canonPath('/')).toBe('/')
  })

  it('normalizes `..` segments', () => {
    if (process.platform === 'win32') return
    expect(canonPath('/foo/bar/../baz')).toBe('/foo/baz')
  })

  it('trims a trailing separator from a non-root path', () => {
    if (process.platform === 'win32') return
    expect(canonPath('/foo/bar/')).toBe('/foo/bar')
  })

  it('does not trim a single-slash root', () => {
    if (process.platform === 'win32') return
    expect(canonPath('/')).toBe('/')
  })

  it('is idempotent', () => {
    if (process.platform === 'win32') return
    const once = canonPath('/foo/bar/../baz/')
    const twice = canonPath(once)
    expect(twice).toBe(once)
  })

  it('collapses duplicate separators', () => {
    if (process.platform === 'win32') return
    expect(canonPath('/foo//bar///baz')).toBe('/foo/bar/baz')
  })
})
