import { describe, it, expect, vi } from 'vitest'

// git.ts pulls in several Electron-y modules at top level but the
// helpers we're testing here are pure strings — stub the heavy deps
// so the import resolves cheaply.
vi.mock('electron', () => ({ app: { getVersion: () => 'test' } }))
vi.mock('./auth', () => ({ getGitHubToken: () => Promise.resolve(null) }))

import { isNonFastForward } from './git'

describe('isNonFastForward', () => {
  it('matches the classic git "rejected" line', () => {
    expect(isNonFastForward('error: failed to push some refs to origin\n! [rejected] main -> main (non-fast-forward)')).toBe(true)
  })

  it('matches "non-fast-forward"', () => {
    expect(isNonFastForward('updates were rejected because of non-fast-forward')).toBe(true)
  })

  it('matches "fetch first"', () => {
    expect(isNonFastForward('hint: Updates were rejected because the remote contains work that you do not have locally. Integrate the remote changes (e.g. \'git pull\') before pushing again. Hint: See the \'Note about fast-forwards\' in \'git push --help\' for details. error: failed to push some refs. fetch first')).toBe(true)
  })

  it('matches "tip of your current branch is behind"', () => {
    expect(isNonFastForward('the tip of your current branch is behind its remote counterpart')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isNonFastForward('NON-FAST-FORWARD')).toBe(true)
    expect(isNonFastForward('REJECTED')).toBe(true)
  })

  it('does NOT match an auth / network error', () => {
    expect(isNonFastForward('fatal: could not read Username for \'https://github.com\'')).toBe(false)
    expect(isNonFastForward('fatal: unable to access \'https://github.com/foo/bar.git/\': Could not resolve host')).toBe(false)
  })

  it('does NOT match an unrelated error', () => {
    expect(isNonFastForward('fatal: Authentication failed')).toBe(false)
    expect(isNonFastForward('error: pathspec did not match any files')).toBe(false)
  })
})
