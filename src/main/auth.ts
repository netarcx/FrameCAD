import { exec, spawn } from 'child_process'

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

export async function githubAuthStatus(): Promise<GitHubAuthStatus> {
  const cliVersion = await run('gh --version')
  if (!cliVersion) return { ghCliAvailable: false, loggedIn: false }

  // `gh auth status` writes to stderr on success in some versions. run()
  // collects both. We look for "Logged in to github.com as <name>".
  const status = await run('gh auth status')
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
  const cliVersion = await run('gh --version')
  if (!cliVersion) {
    return { launched: false, error: 'GitHub CLI not installed' }
  }
  try {
    // start opens a new cmd window; /k keeps it open with `pause` so user
    // can see the result before closing
    const proc = spawn(
      'cmd.exe',
      ['/c', 'start', '"TrentCAD GitHub Login"', 'cmd.exe', '/k',
        'gh auth login --web --git-protocol https --hostname github.com && echo. && echo Press any key to close && pause >NUL'],
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
