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
 * locations because TrentCAD inherits the PATH it was launched with — if the
 * user installed gh AFTER opening TrentCAD, PATH won't have it yet.
 */
async function locateGh(): Promise<string | null> {
  // 1. PATH lookup
  if (await run('gh --version')) return 'gh'

  // 2. Common Windows install locations
  const candidates: string[] = []
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe'))
  }
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe'))
  }
  if (process.env['ProgramFiles(x86)']) {
    candidates.push(path.join(process.env['ProgramFiles(x86)'] as string, 'GitHub CLI', 'gh.exe'))
  }
  // winget installs to packages dir on some systems
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'gh.exe'))
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
  const match = status?.match(/(?:Logged in to|account)\s+github\.com\s+(?:as\s+)?(\S+)/i)
  if (match) return { ghCliAvailable: true, loggedIn: true, username: match[1] }
  return { ghCliAvailable: true, loggedIn: false }
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
      error: 'GitHub CLI not found. Install from https://cli.github.com and restart TrentCAD.'
    }
  }

  // Quoting a path-with-spaces inside `cmd /k "..."` is fragile (cmd's
  // nested-quote rules drop tokens, which is what produces the
  // "Windows cannot find 'Github'" error when gh lives under
  // `C:\Program Files\GitHub CLI\`). Write a tiny .cmd script instead and
  // start that — no nested quoting around the gh path required. We still
  // need to quote the script path itself because tmpdir on Windows
  // usually lives under the user profile, which may contain spaces.
  try {
    // Fixed filename — overwritten each invocation so temp files don't pile up
    const scriptPath = path.join(os.tmpdir(), 'trentcad-gh-login.cmd')
    const script =
      '@echo off\r\n' +
      'title TrentCAD GitHub Login\r\n' +
      'echo Signing in to GitHub...\r\n' +
      'echo.\r\n' +
      `${quoteForCmd(gh)} auth login --web --git-protocol https --hostname github.com\r\n` +
      'echo.\r\n' +
      'echo Press any key to close.\r\n' +
      'pause >NUL\r\n'
    await fs.writeFile(scriptPath, script, 'utf-8')

    // shell:true uses `cmd.exe /d /s /c "<command>"`, which has predictable
    // quote handling — the inner `start "" "<path>"` form parses correctly
    // even when scriptPath contains spaces.
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
  const desc = (description || 'TrentCAD project').replace(/"/g, '\\"')
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
