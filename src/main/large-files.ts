import path from 'path'
import { promises as fs } from 'fs'
import { getGit, getProjectPath } from './git'

const SIZE_WARN_BYTES = 50 * 1024 * 1024   // 50 MB — GitHub's warning threshold
const SIZE_HARD_BYTES = 100 * 1024 * 1024  // 100 MB — GitHub's hard reject limit for non-LFS files
const SIZE_LFS_HARD_BYTES = 5 * 1024 * 1024 * 1024 // 5 GB — LFS per-object cap

/** Top-level folders to skip when walking the project tree. */
const SKIP_NAMES = new Set([
  '.git',          // git internals — never an issue
  'node_modules',  // (rare in a CAD repo, but defensive)
  'COTS'           // gitignored, separate repo
])

export type LargeFileStatus =
  | 'blocker'       // not LFS-tracked + over the 100 MB hard limit -> push WILL be rejected
  | 'warning'       // not LFS-tracked + 50-100 MB -> push warned by GitHub, may grow
  | 'ok-lfs'        // LFS-tracked, fine for any size up to 5 GB
  | 'lfs-too-large' // LFS-tracked but somehow over LFS's 5 GB per-object cap

export interface LargeFile {
  path: string         // project-relative, forward slashes
  absolutePath: string
  size: number
  isLfsTracked: boolean
  status: LargeFileStatus
}

async function walkForLargeFiles(
  projectDir: string,
  minBytes: number
): Promise<{ path: string; absolutePath: string; size: number }[]> {
  const out: { path: string; absolutePath: string; size: number }[] = []

  async function walk(dir: string): Promise<void> {
    let items: string[]
    try { items = await fs.readdir(dir) } catch { return }
    for (const item of items) {
      if (SKIP_NAMES.has(item)) continue
      const fullPath = path.join(dir, item)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (!stat) continue
      if (stat.isDirectory()) {
        await walk(fullPath)
      } else if (stat.size > minBytes) {
        const rel = path.relative(projectDir, fullPath).replace(/\\/g, '/')
        out.push({ path: rel, absolutePath: fullPath, size: stat.size })
      }
    }
  }
  await walk(projectDir)
  return out
}

/**
 * Find every file in the working tree over 50 MB and classify each by
 * whether it'll trip GitHub's pre-receive hook on the next publish.
 * Sorted biggest-first so the worst offenders surface immediately.
 */
export async function scanLargeFiles(): Promise<LargeFile[]> {
  const projectDir = getProjectPath()
  const big = await walkForLargeFiles(projectDir, SIZE_WARN_BYTES)
  if (big.length === 0) return []

  // One batched `git check-attr filter` tells us which paths are LFS-tracked
  let lfsPaths = new Set<string>()
  try {
    const g = getGit()
    const out = await g.raw([
      'check-attr', 'filter', '--',
      ...big.map(f => f.path)
    ])
    for (const line of out.split('\n')) {
      const m = line.match(/^(.+):\s*filter:\s*lfs\s*$/)
      if (m) lfsPaths.add(m[1].trim())
    }
  } catch {
    // Project might not be a git repo for some reason — treat everything
    // as not-LFS-tracked, which is the cautious answer
    lfsPaths = new Set()
  }

  const results: LargeFile[] = big.map(f => {
    const isLfs = lfsPaths.has(f.path)
    let status: LargeFileStatus
    if (isLfs && f.size > SIZE_LFS_HARD_BYTES) status = 'lfs-too-large'
    else if (isLfs) status = 'ok-lfs'
    else if (f.size > SIZE_HARD_BYTES) status = 'blocker'
    else status = 'warning'
    return { path: f.path, absolutePath: f.absolutePath, size: f.size, isLfsTracked: isLfs, status }
  })

  results.sort((a, b) => b.size - a.size)
  return results
}
