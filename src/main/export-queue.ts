/**
 * Pending CAM-export queue for the SolidWorks add-in.
 *
 * When FrameCAD releases a CNC/3D-print part, it enqueues an export
 * task here. The SW add-in polls /api/pending-exports, performs the
 * SaveAs in SolidWorks (opening the doc silently if it isn't already
 * active), and posts /done. The done handler stages and commits the
 * new file as a follow-up to the release commit.
 *
 * Lives in its own module so that rest.ts can serve the endpoints and
 * meta.ts can enqueue without creating a circular import.
 */

import path from 'path'

export type ExportFormat = 'step' | 'stl'

export interface PendingExport {
  id: string
  /** Project-relative path of the source SolidWorks file. */
  sourceRelPath: string
  /** Absolute path on the user's disk (so the SW add-in can open it directly). */
  sourceAbsPath: string
  /** Project-relative path the exported file should land at. */
  targetRelPath: string
  /** Absolute path SW SaveAs should write to. */
  targetAbsPath: string
  format: ExportFormat
  /** Wall-clock ms when this task was enqueued (debug / staleness). */
  enqueuedAt: number
}

const pending: PendingExport[] = []
let idCounter = 1

/**
 * Last time the SW add-in pinged any REST endpoint (ms since epoch).
 * Set by rest.ts on every incoming request. We treat the add-in as
 * "alive" if we've heard from it within SW_ALIVE_WINDOW_MS.
 */
let lastSwSeenAt = 0
const SW_ALIVE_WINDOW_MS = 15_000

export function markSwSeen(): void {
  lastSwSeenAt = Date.now()
}

export function isSwAlive(): boolean {
  return lastSwSeenAt > 0 && Date.now() - lastSwSeenAt < SW_ALIVE_WINDOW_MS
}

export function getLastSwSeenAt(): number {
  return lastSwSeenAt
}

/**
 * Enqueue an export task. No-op if a task for the same source+format is
 * already in the queue (prevents pile-ups when the manufacturing view
 * triggers a re-poll mid-export).
 */
export function queuePendingExport(
  projectPath: string,
  sourceRelPath: string,
  format: ExportFormat
): PendingExport | null {
  const dup = pending.find(p => p.sourceRelPath === sourceRelPath && p.format === format)
  if (dup) return dup

  const ext = path.extname(sourceRelPath)
  const base = sourceRelPath.slice(0, sourceRelPath.length - ext.length)
  const targetRelPath = `${base}.${format}`

  const task: PendingExport = {
    id: `pe-${Date.now()}-${idCounter++}`,
    sourceRelPath,
    sourceAbsPath: path.join(projectPath, sourceRelPath),
    targetRelPath,
    targetAbsPath: path.join(projectPath, targetRelPath),
    format,
    enqueuedAt: Date.now()
  }
  pending.push(task)
  return task
}

export function listPendingExports(): PendingExport[] {
  return pending.slice()
}

export function findPendingExport(id: string): PendingExport | undefined {
  return pending.find(p => p.id === id)
}

/** Drop a task by id; returns the removed task, or null if id wasn't found. */
export function completePendingExport(id: string): PendingExport | null {
  const idx = pending.findIndex(p => p.id === id)
  if (idx < 0) return null
  const [removed] = pending.splice(idx, 1)
  return removed
}

/** Wipe the queue (used when switching/closing projects). */
export function clearPendingExports(): void {
  pending.length = 0
}
