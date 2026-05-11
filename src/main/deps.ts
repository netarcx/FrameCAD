import { exec } from 'child_process'

export interface ToolStatus {
  installed: boolean
  version?: string
}

export interface DependencyStatus {
  git: ToolStatus
  lfs: ToolStatus
}

function runCommand(cmd: string): Promise<string | null> {
  return new Promise(resolve => {
    exec(cmd, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) resolve(null)
      else resolve(stdout.trim())
    })
  })
}

export async function checkDependencies(): Promise<DependencyStatus> {
  const [gitOut, lfsOut] = await Promise.all([
    runCommand('git --version'),
    runCommand('git lfs version')
  ])
  return {
    git: { installed: !!gitOut, version: gitOut || undefined },
    lfs: { installed: !!lfsOut, version: lfsOut || undefined }
  }
}
