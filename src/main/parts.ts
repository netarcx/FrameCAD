import path from 'path'
import fs from 'fs/promises'
import type { FileEntry, PartsManifest, PartEntry, PartType } from '@shared/types'
import { getProjectPath } from './git'

const MANIFEST_FILE = 'parts.json'
const SOLIDWORKS_EXTS = new Set(['.sldprt', '.sldasm', '.slddrw'])
const DEFAULT_PREFIX = '2129'

let manifestLock: Promise<void> = Promise.resolve()

function emptyManifest(): PartsManifest {
  return {
    prefix: DEFAULT_PREFIX,
    nextCounters: {},
    nextAssemblyCounters: {},
    entries: {},
    assemblies: {}
  }
}

export async function loadManifest(): Promise<PartsManifest> {
  try {
    const filePath = path.join(getProjectPath(), MANIFEST_FILE)
    const data = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return emptyManifest()
  }
}

export async function saveManifest(manifest: PartsManifest): Promise<void> {
  const filePath = path.join(getProjectPath(), MANIFEST_FILE)
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2) + '\n')
}

export function classifyFile(filename: string): PartType | null {
  const ext = path.extname(filename).toLowerCase()
  if (!SOLIDWORKS_EXTS.has(ext)) return null
  switch (ext) {
    case '.sldprt': return 'part'
    case '.sldasm': return 'assembly'
    case '.slddrw': return 'drawing'
    default: return null
  }
}

function getScope(relPath: string): string {
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
  return dir
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

function ensureAssemblyNumber(manifest: PartsManifest, folderPath: string): string {
  if (manifest.assemblies[folderPath]) {
    return manifest.assemblies[folderPath]
  }

  const segments = folderPath.split('/')
  let builtPath = ''
  let assemblyNum = ''

  for (let i = 0; i < segments.length; i++) {
    builtPath = i === 0 ? segments[i] : builtPath + '/' + segments[i]
    const parentScope = i === 0 ? '' : segments.slice(0, i).join('/')

    if (manifest.assemblies[builtPath]) {
      assemblyNum = manifest.assemblies[builtPath]
    } else {
      const counter = manifest.nextAssemblyCounters[parentScope] || 1
      const segment = pad2(counter)
      assemblyNum = assemblyNum ? assemblyNum + '-' + segment : segment
      manifest.nextAssemblyCounters[parentScope] = counter + 1
      manifest.assemblies[builtPath] = assemblyNum
    }
  }

  return assemblyNum
}

function findLinkedPart(manifest: PartsManifest, drawingPath: string): PartEntry | null {
  const baseName = path.basename(drawingPath, path.extname(drawingPath))
  const dir = getScope(drawingPath)

  for (const [entryPath, entry] of Object.entries(manifest.entries)) {
    if (entry.type === 'drawing') continue
    const entryBase = path.basename(entryPath, path.extname(entryPath))
    const entryDir = getScope(entryPath)
    if (entryBase === baseName && entryDir === dir) {
      return entry
    }
  }
  return null
}

export function assignPartNumber(manifest: PartsManifest, relPath: string): PartEntry | null {
  if (manifest.entries[relPath]) return manifest.entries[relPath]

  const filename = path.basename(relPath)
  const type = classifyFile(filename)
  if (!type) return null

  const scope = getScope(relPath)

  if (type === 'drawing') {
    const linked = findLinkedPart(manifest, relPath)
    if (linked) {
      const entry: PartEntry = {
        partNumber: linked.partNumber,
        assignedAt: new Date().toISOString(),
        type: 'drawing',
        linkedTo: Object.entries(manifest.entries).find(([, e]) => e === linked)?.[0]
      }
      manifest.entries[relPath] = entry
      return entry
    }
  }

  let partNumber: string
  if (scope === '') {
    const counter = manifest.nextCounters[''] || 1
    partNumber = `${manifest.prefix}-${pad3(counter)}`
    manifest.nextCounters[''] = counter + 1
  } else {
    const assemblySegment = ensureAssemblyNumber(manifest, scope)
    if (type === 'assembly') {
      const asmNumber = `${manifest.prefix}-${assemblySegment}`
      const alreadyUsed = Object.values(manifest.entries).some(
        e => e.type === 'assembly' && e.partNumber === asmNumber
      )
      if (!alreadyUsed) {
        const entry: PartEntry = {
          partNumber: asmNumber,
          assignedAt: new Date().toISOString(),
          type: 'assembly'
        }
        manifest.entries[relPath] = entry
        return entry
      }
    }
    const counter = manifest.nextCounters[scope] || 1
    partNumber = `${manifest.prefix}-${assemblySegment}-${pad3(counter)}`
    manifest.nextCounters[scope] = counter + 1
  }

  const entry: PartEntry = {
    partNumber,
    assignedAt: new Date().toISOString(),
    type
  }
  manifest.entries[relPath] = entry
  return entry
}

async function collectSolidWorksFiles(dirPath: string, relativeTo: string): Promise<string[]> {
  const results: string[] = []

  async function walk(dir: string): Promise<void> {
    let items: string[]
    try {
      items = await fs.readdir(dir)
    } catch {
      return
    }

    for (const item of items) {
      if (item === '.git' || item === '.claude') continue
      const fullPath = path.join(dir, item)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (!stat) continue

      if (stat.isDirectory()) {
        await walk(fullPath)
      } else if (classifyFile(item)) {
        const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/')
        results.push(relPath)
      }
    }
  }

  await walk(dirPath)
  results.sort()
  return results
}

function handleFileMoves(manifest: PartsManifest, currentPaths: Set<string>): void {
  const missing: [string, PartEntry][] = []

  for (const [entryPath, entry] of Object.entries(manifest.entries)) {
    if (!currentPaths.has(entryPath)) {
      missing.push([entryPath, entry])
    }
  }

  for (const [oldPath, entry] of missing) {
    const filename = path.basename(oldPath)
    let found = false

    for (const currentPath of currentPaths) {
      if (path.basename(currentPath) === filename && !manifest.entries[currentPath]) {
        manifest.entries[currentPath] = entry
        delete manifest.entries[oldPath]
        found = true
        break
      }
    }

    if (!found) {
      // File was deleted — leave tombstone so number is never reused
    }
  }
}

async function syncManifestImpl(): Promise<PartsManifest> {
  const projectDir = getProjectPath()
  const manifest = await loadManifest()
  const swFiles = await collectSolidWorksFiles(projectDir, projectDir)
  const currentPaths = new Set(swFiles)

  handleFileMoves(manifest, currentPaths)

  // Assign assemblies first (folders with .sldasm), then parts, then drawings
  const assemblies = swFiles.filter(f => classifyFile(path.basename(f)) === 'assembly')
  const parts = swFiles.filter(f => classifyFile(path.basename(f)) === 'part')
  const drawings = swFiles.filter(f => classifyFile(path.basename(f)) === 'drawing')

  for (const file of assemblies) assignPartNumber(manifest, file)
  for (const file of parts) assignPartNumber(manifest, file)
  for (const file of drawings) assignPartNumber(manifest, file)

  await saveManifest(manifest)
  return manifest
}

export function syncManifest(): Promise<PartsManifest> {
  const p = manifestLock.then(() => syncManifestImpl())
  manifestLock = p.then(() => {}, () => {})
  return p
}

export async function getPartNumber(relPath: string): Promise<string | null> {
  const manifest = await loadManifest()
  return manifest.entries[relPath]?.partNumber ?? null
}

export async function createNewPart(
  folder: string,
  description?: string
): Promise<{ partNumber: string; filePath: string }> {
  const projectDir = getProjectPath()
  const manifest = await loadManifest()

  let partNumber: string
  if (folder === '') {
    const counter = manifest.nextCounters[''] || 1
    partNumber = `${manifest.prefix}-${pad3(counter)}`
    manifest.nextCounters[''] = counter + 1
  } else {
    const assemblySegment = ensureAssemblyNumber(manifest, folder)
    const counter = manifest.nextCounters[folder] || 1
    partNumber = `${manifest.prefix}-${assemblySegment}-${pad3(counter)}`
    manifest.nextCounters[folder] = counter + 1
  }

  const fileName = `${partNumber}.sldprt`
  const relPath = folder ? `${folder}/${fileName}` : fileName
  const fullPath = path.join(projectDir, relPath)

  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, '')

  manifest.entries[relPath] = {
    partNumber,
    assignedAt: new Date().toISOString(),
    type: 'part',
    description
  }

  await saveManifest(manifest)
  return { partNumber, filePath: relPath }
}

export async function createNewAssembly(
  parentFolder: string,
  name: string,
  description?: string
): Promise<{ partNumber: string; filePath: string }> {
  const projectDir = getProjectPath()
  const manifest = await loadManifest()

  const folderPath = parentFolder ? `${parentFolder}/${name}` : name
  const assemblySegment = ensureAssemblyNumber(manifest, folderPath)
  const partNumber = `${manifest.prefix}-${assemblySegment}`

  const fileName = `${partNumber}.sldasm`
  const relPath = `${folderPath}/${fileName}`
  const fullPath = path.join(projectDir, relPath)

  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, '')

  manifest.entries[relPath] = {
    partNumber,
    assignedAt: new Date().toISOString(),
    type: 'assembly',
    description
  }

  await saveManifest(manifest)
  return { partNumber, filePath: relPath }
}

export function annotatePartNumbers(entries: FileEntry[], manifest: PartsManifest): void {
  for (const entry of entries) {
    if (!entry.isDirectory && manifest.entries[entry.path]) {
      entry.partNumber = manifest.entries[entry.path].partNumber
      entry.partDescription = manifest.entries[entry.path].description
    }
    if (entry.children) {
      annotatePartNumbers(entry.children, manifest)
    }
  }
}
