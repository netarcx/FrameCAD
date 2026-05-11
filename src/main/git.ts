import simpleGit, { SimpleGit } from 'simple-git'
import path from 'path'
import fs from 'fs/promises'
import type { FileEntry, FileState, HistoryEntry, PartsManifest, PublishProgress, PublishResult, SyncResult } from '@shared/types'
import { getLocks } from './locking'
import { loadManifest, syncManifest, annotatePartNumbers } from './parts'
import { loadAllMeta, annotateMeta } from './meta'

// Large binary or text-based CAD files that go through Git LFS. `-text` keeps
// git from running line-ending conversion on the file; `merge=lfs` uses the
// LFS merge driver which conflicts on any divergent pointer instead of
// attempting a content merge.
const LFS_PATTERNS = [
  // SolidWorks
  '*.sldprt', '*.SLDPRT',
  '*.sldasm', '*.SLDASM',
  '*.slddrw', '*.SLDDRW',
  '*.sldlfp', '*.SLDLFP',
  // CAD interchange
  '*.step', '*.STEP', '*.stp', '*.STP',
  '*.iges', '*.IGES', '*.igs', '*.IGS',
  '*.stl', '*.STL',
  '*.3dxml', '*.3DXML',
  '*.dwg', '*.DWG',
  '*.dxf', '*.DXF',
  '*.obj', '*.OBJ',
  '*.x_t', '*.X_T', '*.x_b', '*.X_B',
  // Documents and images that CAD users tend to commit alongside their parts
  '*.pdf', '*.PDF',
  '*.png', '*.PNG', '*.jpg', '*.JPG', '*.jpeg', '*.JPEG', '*.bmp', '*.BMP',
  // Archives + installers. These DON'T really belong in a CAD repo, but
  // teams regularly Pack-and-Go into a zip or drop a CacheCAD installer
  // alongside their files. Without LFS coverage these silently exceed
  // GitHub's 100 MB per-file hard limit and the whole push gets rejected
  // (pre-receive hook declined). LFS them defensively so a stray drop
  // doesn't nuke a 3+ GB publish.
  '*.zip', '*.ZIP',
  '*.rar', '*.RAR',
  '*.7z', '*.7Z',
  '*.tar', '*.TAR',
  '*.gz', '*.GZ',
  '*.exe', '*.EXE',
  '*.msi', '*.MSI'
]

// Smaller text-format CAD/SolidWorks files that should NEVER be merged
// line-by-line. The `binary` macro expands to `-text -diff -merge` — git
// disables its text merge and surfaces a conflict instead of mangling the
// file's structure.
const NEVER_MERGE_PATTERNS = [
  '*.swstate', '*.SWSTATE',
  '*.swsettings', '*.SWSETTINGS',
  '*.swproj', '*.SWPROJ',
  '*.slddst', '*.SLDDST',
  '*.sldset', '*.SLDSET',
  '*.sldsymb', '*.SLDSYMB',
  '*.scad', '*.SCAD',
  '*.gcode', '*.GCODE'
]

function buildGitAttributes(): string {
  const lines: string[] = ['# Managed by TrentCAD — adds run by openProject if missing.']
  for (const p of LFS_PATTERNS) lines.push(`${p} filter=lfs diff=lfs merge=lfs -text`)
  for (const p of NEVER_MERGE_PATTERNS) lines.push(`${p} binary`)
  return lines.join('\n') + '\n'
}

/**
 * Ensure every CAD-related pattern TrentCAD knows about is present in
 * .gitattributes. Adds missing lines without rewriting any custom rules
 * the user added. Returns true if the file was modified.
 */
export async function ensureGitAttributes(): Promise<boolean> {
  const filePath = path.join(getProjectPath(), '.gitattributes')
  let existing = ''
  try { existing = await fs.readFile(filePath, 'utf-8') } catch { /* missing */ }
  const expected = buildGitAttributes()
  const existingLines = new Set(existing.split('\n').map(s => s.trim()))
  const missing: string[] = []
  for (const line of expected.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    if (!existingLines.has(t)) missing.push(line)
  }
  if (missing.length === 0) return false
  const updated = (existing === '' || existing.endsWith('\n') ? existing : existing + '\n') + missing.join('\n') + '\n'
  await fs.writeFile(filePath, updated)
  return true
}

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
  // Pre-trust the parent too: a stale .git from a prior failed attempt
  // there will otherwise trip git's worktree-discovery ownership check
  // before init has a chance to take over.
  await addSafeDirectory(path.dirname(dirPath))
  git = simpleGit(dirPath)
  projectPath = dirPath

  await withDubiousOwnershipRecovery(async () => {
    await git.raw(['config', '--global', 'init.defaultBranch', 'main'])
    await git.init()
    await git.raw(['lfs', 'install', '--local'])
  })
  await applyUploadTunings()

  await fs.writeFile(path.join(dirPath, '.gitattributes'), buildGitAttributes())

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

  await withDubiousOwnershipRecovery(async () => {
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
  })
}

export async function joinProject(url: string, dirPath: string): Promise<void> {
  await addSafeDirectory(dirPath)
  await addSafeDirectory(path.dirname(dirPath))
  await withDubiousOwnershipRecovery(async () => {
    git = simpleGit()
    git.env('GIT_CLONE_PROTECTION_ACTIVE', 'false')
    await git.clone(url, dirPath)
    git = simpleGit(dirPath)
    projectPath = dirPath
  })
  await applyUploadTunings()
}

/**
 * Apply the upload-tuning git config to the current repo. These are
 * cheap one-time writes to .git/config that survive across pulls and
 * pushes; running every open is fine and idempotent.
 *
 * - lfs.concurrenttransfers 12 — git's default is 8; bumping to 12 helps
 *   multi-file CAD publishes saturate the connection. Higher than ~16
 *   tends to choke residential up-links.
 * - http.postBuffer 500 MB — large CAD pushes occasionally trip git's
 *   default ~1 MB stream buffer and fail mid-push with HTTP 500. The
 *   buffer only allocates as needed; it doesn't waste 500 MB up front.
 * - lfs.activitytimeout 600 — give a slow chunk 10 minutes before
 *   declaring the upload dead, instead of the default 30s.
 * - lfs.dialtimeout 30 — wait 30s for the initial TLS handshake to
 *   github-lfs.s3 instead of failing fast on a slow link.
 */
async function applyUploadTunings(): Promise<void> {
  const g = getGit()
  await Promise.all([
    g.raw(['config', '--local', 'lfs.concurrenttransfers', '12']).catch(() => {}),
    g.raw(['config', '--local', 'http.postBuffer', '524288000']).catch(() => {}),
    g.raw(['config', '--local', 'lfs.activitytimeout', '600']).catch(() => {}),
    g.raw(['config', '--local', 'lfs.dialtimeout', '30']).catch(() => {})
  ])
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

/**
 * Run a git operation; if it fails with "dubious ownership in repository
 * at 'PATH'", auto-add that exact PATH to safe.directory and retry once.
 * Network drives (FRC team shared volumes like G:\) don't record POSIX
 * ownership, so git refuses operations whenever it walks up and finds a
 * .git the current user doesn't appear to own. Pre-registering only the
 * target dir doesn't help when git's worktree-discovery hits a parent
 * with a stale .git from a prior attempt — so we recover by parsing the
 * actual path out of git's complaint.
 */
async function withDubiousOwnershipRecovery<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const msg = (err as Error).message || ''
    const m = msg.match(/detected dubious ownership in repository at ['"]?([^'"\n]+?)['"]?\s*(?:$|\n)/)
    if (!m) throw err
    const dubious = m[1].replace(/\\/g, '/')
    const g = simpleGit()
    await g.raw(['config', '--global', '--add', 'safe.directory', dubious])
    return fn()
  }
}

export async function openProject(dirPath: string): Promise<void> {
  await addSafeDirectory(dirPath)
  await addSafeDirectory(path.dirname(dirPath))
  await withDubiousOwnershipRecovery(async () => {
    git = simpleGit(dirPath)
    projectPath = dirPath

    const isRepo = await git.checkIsRepo()
    if (!isRepo) throw new Error('Not a Git repository')

    // Auto-add any new CAD patterns introduced by a newer TrentCAD version
    // so files added today never get the default text-merge treatment
    await ensureGitAttributes().catch(() => { /* best-effort */ })
  })
  await applyUploadTunings()
}

export async function createProgressTag(
  name: string,
  message?: string
): Promise<{ success: boolean; error?: string }> {
  const g = getGit()
  const trimmed = (name || '').trim()
  if (!trimmed) return { success: false, error: 'Tag name is required' }
  if (/\s/.test(trimmed) || /[~^:?*\[\]\\]/.test(trimmed)) {
    return { success: false, error: 'Tag name cannot contain spaces or any of ~^:?*[]\\' }
  }
  try {
    await g.addAnnotatedTag(trimmed, message || `Weekly progress: ${trimmed}`)
    const remotes = await g.getRemotes(false)
    if (remotes.length > 0) {
      try { await g.pushTags() } catch (err) {
        return { success: false, error: 'Tag created locally but push failed: ' + (err as Error).message }
      }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export async function sync(): Promise<SyncResult> {
  const g = getGit()
  try {
    const before = await g.log({ maxCount: 1 })

    // CAD students often have unsaved or just-saved local changes when
    // they hit Download. Git rebase refuses to run with a dirty tree
    // ("cannot pull with rebase: You have unstaged changes"). Stash
    // around the pull and pop afterwards so the workflow Just Works.
    // The stash includes untracked files (--include-untracked) so a
    // brand-new .sldprt isn't left out.
    const status = await g.status()
    const dirty = status.files.length > 0
    const stashLabel = `trentcad-sync-${Date.now()}`
    let stashed = false

    if (dirty) {
      try {
        await g.raw(['stash', 'push', '--include-untracked', '-m', stashLabel])
        stashed = true
      } catch (stashErr) {
        // If we can't stash (rare — usually permissions), surface a
        // clear actionable error instead of git's cryptic rebase message
        return {
          success: false,
          filesUpdated: 0,
          error: 'Could not stash local changes before sync: ' + (stashErr as Error).message
        }
      }
    }

    let pullErr: Error | null = null
    try {
      await g.pull(['--rebase'])
    } catch (err) {
      pullErr = err as Error
    }

    if (stashed) {
      // Pop regardless of whether the pull succeeded — restore the
      // user's working tree to its pre-sync state on failure, and on
      // success let the popped changes ride forward
      try {
        await g.raw(['stash', 'pop'])
      } catch (popErr) {
        // Pop conflicted (incoming changes touched the same files the
        // user had edited locally). The stash stays in `git stash list`
        // for them to resolve. Surface this clearly.
        return {
          success: false,
          filesUpdated: 0,
          error:
            'Sync downloaded teammates\' changes, but your local edits ' +
            'conflicted with theirs. Your work is safe in `git stash` ' +
            '(label "' + stashLabel + '") — resolve the conflicts and run ' +
            '`git stash pop` manually, then Publish. (' + (popErr as Error).message + ')'
        }
      }
    }

    if (pullErr) {
      return { success: false, filesUpdated: 0, error: pullErr.message }
    }

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

    // Pre-flight: any file over 50 MB that is NOT LFS-tracked will trip
    // GitHub's 100 MB hard limit (warned at 50 MB) and get the whole push
    // rejected by the pre-receive hook AFTER the LFS portion finishes —
    // wasting potentially gigabytes of upload time. Catch them up front
    // and abort with an actionable error instead.
    //
    // Critically, we check BOTH the current working-tree changes (what's
    // about to be staged) AND any files in commits already pending on
    // origin (e.g. a previous publish that failed to push left a local
    // commit; without this we'd happily push that bad commit on top of
    // new work).
    const projectDir = getProjectPath()
    const WARN_BYTES = 50 * 1024 * 1024

    const candidatePaths = new Set<string>(files)
    try {
      const branchSummary = await g.branchLocal()
      const branch = branchSummary.current || 'main'
      // Files changed in any local-ahead-of-origin commit (won't error
      // if origin/<branch> doesn't exist — we just skip this scan)
      const pendingFiles = await g.raw(['diff', '--name-only', `origin/${branch}..HEAD`])
        .catch(() => '')
      for (const line of pendingFiles.split('\n')) {
        const p = line.trim()
        if (p) candidatePaths.add(p)
      }
    } catch { /* best-effort */ }

    const sizes = await Promise.all(
      [...candidatePaths].map(async f => {
        try {
          const stat = await fs.stat(path.join(projectDir, f))
          return { path: f, size: stat.size }
        } catch {
          return { path: f, size: 0 }
        }
      })
    )
    const largeCandidates = sizes.filter(s => s.size > WARN_BYTES)
    if (largeCandidates.length > 0) {
      // Batch one `git check-attr filter -- <path>...` to learn which of
      // the large files are LFS-tracked. Anything matching .gitattributes'
      // `filter=lfs` is fine at any size up to LFS's 5 GB cap; everything
      // else is going through regular git and will fail.
      const checkOut = await g.raw([
        'check-attr', 'filter', '--',
        ...largeCandidates.map(s => s.path)
      ])
      const lfsPaths = new Set<string>()
      for (const line of checkOut.split('\n')) {
        const m = line.match(/^(.+):\s*filter:\s*lfs\s*$/)
        if (m) lfsPaths.add(m[1].trim())
      }
      const blockers = largeCandidates.filter(s => !lfsPaths.has(s.path))
      if (blockers.length > 0) {
        const list = blockers.map(s =>
          `  - ${s.path} (${(s.size / 1024 / 1024).toFixed(0)} MB)`
        ).join('\n')
        const msg =
          `${blockers.length} file(s) over 50 MB aren't tracked by Git LFS — ` +
          `GitHub will reject the push for any of these over 100 MB:\n\n${list}\n\n` +
          `Fix: either delete these files (installers and large zips usually ` +
          `don't belong in a CAD repo), or add the extension to .gitattributes ` +
          `and re-stage them. TrentCAD now LFS-tracks zip/rar/7z/tar/gz/exe/msi ` +
          `out of the box, so this should auto-resolve on new projects.`
        onProgress?.({ phase: 'error', error: msg })
        return { success: false, error: msg }
      }
    }

    const finalMessage = (message ?? '').trim() || randomCommitMessage()

    // Split the push into two commits by FILE SIZE, not by .gitattributes
    // pattern. Most CAD files (.sldprt under 50 MB) match the LFS
    // pattern but their LFS objects are small and upload in milliseconds
    // — there's no value in isolating them from the metadata push.
    // The real value of splitting is isolating the FEW files large
    // enough to fail a slow upload: a single 200 MB .sldasm timing out
    // shouldn't take down the publish of 200 small parts + the
    // parts.json + the build-season docs.
    //
    // Threshold: 50 MB matches GitHub's "recommended max" warning. Files
    // at or under it go to phase 1 (small files + metadata, fast push,
    // small LFS objects ride along); files above it go to phase 2 (the
    // slow few). Deleted files (size 0 because they're missing from
    // disk) always end up in phase 1.
    const SPLIT_BYTES = 50 * 1024 * 1024
    const fileSizes = await Promise.all(files.map(async f => {
      try {
        const stat = await fs.stat(path.join(projectDir, f))
        return { path: f, size: stat.size }
      } catch {
        return { path: f, size: 0 }
      }
    }))
    const phase1Files = fileSizes.filter(s => s.size <= SPLIT_BYTES).map(s => s.path)
    const phase2Files = fileSizes.filter(s => s.size > SPLIT_BYTES).map(s => s.path)
    const willSplit = phase1Files.length > 0 && phase2Files.length > 0

    // The renderer's progress modal shows `N files in this upload` based
    // on `files` in the progress event. We always send the FULL file
    // list (across both phases) so that count is stable and accurate;
    // the per-phase detail string distinguishes which phase is running.
    const buildPushGit = () => {
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
      return pushGit
    }

    /**
     * Stage the given paths, commit with the given message, push.
     * On push failure, roll back the just-made commit (--soft so the
     * files stay staged for retry) and throw so the outer catch
     * surfaces the error. Already-pushed earlier-phase commits are
     * NOT touched — they succeeded and the user benefits from that
     * partial progress.
     */
    const runPhase = async (
      phaseFiles: string[],
      phaseMessage: string,
      detailLabel: string
    ): Promise<string | null> => {
      if (phaseFiles.length === 0) return null
      // git add doesn't accept too many args at once on Windows command
      // lines (cmd.exe caps argv at ~8 KB). Chunk in batches of 200 paths.
      const CHUNK = 200
      for (let i = 0; i < phaseFiles.length; i += CHUNK) {
        await g.raw(['add', '--', ...phaseFiles.slice(i, i + CHUNK)])
      }

      // Staging may have produced an empty diff (e.g. files reverted in
      // the working tree but still listed in status; or staged-then-
      // unmodified; or every file was already in the index from an
      // earlier failed publish). git commit would throw "nothing to
      // commit" — treat as a successful no-op for this phase and skip
      // the push. Critical so a metadata-only phase 1 doesn't blow up
      // the LFS phase on a retry where only LFS changes remain.
      const statusAfter = await g.status()
      if (statusAfter.staged.length === 0 && !statusAfter.files.some(f =>
        phaseFiles.includes(f.path) && (f.index === 'A' || f.index === 'M' || f.index === 'D' || f.index === 'R')
      )) {
        return null
      }

      let commitResult
      try {
        commitResult = await g.commit(phaseMessage)
      } catch (commitErr) {
        const m = (commitErr as Error).message || ''
        // "nothing to commit" / "no changes added" — benign, skip push
        if (/nothing to commit|no changes added/i.test(m)) return null
        throw commitErr
      }

      onProgress?.({ phase: 'uploading', files, percent: 0, detail: detailLabel })
      const pushGit = buildPushGit()
      try {
        await pushGit.push()
      } catch (pushErr) {
        try { await g.raw(['reset', '--soft', 'HEAD~1']) } catch { /* best-effort */ }
        throw pushErr
      }
      return commitResult.commit
    }

    const phase1Msg = willSplit ? `${finalMessage} (part 1 of 2)` : finalMessage
    const phase2Msg = willSplit ? `${finalMessage} (part 2 of 2)` : finalMessage

    const phase1Hash = await runPhase(phase1Files, phase1Msg, willSplit
      ? `Uploading small files (1 of 2, ${phase1Files.length} files)`
      : 'Uploading to GitHub')

    const phase2Hash = await runPhase(phase2Files, phase2Msg, willSplit
      ? `Uploading large files (2 of 2, ${phase2Files.length} files)`
      : 'Uploading to GitHub')

    onProgress?.({ phase: 'done', files, percent: 100, detail: 'Upload complete' })
    return { success: true, hash: phase2Hash ?? phase1Hash ?? undefined }
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

/**
 * Best-effort pull of a single file from the upstream tracking branch so we
 * have the latest team state before modifying it locally. Skipped if local
 * has uncommitted changes to the same path (avoids overwriting in-flight
 * work) or if there's no remote configured.
 */
export async function pullRemoteFile(relPath: string): Promise<void> {
  const g = getGit()
  try {
    const remotes = await g.getRemotes(false)
    if (remotes.length === 0) return
    await g.fetch('origin')
    const status = await g.status()
    if (status.files.some(f => f.path === relPath)) return
    const branch = await getCurrentBranch(g)
    try {
      await g.raw(['checkout', `origin/${branch}`, '--', relPath])
    } catch { /* file may not exist on remote yet */ }
  } catch { /* network failure, no remote — proceed with local */ }
}

/**
 * Stage a single file, commit it with the given message, and push. If the
 * push fails the commit is unwound so the working tree is clean and the
 * caller can retry. Throws on push failure so the caller can surface the
 * error.
 */
export async function commitAndPushFile(relPath: string, message: string): Promise<void> {
  const g = getGit()
  const remotes = await g.getRemotes(false)
  await g.raw(['add', relPath])
  const status = await g.status()
  if (!status.files.some(f => f.path === relPath)) return
  await g.commit(message)
  if (remotes.length === 0) return
  try {
    await g.push()
  } catch (err) {
    await g.raw(['reset', '--soft', 'HEAD~1'])
    await g.raw(['reset', '--', relPath])
    throw new Error('Could not sync to team — ' + (err as Error).message)
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
  try {
    const meta = await loadAllMeta()
    annotateMeta(result, meta)
  } catch {
    // parts-meta.json may not exist
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
