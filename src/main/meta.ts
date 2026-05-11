import path from 'path'
import fs from 'fs/promises'
import type { PartMeta, ProjectTotals, ReleaseState } from '@shared/types'
import { getProjectPath, getGit, pullRemoteFile, commitAndPushFile } from './git'

const META_DIR = '.trentcad'
const META_FILE = 'parts-meta.json'

interface PartsMetaFile { [relPath: string]: PartMeta }

function metaAbsPath(): string {
  return path.join(getProjectPath(), META_DIR, META_FILE)
}

function metaRelPath(): string {
  return `${META_DIR}/${META_FILE}`
}

export async function loadAllMeta(): Promise<PartsMetaFile> {
  try {
    const raw = await fs.readFile(metaAbsPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function saveAllMeta(meta: PartsMetaFile): Promise<void> {
  const full = metaAbsPath()
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, JSON.stringify(meta, null, 2) + '\n')
}

async function gitUsername(): Promise<string> {
  try {
    const value = (await getGit().getConfig('user.name')).value
    return value || 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function getPartMeta(filePath: string): Promise<PartMeta> {
  const all = await loadAllMeta()
  return all[filePath] || {}
}

async function modifyAndSync(
  filePath: string,
  mutator: (entry: PartMeta) => void,
  commitMessage: string
): Promise<void> {
  await pullRemoteFile(metaRelPath())
  const all = await loadAllMeta()
  const entry = all[filePath] || {}
  mutator(entry)
  all[filePath] = entry
  await saveAllMeta(all)
  try {
    await commitAndPushFile(metaRelPath(), commitMessage)
  } catch (err) {
    // Roll back the in-memory write so a retry sees the upstream state
    // again (caller will re-pull on next attempt via modifyAndSync).
    throw err
  }
}

export async function setReleaseState(
  filePath: string,
  state: ReleaseState,
  note?: string
): Promise<void> {
  const by = await gitUsername()
  await modifyAndSync(
    filePath,
    entry => {
      entry.release = {
        state,
        by,
        at: new Date().toISOString(),
        note: note?.trim() || undefined
      }
    },
    `[release] ${path.basename(filePath, path.extname(filePath))} → ${state}`
  )
}

export async function addComment(filePath: string, text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Comment cannot be empty')
  const author = await gitUsername()
  await modifyAndSync(
    filePath,
    entry => {
      if (!entry.comments) entry.comments = []
      entry.comments.push({
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author,
        text: trimmed,
        at: new Date().toISOString()
      })
    },
    `[comment] ${path.basename(filePath)}: ${trimmed.slice(0, 40)}`
  )
}

export async function setManufacturingNotes(filePath: string, notes: string): Promise<void> {
  await modifyAndSync(
    filePath,
    entry => { entry.manufacturingNotes = notes },
    `[mfg-notes] ${path.basename(filePath)}`
  )
}

export async function setPartMass(filePath: string, mass: number | null): Promise<void> {
  if (mass !== null && (!isFinite(mass) || mass < 0)) {
    throw new Error('Mass must be a non-negative number')
  }
  await modifyAndSync(
    filePath,
    entry => {
      if (mass === null) delete entry.mass
      else entry.mass = mass
    },
    `[mass] ${path.basename(filePath)} = ${mass === null ? 'cleared' : `${mass} lb`}`
  )
}

export async function setPartCost(filePath: string, cost: number | null): Promise<void> {
  if (cost !== null && (!isFinite(cost) || cost < 0)) {
    throw new Error('Cost must be a non-negative number')
  }
  await modifyAndSync(
    filePath,
    entry => {
      if (cost === null) delete entry.cost
      else entry.cost = cost
    },
    `[cost] ${path.basename(filePath)} = ${cost === null ? 'cleared' : `$${cost}`}`
  )
}

/**
 * Sum mass and cost across every entry in parts-meta.json. Counts also
 * how many entries have each field populated so the UI can show
 * "(based on N of M parts)".
 */
export async function getProjectTotals(): Promise<ProjectTotals> {
  const all = await loadAllMeta()
  const totals: ProjectTotals = { mass: 0, cost: 0, partsWithMass: 0, partsWithCost: 0, totalParts: 0 }
  for (const key of Object.keys(all)) {
    totals.totalParts++
    const entry = all[key]
    if (typeof entry.mass === 'number' && entry.mass > 0) {
      totals.mass += entry.mass
      totals.partsWithMass++
    }
    if (typeof entry.cost === 'number' && entry.cost > 0) {
      totals.cost += entry.cost
      totals.partsWithCost++
    }
  }
  return totals
}

/**
 * Walk a FileEntry tree and stamp each entry with release state + comment
 * count from the in-memory meta map. Mirrors annotatePartNumbers in parts.ts.
 */
export function annotateMeta(
  entries: Array<{ path: string; isDirectory: boolean; children?: unknown[]; releaseState?: ReleaseState; commentCount?: number }>,
  meta: PartsMetaFile
): void {
  for (const entry of entries) {
    if (!entry.isDirectory) {
      const m = meta[entry.path]
      if (m?.release?.state) entry.releaseState = m.release.state
      if (m?.comments?.length) entry.commentCount = m.comments.length
    }
    if (entry.children) {
      annotateMeta(entry.children as typeof entries, meta)
    }
  }
}
