import { exec, spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

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

  try {
    // Use the resolved full path so the new cmd window can find gh even if
    // PATH wasn't refreshed in the current TrentCAD process
    const ghPath = quoteForCmd(gh)
    const proc = spawn(
      'cmd.exe',
      ['/c', 'start', '"TrentCAD GitHub Login"', 'cmd.exe', '/k',
        `${ghPath} auth login --web --git-protocol https --hostname github.com && echo. && echo Press any key to close && pause >NUL`],
      { detached: true, stdio: 'ignore', windowsHide: false }
    )
    proc.unref()
    return { launched: true }
  } catch (err) {
    return { launched: false, error: (err as Error).message }
  }
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
