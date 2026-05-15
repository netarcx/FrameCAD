import { exec } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { getBuildDefaultIssueRepo } from './branding'

/**
 * Where bug reports go. FrameCAD's own repo, not the user's project repo —
 * project bugs and FrameCAD bugs are different things. Forks override
 * the default via the FRAMECAD_DEFAULT_ISSUE_REPO env var at build time
 * so their auto-reports land in their own tracker instead of upstream.
 */
const ISSUE_REPO = getBuildDefaultIssueRepo() || 'netarcx/FrameCAD'
const ISSUE_LABEL = 'auto-report'

export interface ReportIssueResult {
  success: boolean
  url?: string
  number?: number
  error?: string
}

function quoteForCmd(p: string): string {
  return p.includes(' ') ? `"${p}"` : p
}

function run(cmd: string, opts: { timeout?: number } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise(resolve => {
    exec(cmd, { timeout: opts.timeout ?? 20000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      // exec's err.code can be either a numeric exit code (process exited
      // non-zero) or a string like 'ENOENT' (spawn failure). Coerce to a
      // numeric truthy value either way — callers only branch on code === 0.
      let code = 0
      if (err) {
        const raw = (err as NodeJS.ErrnoException & { code?: number | string }).code
        code = typeof raw === 'number' ? raw : 1
      }
      resolve({
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        code
      })
    })
  })
}

async function locateGh(): Promise<string | null> {
  if ((await run('gh --version')).code === 0) return 'gh'
  const candidates: string[] = []
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe'))
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'gh.exe'))
  }
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe'))
  }
  if (process.env['ProgramFiles(x86)']) {
    candidates.push(path.join(process.env['ProgramFiles(x86)'] as string, 'GitHub CLI', 'gh.exe'))
  }
  for (const c of candidates) {
    try { await fs.access(c); return c } catch { /* keep looking */ }
  }
  return null
}

function buildTitle(errorMessage: string): string {
  // First line, collapsed, capped — gh issue create titles are limited
  // and a long title makes triage harder
  const firstLine = errorMessage.split('\n')[0].replace(/\s+/g, ' ').trim()
  const trimmed = firstLine.length > 90 ? firstLine.slice(0, 87) + '…' : firstLine
  return `[Auto-report] ${trimmed || 'Unspecified error'}`
}

function buildBody(errorMessage: string, ghUser?: string): string {
  const version = app.getVersion()
  const platform = `${os.platform()} ${os.release()} (${os.arch()})`
  return [
    `**App version:** ${version}`,
    `**Platform:** ${platform}`,
    ghUser ? `**Reporter:** @${ghUser}` : '',
    '',
    '### Error',
    '```',
    errorMessage,
    '```',
    '',
    '<sub>Auto-reported from the FrameCAD error banner. The user clicked "Report" — no other context provided.</sub>'
  ].filter(line => line !== '').join('\n')
}

/**
 * Create a GitHub issue with the given error text. Requires `gh` to be
 * available and authenticated; caller should already have checked
 * `githubAuthStatus()` before invoking this.
 */
export async function reportIssue(errorMessage: string): Promise<ReportIssueResult> {
  const trimmed = (errorMessage || '').trim()
  if (!trimmed) return { success: false, error: 'No error message to report' }

  const gh = await locateGh()
  if (!gh) return { success: false, error: 'GitHub CLI not found' }
  const ghq = quoteForCmd(gh)

  // Resolve current user so the issue body can credit them; non-fatal
  let ghUser: string | undefined
  const who = await run(`${ghq} api user --jq .login`)
  if (who.code === 0 && who.stdout) ghUser = who.stdout

  const title = buildTitle(trimmed)
  const body = buildBody(trimmed, ghUser)

  // Pass title + body via stdin-friendly temp files? gh accepts -F - for body,
  // but for title we want a single short string. Easiest portable approach:
  // write the body to a temp file and pass --body-file. Avoids any shell
  // quoting issues with multi-line bodies that contain backticks, quotes,
  // and arbitrary user-supplied paths.
  const bodyPath = path.join(os.tmpdir(), `framecad-issue-${Date.now()}.md`)
  try {
    await fs.writeFile(bodyPath, body, 'utf-8')

    // Title is wrapped in "..." for the shell. On cmd.exe (Windows path),
    // `$` and backticks are literal so they're safe; on /bin/sh (Linux
    // dev path) they would interpolate. Strip them defensively so the
    // exact same code is correct on both. We control the title format
    // so stripping these characters never loses meaningful content.
    const safeTitle = title.replace(/["`$\\]/g, '').slice(0, 200)
    const cmd = `${ghq} issue create --repo ${ISSUE_REPO} --title "${safeTitle}" --body-file ${quoteForCmd(bodyPath)} --label ${ISSUE_LABEL}`
    const result = await run(cmd, { timeout: 30000 })

    if (result.code !== 0) {
      // gh prints either to stdout or stderr depending on the error class.
      // If the label doesn't exist on the repo, gh fails with a clear hint —
      // retry once without the label so first-use doesn't need a label set up.
      if (/label.+not found|could not add label/i.test(result.stderr + result.stdout)) {
        const fallback = await run(
          `${ghq} issue create --repo ${ISSUE_REPO} --title "${safeTitle}" --body-file ${quoteForCmd(bodyPath)}`,
          { timeout: 30000 }
        )
        if (fallback.code === 0) return parseIssueUrl(fallback.stdout)
        return { success: false, error: fallback.stderr || fallback.stdout || 'gh issue create failed' }
      }
      return { success: false, error: result.stderr || result.stdout || 'gh issue create failed' }
    }
    return parseIssueUrl(result.stdout)
  } finally {
    fs.unlink(bodyPath).catch(() => { /* best effort */ })
  }
}

function parseIssueUrl(stdout: string): ReportIssueResult {
  // gh prints the issue URL as the last token on success
  const url = stdout.split(/\s+/).find(t => /^https:\/\/github\.com\//.test(t))
  if (!url) return { success: true }
  const numMatch = url.match(/\/issues\/(\d+)/)
  return {
    success: true,
    url,
    number: numMatch ? Number(numMatch[1]) : undefined
  }
}
