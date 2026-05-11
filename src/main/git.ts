import simpleGit, { SimpleGit } from 'simple-git'
import path from 'path'
import fs from 'fs/promises'
import type { FileEntry, FileState, HistoryEntry, PartsManifest, PublishProgress, PublishResult, SyncResult } from '@shared/types'
import { getLocks } from './locking'
import { loadManifest, syncManifest, annotatePartNumbers } from './parts'

const LFS_PATTERNS = [
  '*.sldprt', '*.sldasm', '*.slddrw',
  '*.SLDPRT', '*.SLDASM', '*.SLDDRW',
  '*.step', '*.stp', '*.STEP', '*.STP',
  '*.stl', '*.STL',
  '*.iges', '*.igs',
  '*.3dxml',
  '*.pdf', '*.PDF',
  '*.png', '*.jpg', '*.jpeg', '*.bmp'
]

let git: SimpleGit | null = null
let projectPath: string | null = null

export function getGit(): SimpleGit {
  if (!git) throw new Error('No project is open')
  return git
}

export function getProjectPath(): string {
  if (!projectPath) throw new Error('No project is open')
  return projectPath
}

export async function createProject(name: string, dirPath: string, remote: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
  await addSafeDirectory(dirPath)
  git = simpleGit(dirPath)
  projectPath = dirPath

  await git.raw(['config', '--global', 'init.defaultBranch', 'main'])
  await git.init()
  await git.raw(['lfs', 'install', '--local'])

  const gitattributes = LFS_PATTERNS.map(p => `${p} filter=lfs diff=lfs merge=lfs -text`).join('\n') + '\n'
  await fs.writeFile(path.join(dirPath, '.gitattributes'), gitattributes)

  const gitignore = [
    '~$*',
    '*.swp',
    '*.tmp',
    'Thumbs.db',
    '.DS_Store',
    ''
  ].join('\n')
  await fs.writeFile(path.join(dirPath, '.gitignore'), gitignore)

  // Only seed parts.json on a fresh project — never overwrite an existing
  // manifest, which could destroy a partial reservation list
  const partsPath = path.join(dirPath, 'parts.json')
  const partsExists = await fs.stat(partsPath).then(() => true).catch(() => false)
  if (!partsExists) {
    const emptyManifest: PartsManifest = {
      prefix: `${new Date().getFullYear().toString().slice(-2)}-2129`,
      nextCounters: {},
      nextAssemblyCounters: {},
      entries: {},
      assemblies: {}
    }
    await fs.writeFile(partsPath, JSON.stringify(emptyManifest, null, 2) + '\n')
  }

  await git.add(['.gitattributes', '.gitignore', 'parts.json'])
  // Commit may throw "nothing to commit" if create-project is re-run on an
  // already-initialised repo — treat that as success
  try {
    await git.commit('Initialize TrentCAD project')
  } catch { /* nothing to commit */ }

  if (remote) {
    // Idempotent: add origin if missing, update its URL if it already
    // exists with a different value. Without this, retrying create-project
    // fails with "remote origin already exists".
    const remotes = await git.getRemotes(true)
    const origin = remotes.find(r => r.name === 'origin')
    if (!origin) {
      await git.addRemote('origin', remote)
    } else if (origin.refs.push !== remote && origin.refs.fetch !== remote) {
      await git.remote(['set-url', 'origin', remote])
    }
    await git.push(['--set-upstream', 'origin', 'main'])
  }
}

export async function joinProject(url: string, dirPath: string): Promise<void> {
  await addSafeDirectory(dirPath)
  git = simpleGit()
  git.env('GIT_CLONE_PROTECTION_ACTIVE', 'false')
  await git.clone(url, dirPath)
  git = simpleGit(dirPath)
  projectPath = dirPath
}

async function addSafeDirectory(dirPath: string): Promise<void> {
  const normalized = dirPath.replace(/\\/g, '/')
  try {
    const g = simpleGit()
    await g.raw(['config', '--global', '--get-all', 'safe.directory']).then(result => {
      const dirs = result.trim().split('\n')
      if (dirs.includes(normalized) || dirs.includes('*')) return
      return g.raw(['config', '--global', '--add', 'safe.directory', normalized])
    })
  } catch {
    const g = simpleGit()
    await g.raw(['config', '--global', '--add', 'safe.directory', normalized])
  }
}

export async function openProject(dirPath: string): Promise<void> {
  await addSafeDirectory(dirPath)
  git = simpleGit(dirPath)
  projectPath = dirPath

  const isRepo = await git.checkIsRepo()
  if (!isRepo) throw new Error('Not a Git repository')
}

export async function sync(): Promise<SyncResult> {
  const g = getGit()
  try {
    const before = await g.log({ maxCount: 1 })
    await g.pull(['--rebase'])
    const after = await g.log({ maxCount: 1 })

    const filesUpdated = before.latest?.hash !== after.latest?.hash
      ? (await g.diffSummary([before.latest!.hash, after.latest!.hash])).changed
      : 0

    return { success: true, filesUpdated }
  } catch (err: unknown) {
    return { success: false, filesUpdated: 0, error: (err as Error).message }
  }
}

// Engineering, robotics, and architecture vocabulary used when an upload
// is submitted with an empty message. Three picks from this list form a
// human-memorable label like "torque truss flywheel" or "scaffold lidar
// spline".
const RANDOM_WORDS = [
  'actuator', 'anchor', 'arch', 'archway', 'armature', 'atrium',
  'autonomy', 'axle', 'balcony', 'balustrade', 'beam', 'bearing',
  'blueprint', 'bolt', 'brace', 'bracket', 'buttress', 'cam',
  'cantilever', 'capital', 'capstan', 'caster', 'chamfer', 'chassis',
  'clamp', 'claw', 'clutch', 'column', 'controller', 'cornice',
  'coupling', 'crank', 'cupola', 'dashboard', 'dome', 'dormer',
  'drivetrain', 'eave', 'encoder', 'facade', 'fastener', 'fillet',
  'flange', 'flywheel', 'foundation', 'frieze', 'fulcrum', 'gable',
  'gasket', 'gear', 'girder', 'gripper', 'gusset', 'gyro', 'hinge',
  'hub', 'hydraulic', 'impeller', 'intake', 'joist', 'journal',
  'keystone', 'kinematic', 'lattice', 'lever', 'lidar', 'linkage',
  'lintel', 'lug', 'manifold', 'manipulator', 'mezzanine', 'motor',
  'mullion', 'nut', 'obelisk', 'parapet', 'payload', 'pediment',
  'pier', 'pillar', 'pinion', 'piston', 'pivot', 'pneumatic',
  'portico', 'pulley', 'quadrant', 'rafter', 'ratchet', 'ridge',
  'rivet', 'robot', 'rotor', 'rotunda', 'scaffold', 'screw',
  'sensor', 'servo', 'shaft', 'shim', 'shooter', 'socket',
  'solenoid', 'span', 'spire', 'spline', 'spring', 'sprocket',
  'strut', 'suspension', 'swerve', 'telemetry', 'terrace', 'throttle',
  'torque', 'transom', 'truss', 'turbine', 'valve', 'vault',
  'vector', 'vernier', 'vision', 'washer', 'waveform', 'wedge',
  'wheel', 'winch', 'yoke'
]

function randomCommitMessage(): string {
  const pick = () => RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)]
  return `${pick()} ${pick()} ${pick()}`
}

export async function publish(
  message: string,
  onProgress?: (p: PublishProgress) => void
): Promise<PublishResult> {
  const g = getGit()
  try {
    await syncManifest()

    const status = await g.status()
    if (status.files.length === 0) {
      return { success: false, error: 'No changes to upload' }
    }

    const files = status.files.map(f => f.path)
    onProgress?.({ phase: 'preparing', files, detail: 'Preparing upload' })

    // Pre-flight size check: warn if any file is over GitHub's 100 MB
    // non-LFS limit. SolidWorks files are LFS-tracked via .gitattributes,
    // so this mostly catches accidental non-LFS additions or files that
    // slipped through the LFS net.
    const projectDir = getProjectPath()
    const sizes = await Promise.all(
      files.map(async f => {
        try {
          const stat = await fs.stat(path.join(projectDir, f))
          return { path: f, size: stat.size }
        } catch {
          return { path: f, size: 0 }
        }
      })
    )
    const oversized = sizes.filter(s => s.size > 100 * 1024 * 1024)
    if (oversized.length > 0) {
      const summary = oversized.map(s => `${s.path} (${(s.size / 1024 / 1024).toFixed(0)} MB)`).join(', ')
      onProgress?.({
        phase: 'preparing',
        files,
        detail: `Large files detected (>100 MB) — may upload slowly or be rejected: ${summary}`
      })
    }

    const finalMessage = (message ?? '').trim() || randomCommitMessage()
    await g.raw(['add', '-A'])
    const result = await g.commit(finalMessage)

    onProgress?.({ phase: 'uploading', files, percent: 0, detail: 'Uploading to GitHub' })

    // Fresh SimpleGit instance with a progress callback so simple-git
    // surfaces git's own --progress lines as structured events. Falls back
    // to a simple "uploading" status if the underlying git doesn't stream
    // progress.
    const pushGit = simpleGit(getProjectPath(), {
      progress: ({ method, stage, progress }) => {
        if (method === 'push' && onProgress) {
          onProgress({
            phase: 'uploading',
            files,
            percent: typeof progress === 'number' ? progress : undefined,
            detail: stage
          })
        }
      }
    })

    // Also parse stderr for git-lfs lines like "Uploading LFS objects: 50% (1/2)..."
    pushGit.outputHandler((_bin, _stdout, stderr) => {
      stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const lfs = text.match(/Uploading LFS objects:\s+(\d+)%\s+\((\d+)\/(\d+)\)/)
        if (lfs && onProgress) {
          onProgress({
            phase: 'uploading',
            files,
            percent: parseInt(lfs[1], 10),
            detail: `LFS ${lfs[2]} of ${lfs[3]} uploaded`
          })
        }
      })
    })

    await pushGit.push()

    onProgress?.({ phase: 'done', files, percent: 100, detail: 'Upload complete' })
    return { success: true, hash: result.commit }
  } catch (err: unknown) {
    const errMsg = (err as Error).message
    onProgress?.({ phase: 'error', error: errMsg })
    return { success: false, error: errMsg }
  }
}

const COTS_DIR = 'COTS'

export async function setMainRemoteUrl(url: string): Promise<void> {
  const g = getGit()
  const remotes = await g.getRemotes(true)
  const origin = remotes.find(r => r.name === 'origin')
  if (origin) {
    await g.remote(['set-url', 'origin', url])
  } else {
    await g.remote(['add', 'origin', url])
  }
}

async function ensureCotsGitignored(): Promise<void> {
  const ignorePath = path.join(getProjectPath(), '.gitignore')
  let existing = ''
  try { existing = await fs.readFile(ignorePath, 'utf-8') } catch { /* missing */ }
  if (existing.split('\n').some(line => line.trim() === COTS_DIR || line.trim() === COTS_DIR + '/')) return
  const updated = (existing.endsWith('\n') || existing === '' ? existing : existing + '\n') + COTS_DIR + '/\n'
  await fs.writeFile(ignorePath, updated)
}

export async function syncCotsRepo(repoUrl: string, branch?: string): Promise<{ success: boolean; cloned?: boolean; error?: string }> {
  if (!repoUrl) return { success: false, error: 'No COTS repo URL configured' }
  const projectDir = getProjectPath()
  const cotsDir = path.join(projectDir, COTS_DIR)
  await ensureCotsGitignored()
  try {
    const exists = await fs.stat(cotsDir).then(() => true).catch(() => false)
    if (!exists) {
      // Clone fresh
      const args = ['clone']
      if (branch) args.push('-b', branch)
      args.push(repoUrl, COTS_DIR)
      await simpleGit(projectDir).raw(args)
      return { success: true, cloned: true }
    }
    // Pull latest. Use a SimpleGit instance scoped to the COTS folder.
    const cotsGit = simpleGit(cotsDir)
    await cotsGit.fetch('origin')
    if (branch) {
      await cotsGit.raw(['checkout', branch])
    }
    await cotsGit.pull(['--ff-only'])
    return { success: true, cloned: false }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

async function getCurrentBranch(g: SimpleGit): Promise<string> {
  try {
    const r = await g.revparse(['--abbrev-ref', 'HEAD'])
    const branch = r.trim()
    return branch && branch !== 'HEAD' ? branch : 'main'
  } catch {
    return 'main'
  }
}

export async function pullPartsJson(): Promise<void> {
  const g = getGit()
  try {
    const remotes = await g.getRemotes(false)
    if (remotes.length === 0) return
    await g.fetch('origin')
    // Skip if local has uncommitted parts.json — we'd overwrite the user's
    // pending reservation
    const status = await g.status()
    if (status.files.some(f => f.path === 'parts.json')) return
    const branch = await getCurrentBranch(g)
    try {
      await g.raw(['checkout', `origin/${branch}`, '--', 'parts.json'])
    } catch {
      // parts.json may not exist on remote yet — ignore
    }
  } catch {
    // network failure, no remote — proceed with local state
  }
}

export async function pushPartsJson(reservationLabel: string): Promise<void> {
  const g = getGit()
  const remotes = await g.getRemotes(false)
  if (remotes.length === 0) return

  await g.raw(['add', 'parts.json'])
  const status = await g.status()
  if (!status.files.some(f => f.path === 'parts.json')) return

  await g.commit(`Reserve ${reservationLabel}`)
  try {
    await g.push()
  } catch (err) {
    // Push failed — most likely another teammate reserved at the same time.
    // Undo the commit but keep parts.json on disk untouched so caller can
    // decide what to do.
    await g.raw(['reset', '--soft', 'HEAD~1'])
    await g.raw(['reset', '--', 'parts.json'])
    throw new Error('Could not sync part number to team — someone else may have reserved at the same time. Sync and try again.')
  }
}

export async function getStatus(): Promise<FileEntry[]> {
  const g = getGit()
  const dirPath = getProjectPath()
  const status = await g.status()
  const locks = await getLocks()

  const lockMap = new Map(locks.map(l => [l.path, l]))

  const gitUsername = (await g.getConfig('user.name')).value || ''

  async function buildTree(dir: string, relativeTo: string): Promise<FileEntry[]> {
    const entries: FileEntry[] = []
    let items: string[]
    try {
      items = await fs.readdir(dir)
    } catch {
      return entries
    }

    for (const item of items) {
      // Hide system / dotfiles and the parts manifest from the browser so
      // students don't see (or accidentally edit) the metadata layer
      if (item.startsWith('.') || item === 'parts.json') continue

      const fullPath = path.join(dir, item)
      const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/')

      const stat = await fs.stat(fullPath).catch(() => null)
      if (!stat) continue

      const isDirectory = stat.isDirectory()
      let state: FileState = 'synced'
      let lockedBy: string | undefined

      if (!isDirectory) {
        const statusFile = status.files.find(f => f.path === relPath)
        if (statusFile) {
          if (statusFile.index === '?' || statusFile.working_dir === '?') {
            state = 'untracked'
          } else {
            state = 'modified'
          }
        }

        const lock = lockMap.get(relPath)
        if (lock) {
          lockedBy = lock.owner
          state = lock.owner === gitUsername ? 'locked-by-you' : 'locked-by-other'
        }
      }

      const entry: FileEntry = {
        path: relPath,
        name: item,
        isDirectory,
        state,
        lockedBy,
        children: isDirectory ? await buildTree(fullPath, relativeTo) : undefined
      }

      entries.push(entry)
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return entries
  }

  const result = await buildTree(dirPath, dirPath)
  try {
    const manifest = await loadManifest()
    annotatePartNumbers(result, manifest)
  } catch {
    // parts.json may not exist yet for joined/legacy projects
  }
  return result
}

export async function getGitIdentity(): Promise<{ name: string; email: string }> {
  const g = simpleGit()
  const name = (await g.getConfig('user.name')).value || ''
  const email = (await g.getConfig('user.email')).value || ''
  return { name, email }
}

export async function setGitIdentity(name: string, email: string): Promise<void> {
  const g = simpleGit()
  await g.addConfig('user.name', name, false, 'global')
  await g.addConfig('user.email', email, false, 'global')
}

export async function getHistory(limit = 50): Promise<HistoryEntry[]> {
  const g = getGit()
  try {
    const log = await g.log({ maxCount: limit, '--stat': null })
    return log.all.map(entry => ({
      hash: entry.hash.slice(0, 8),
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
      files: (entry.diff?.files || []).map(f => f.file)
    }))
  } catch {
    return []
  }
}
