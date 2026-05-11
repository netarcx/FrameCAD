import path from 'path'
import { promises as fs } from 'fs'
import { getProjectPath, getGit } from './git'

export interface AdminConfig {
  teamName?: string
  welcomeMessage?: string
  defaultPartPrefix?: string
  /**
   * Canonical Git remote URL for the main project. Stored so newly cloned
   * setups can verify they're pointing at the right remote, and so admins
   * can centrally update it (rewrites `origin` when applied).
   */
  mainRepoUrl?: string
  /**
   * Separate Git repository containing shared COTS (Commercial Off-The-Shelf)
   * parts. TrentCAD clones this into a `COTS/` subfolder of the project on
   * every open and refreshes it on Sync. The folder is gitignored in the
   * main repo so the two histories never mix.
   */
  cotsRepoUrl?: string
  cotsBranch?: string
  /**
   * Set to true when THIS project is itself a COTS library. Disables the
   * part-numbering layer (no parts.json, no auto-assign, no + Part / + Assembly
   * buttons) since COTS files have their own external numbering authority.
   */
  isCotsProject?: boolean
}

/**
 * Write admin.json to disk without committing or pushing. Used during
 * create-project where there may not be anything pushed yet.
 */
export async function writeLocalAdminConfig(config: AdminConfig): Promise<void> {
  const fullPath = adminPath()
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, JSON.stringify(config, null, 2) + '\n')
}

const ADMIN_DIR = '.trentcad'
const ADMIN_FILE = 'admin.json'

function adminPath(): string {
  return path.join(getProjectPath(), ADMIN_DIR, ADMIN_FILE)
}

function relAdminPath(): string {
  return `${ADMIN_DIR}/${ADMIN_FILE}`
}

export async function loadAdminConfig(): Promise<AdminConfig> {
  try {
    const raw = await fs.readFile(adminPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeAdminConfig(config: AdminConfig): Promise<void> {
  const fullPath = adminPath()
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, JSON.stringify(config, null, 2) + '\n')
}

/**
 * Save admin settings and push them to git so every client gets them on
 * their next sync. The whole point of admin config is that it propagates
 * to teammates — so this commits + pushes atomically.
 */
export async function saveAndPublishAdminConfig(config: AdminConfig): Promise<void> {
  await writeAdminConfig(config)

  const g = getGit()
  await g.raw(['add', relAdminPath()])
  const status = await g.status()
  if (!status.files.some(f => f.path === relAdminPath())) {
    // Nothing actually changed
    return
  }

  await g.commit('[admin] Update settings')

  const remotes = await g.getRemotes(false)
  if (remotes.length === 0) return

  try {
    await g.push()
  } catch (err) {
    // Roll back the local commit so working tree is clean — admin can retry
    // after resolving (likely needs to pull first)
    await g.raw(['reset', '--soft', 'HEAD~1'])
    await g.raw(['reset', '--', relAdminPath()])
    throw new Error('Could not publish admin settings — pull/sync first and try again. (' + (err as Error).message + ')')
  }
}
