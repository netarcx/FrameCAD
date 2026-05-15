import { exec, spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export interface GitHubAuthStatus {
  ghCliAvailable: boolean
  loggedIn: boolean
  username?: string
}

function run(cmd: string): Promise<string | null> {
  return new Promise(resolve => {
    exec(cmd, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve(null)
      else resolve((stdout || stderr || '').trim())
    })
  })
}

/**
 * Find the gh executable. Prefers `gh` if it's in PATH (works for most users
 * who installed GitHub CLI normally), but falls back to common install
 * locations because FrameCAD inherits the PATH it was launched with — if the
 * user installed gh AFTER opening FrameCAD, PATH won't have it yet.
 */
async function locateGh(): Promise<string | null> {
  // 1. PATH lookup
  if (await run('gh --version')) return 'gh'

  // 2. Common install locations by platform
  const candidates: string[] = []
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe'))
    }
    if (process.env.ProgramFiles) {
      candidates.push(path.join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe'))
    }
    if (process.env['ProgramFiles(x86)']) {
      candidates.push(path.join(process.env['ProgramFiles(x86)'] as string, 'GitHub CLI', 'gh.exe'))
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'gh.exe'))
    }
  } else {
    candidates.push('/usr/bin/gh', '/usr/local/bin/gh', '/snap/bin/gh')
    if (process.env.HOME) {
      candidates.push(path.join(process.env.HOME, '.local', 'bin', 'gh'))
    }
    if (process.platform === 'darwin') {
      candidates.push('/opt/homebrew/bin/gh', '/usr/local/bin/gh')
    } else {
      candidates.push('/home/linuxbrew/.linuxbrew/bin/gh')
    }
  }

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      // Quote the path for use in shell commands
      return candidate
    } catch { /* keep searching */ }
  }
  return null
}

function quoteForCmd(p: string): string {
  // Wrap in double quotes if it contains a space (Windows convention)
  return p.includes(' ') ? `"${p}"` : p
}

export async function githubAuthStatus(): Promise<GitHubAuthStatus> {
  const gh = await locateGh()
  if (!gh) return { ghCliAvailable: false, loggedIn: false }

  const status = await run(`${quoteForCmd(gh)} auth status`)
  const match = status?.match(/Logged in to github\.com\s+(?:as|account)\s+(\S+)/i)
  if (match) {
    await ensureGhCredentialHelper(gh)
    await cacheGhToken(gh)
    return { ghCliAvailable: true, loggedIn: true, username: match[1] }
  }
  return { ghCliAvailable: true, loggedIn: false }
}

/**
 * Run `gh auth setup-git` so git uses `gh` as its credential helper for
 * GitHub HTTPS URLs. Idempotent — safe to call on every launch.
 */
async function ensureGhCredentialHelper(gh: string): Promise<void> {
  await run(`${quoteForCmd(gh)} auth setup-git`)
}

/**
 * Write a GIT_ASKPASS script for `token` so git calls it instead of
 * prompting on /dev/tty (which doesn't exist for packaged Linux builds
 * launched from a .desktop file). The script handles both Username and
 * Password prompts that git sends during HTTPS auth.
 */
async function installAskpass(token: string): Promise<void> {
  const scriptPath = path.join(os.tmpdir(), 'framecad-git-askpass.sh')
  const script =
    '#!/bin/sh\n' +
    'case "$1" in\n' +
    '  Username*) echo "x-access-token" ;;\n' +
    `  Password*) echo "${token}" ;;\n` +
    'esac\n'
  await fs.writeFile(scriptPath, script, { mode: 0o700 })
  process.env.GIT_ASKPASS = scriptPath
  process.env.GIT_TERMINAL_PROMPT = '0'
}

async function cacheGhToken(gh: string): Promise<void> {
  const token = await run(`${quoteForCmd(gh)} auth token`)
  if (token) await installAskpass(token)
}

/**
 * Get the current GitHub token from any available source AND ensure
 * GIT_ASKPASS is installed for future git operations. Used as a
 * defensive fallback at clone/push/pull time so we always have a
 * working credential path even if auth status polling hasn't completed.
 * Returns null if no token is available anywhere.
 */
export async function getGitHubToken(): Promise<string | null> {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  const gh = await locateGh()
  if (!gh) return null
  const token = await run(`${quoteForCmd(gh)} auth token`)
  if (!token) return null
  await installAskpass(token)
  return token
}

/**
 * Sign out of GitHub via `gh auth logout`. Non-interactive (uses
 * `--hostname` and `-y`) so it just works without spawning a console.
 */
export async function githubLogout(): Promise<{ success: boolean; error?: string }> {
  const gh = await locateGh()
  if (!gh) {
    return { success: false, error: 'GitHub CLI not found.' }
  }
  const out = await run(`${quoteForCmd(gh)} auth logout --hostname github.com -y`)
  if (out === null) {
    return { success: false, error: 'gh auth logout failed.' }
  }
  return { success: true }
}

/**
 * Launch `gh auth login` in a new visible console window so the user can
 * follow the device-flow prompt. Resolves immediately — caller should
 * re-check status afterwards.
 */
export async function githubLogin(): Promise<{ launched: boolean; error?: string }> {
  const gh = await locateGh()
  if (!gh) {
    return {
      launched: false,
      error: 'GitHub CLI not found. Install from https://cli.github.com and restart FrameCAD.'
    }
  }

  if (process.platform === 'win32') {
    return launchGhLoginWindows(gh)
  }
  return launchGhLoginUnix(gh)
}

/**
 * Windows path: write a tiny .cmd script that runs `gh auth login --web`
 * and start it in a new console window. We use a script instead of
 * passing the gh command directly because nested quoting inside
 * `cmd /k "..."` is fragile when gh lives under a path with spaces
 * (`C:\Program Files\GitHub CLI\`) — cmd's parser drops tokens and
 * produces the bogus "Windows cannot find 'Github'" error.
 */
async function launchGhLoginWindows(gh: string): Promise<{ launched: boolean; error?: string }> {
  try {
    const scriptPath = path.join(os.tmpdir(), 'framecad-gh-login.cmd')
    const script =
      '@echo off\r\n' +
      'title FrameCAD GitHub Login\r\n' +
      'echo Signing in to GitHub...\r\n' +
      'echo.\r\n' +
      `${quoteForCmd(gh)} auth login --web --git-protocol https --hostname github.com\r\n` +
      'echo.\r\n' +
      'echo Press any key to close.\r\n' +
      'pause >NUL\r\n'
    await fs.writeFile(scriptPath, script, 'utf-8')

    const proc = spawn(
      `start "" ${quoteForCmd(scriptPath)}`,
      { shell: true, detached: true, stdio: 'ignore', windowsHide: false }
    )
    proc.unref()
    return { launched: true }
  } catch (err) {
    return { launched: false, error: (err as Error).message }
  }
}

/**
 * macOS / Linux path: spawning a terminal app cross-platform is a mess
 * (Terminal.app vs gnome-terminal vs konsole vs xterm vs…), so we just
 * tell the renderer the user needs to run `gh auth login --web` in their
 * own terminal. The renderer surfaces this as an instructional modal.
 * Returns launched=false with a special error sentinel the renderer
 * detects and renders nicely instead of as a red error banner.
 */
async function launchGhLoginUnix(_gh: string): Promise<{ launched: boolean; error?: string }> {
  return {
    launched: false,
    error: 'MANUAL_SIGNIN_REQUIRED:Open a terminal and run `gh auth login --web`, then click "Refresh status" in FrameCAD.'
  }
}

export interface GitHubRepoSummary {
  name: string
  description?: string
  url: string
  updatedAt?: string
  isPrivate?: boolean
}

export async function listGitHubRepos(
  org: string,
  prefix?: string
): Promise<{ success: boolean; repos: GitHubRepoSummary[]; error?: string }> {
  const gh = await locateGh()
  if (!gh) return { success: false, repos: [], error: 'GitHub CLI not found' }
  if (!org) return { success: false, repos: [], error: 'No GitHub organization configured' }
  const json = await run(`${quoteForCmd(gh)} repo list ${org} --json name,description,updatedAt,url,isPrivate --limit 200`)
  if (!json) return { success: false, repos: [], error: 'gh repo list returned nothing — check permissions and that the org exists' }
  try {
    interface RawRepo { name: string; description?: string; updatedAt?: string; url: string; isPrivate?: boolean }
    const raw = JSON.parse(json) as RawRepo[]
    let repos: GitHubRepoSummary[] = raw.map(r => ({
      name: r.name,
      description: r.description || undefined,
      url: r.url,
      updatedAt: r.updatedAt,
      isPrivate: r.isPrivate
    }))
    if (prefix && prefix.trim()) {
      const p = prefix.trim().toLowerCase()
      repos = repos.filter(r => r.name.toLowerCase().startsWith(p))
    }
    // Newest first
    repos.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    return { success: true, repos }
  } catch (err) {
    return { success: false, repos: [], error: 'Could not parse gh output: ' + (err as Error).message }
  }
}

export async function createGitHubRepo(
  org: string,
  name: string,
  isPrivate: boolean,
  description?: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  const gh = await locateGh()
  if (!gh) return { success: false, error: 'GitHub CLI not found' }
  if (!org || !name) return { success: false, error: 'Missing org or repo name' }

  const visibility = isPrivate ? '--private' : '--public'
  // Quote description for shell — escape any embedded quotes
  const desc = (description || 'FrameCAD project').replace(/"/g, '\\"')
  const cmd = `${quoteForCmd(gh)} repo create ${org}/${name} ${visibility} --description "${desc}"`
  const output = await run(cmd)
  if (!output) {
    return { success: false, error: 'gh repo create failed — check org permissions and that the repo name isn\'t already taken' }
  }
  // gh prints the canonical https URL. Build a .git form for cloning.
  return { success: true, url: `https://github.com/${org}/${name}.git` }
}

export async function gitResetup(): Promise<{ success: boolean; messages: string[]; error?: string }> {
  const messages: string[] = []
  try {
    const lfs = await run('git lfs install --skip-repo')
    if (lfs !== null) messages.push('Git LFS hooks reinstalled')
    else return { success: false, messages, error: 'git lfs install failed — is Git LFS installed?' }

    const branch = await run('git config --global init.defaultBranch main')
    if (branch !== null) messages.push('Default branch set to main')

    const name = await run('git config --global user.name')
    const email = await run('git config --global user.email')
    if (name) messages.push(`Git user: ${name}`)
    if (email) messages.push(`Git email: ${email}`)
    if (!name || !email) messages.push('⚠ user.name or user.email missing — set in Profile')

    return { success: true, messages }
  } catch (err) {
    return { success: false, messages, error: (err as Error).message }
  }
}
