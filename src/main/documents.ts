import path from 'path'
import { promises as fs } from 'fs'
import { getProjectPath } from './git'
import { loadManifest } from './parts'
import { loadAllMeta } from './meta'
import type { PartEntry, PartMeta, PartsManifest } from '@shared/types'

export type DocType = 'bom' | 'manufacturing' | 'summary'

export interface GenerateResult {
  success: boolean
  filePath?: string
  relPath?: string
  error?: string
}

const DOCS_DIR = 'Documents'
const FILES: Record<DocType, string> = {
  bom: 'BOM.csv',
  manufacturing: 'Manufacturing-Queue.csv',
  summary: 'Project-Summary.md'
}
const FRC_WEIGHT_LIMIT_LB = 125

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function topLevelSegment(p: string): string {
  if (!p) return ''
  const idx = p.indexOf('/')
  return idx === -1 ? p : p.slice(0, idx)
}

function scopeOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i === -1 ? '' : relPath.slice(0, i)
}

function basenameOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i === -1 ? relPath : relPath.slice(i + 1)
}

function dateStamp(d = new Date()): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

interface JoinedRow {
  relPath: string
  entry: PartEntry
  meta: PartMeta
  topLevel: string
}

function joinManifestAndMeta(
  manifest: PartsManifest,
  meta: Record<string, PartMeta>
): JoinedRow[] {
  const out: JoinedRow[] = []
  for (const [relPath, entry] of Object.entries(manifest.entries)) {
    out.push({
      relPath,
      entry,
      meta: meta[relPath] || {},
      topLevel: topLevelSegment(relPath) || '(root)'
    })
  }
  // Group by subsystem then by part number for predictable ordering
  out.sort((a, b) => {
    if (a.topLevel !== b.topLevel) return a.topLevel.localeCompare(b.topLevel)
    return a.entry.partNumber.localeCompare(b.entry.partNumber)
  })
  return out
}

function buildBomCsv(rows: JoinedRow[]): string {
  const header = [
    'Part Number', 'File', 'Type', 'Subsystem', 'Folder',
    'Release Status', 'Manufacturing Method', 'Material',
    'Mass (lb)', 'Cost ($)', 'Comments', 'Path'
  ]
  const lines: string[] = [header.map(csvEscape).join(',')]
  for (const r of rows) {
    lines.push([
      r.entry.partNumber,
      basenameOf(r.relPath),
      r.entry.type,
      r.topLevel,
      scopeOf(r.relPath) || '(root)',
      r.meta.release?.state ?? 'draft',
      r.meta.manufacturingMethod ?? '',
      r.meta.manufacturingMaterial ?? '',
      typeof r.meta.mass === 'number' ? r.meta.mass.toFixed(3) : '',
      typeof r.meta.cost === 'number' ? r.meta.cost.toFixed(2) : '',
      r.meta.comments?.length ?? 0,
      r.relPath
    ].map(csvEscape).join(','))
  }
  return lines.join('\n') + '\n'
}

function buildManufacturingCsv(rows: JoinedRow[]): string {
  // Only released + in-review parts and assemblies; drawings exclude (they
  // share part numbers with their parents). Sort by method, then material,
  // then part number — that's the order a shop wants to walk the list in.
  const queue = rows.filter(r => {
    if (r.entry.type === 'drawing') return false
    const s = r.meta.release?.state
    return s === 'released' || s === 'in-review'
  })
  queue.sort((a, b) => {
    const ma = a.meta.manufacturingMethod || 'zzz'
    const mb = b.meta.manufacturingMethod || 'zzz'
    if (ma !== mb) return ma.localeCompare(mb)
    const mata = a.meta.manufacturingMaterial || ''
    const matb = b.meta.manufacturingMaterial || ''
    if (mata !== matb) return mata.localeCompare(matb)
    return a.entry.partNumber.localeCompare(b.entry.partNumber)
  })

  const header = [
    'Method', 'Material', 'Part Number', 'File', 'Subsystem',
    'Type', 'Status', 'Mass (lb)', 'Notes'
  ]
  const lines: string[] = [header.map(csvEscape).join(',')]
  for (const r of queue) {
    lines.push([
      r.meta.manufacturingMethod ?? '(unassigned)',
      r.meta.manufacturingMaterial ?? '',
      r.entry.partNumber,
      basenameOf(r.relPath),
      r.topLevel,
      r.entry.type,
      r.meta.release?.state ?? '',
      typeof r.meta.mass === 'number' ? r.meta.mass.toFixed(3) : '',
      r.meta.manufacturingNotes ?? ''
    ].map(csvEscape).join(','))
  }
  return lines.join('\n') + '\n'
}

function buildSummaryMarkdown(
  rows: JoinedRow[],
  generatedBy: string
): string {
  // By-subsystem rollup
  const bySub = new Map<string, {
    parts: number; released: number; manufactured: number
    mass: number; cost: number
  }>()
  // By-method rollup (released + in-review only — the actual shop work)
  const byMethod = new Map<string, { parts: number; mass: number; cost: number }>()

  let totalMass = 0
  let totalCost = 0
  let totalParts = 0
  let totalReleased = 0
  let totalManufactured = 0

  for (const r of rows) {
    if (r.entry.type === 'drawing') continue
    totalParts++
    const state = r.meta.release?.state
    if (state === 'released') totalReleased++
    if (state === 'manufactured') totalManufactured++

    const mass = r.meta.mass ?? 0
    const cost = r.meta.cost ?? 0
    totalMass += mass
    totalCost += cost

    const sub = bySub.get(r.topLevel) || { parts: 0, released: 0, manufactured: 0, mass: 0, cost: 0 }
    sub.parts++
    if (state === 'released') sub.released++
    if (state === 'manufactured') sub.manufactured++
    sub.mass += mass
    sub.cost += cost
    bySub.set(r.topLevel, sub)

    if (state === 'released' || state === 'in-review') {
      const method = r.meta.manufacturingMethod || '(unassigned)'
      const m = byMethod.get(method) || { parts: 0, mass: 0, cost: 0 }
      m.parts++
      m.mass += mass
      m.cost += cost
      byMethod.set(method, m)
    }
  }

  const massPct = (totalMass / FRC_WEIGHT_LIMIT_LB) * 100
  const massHeadroom = FRC_WEIGHT_LIMIT_LB - totalMass

  const lines: string[] = []
  lines.push(`# Project Summary`)
  lines.push('')
  lines.push(`*Generated ${dateStamp()} by ${generatedBy || 'TrentCAD'}*`)
  lines.push('')
  lines.push(`## Totals`)
  lines.push('')
  lines.push(`- **Mass:** ${totalMass.toFixed(2)} lb of ${FRC_WEIGHT_LIMIT_LB} lb FRC limit — ` +
    `${massHeadroom >= 0 ? `${massHeadroom.toFixed(2)} lb headroom` : `**${(-massHeadroom).toFixed(2)} lb over**`} (${massPct.toFixed(1)}%)`)
  lines.push(`- **Estimated Cost:** ${formatMoney(totalCost)}`)
  lines.push(`- **Parts:** ${totalParts} total / ${totalReleased} released / ${totalManufactured} manufactured`)
  lines.push('')

  if (bySub.size > 0) {
    lines.push(`## By Subsystem`)
    lines.push('')
    lines.push(`| Subsystem | Parts | Released | Manufactured | Mass (lb) | Cost |`)
    lines.push(`|---|---|---|---|---|---|`)
    const subsystems = [...bySub.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    for (const [name, s] of subsystems) {
      lines.push(`| ${name} | ${s.parts} | ${s.released} | ${s.manufactured} | ${s.mass.toFixed(2)} | ${formatMoney(s.cost)} |`)
    }
    lines.push('')
  }

  if (byMethod.size > 0) {
    lines.push(`## Shop Work by Method *(released + in-review)*`)
    lines.push('')
    lines.push(`| Method | Parts | Mass (lb) | Cost |`)
    lines.push(`|---|---|---|---|`)
    const methods = [...byMethod.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    for (const [name, m] of methods) {
      lines.push(`| ${name} | ${m.parts} | ${m.mass.toFixed(2)} | ${formatMoney(m.cost)} |`)
    }
    lines.push('')
  }

  lines.push(`---`)
  lines.push(`<sub>Detailed part-by-part data is in \`BOM.csv\`; shop-floor cut list is in \`Manufacturing-Queue.csv\`.</sub>`)
  lines.push('')
  return lines.join('\n')
}

export async function generateDocument(type: DocType, generatedBy: string): Promise<GenerateResult> {
  try {
    const projectDir = getProjectPath()
    const manifest = await loadManifest()
    const meta = await loadAllMeta()
    const rows = joinManifestAndMeta(manifest, meta)

    let content: string
    switch (type) {
      case 'bom': content = buildBomCsv(rows); break
      case 'manufacturing': content = buildManufacturingCsv(rows); break
      case 'summary': content = buildSummaryMarkdown(rows, generatedBy); break
    }

    const relPath = `${DOCS_DIR}/${FILES[type]}`
    const absPath = path.join(projectDir, DOCS_DIR, FILES[type])
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, content, 'utf-8')

    return { success: true, filePath: absPath, relPath }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
