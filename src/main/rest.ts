import http from 'http'
import path from 'path'
import type { BrowserWindow } from 'electron'
import type { FileEntry, ProjectConfig, PublishResult, SyncResult } from '@shared/types'
import * as gitOps from './git'
import * as lockOps from './locking'
import * as partsOps from './parts'

const DEFAULT_PORT = 42129
const MAX_BODY_SIZE = 1024 * 64 // 64 KB

let server: http.Server | null = null
let currentProject: ProjectConfig | null = null
let activePort: number | null = null
/** Set by setupIpc so the SW add-in can request TrentCAD's main window come to the front. */
let getMainWindowRef: (() => BrowserWindow | null) | null = null

interface PendingCreate {
  id: string
  type: 'part' | 'assembly'
  relativePath: string
  absolutePath: string
  partNumber?: string
}

const pendingCreates: PendingCreate[] = []
let pendingIdCounter = 1

export function queuePendingCreate(
  type: 'part' | 'assembly',
  relativePath: string,
  partNumber?: string
): void {
  if (!currentProject) return
  pendingCreates.push({
    id: `pc-${Date.now()}-${pendingIdCounter++}`,
    type,
    relativePath,
    absolutePath: path.join(currentProject.path, relativePath),
    partNumber
  })
}

let writeLock: Promise<void> = Promise.resolve()

/**
 * Mirror of ipc.ts broadcastStatus — push a fresh getStatus() to the
 * renderer so views (file tree, AdminPage, ManufacturingQueue) pick up
 * meta changes made over REST from the SolidWorks add-in. The chokidar
 * watcher ignores `.trentcad/`, so meta writes need an explicit nudge.
 */
function broadcastStatus(): void {
  const win = getMainWindowRef?.()
  if (!win || win.isDestroyed()) return
  gitOps.getStatus()
    .then(files => { if (!win.isDestroyed()) win.webContents.send('file-change', files) })
    .catch(() => {})
}

function serialWrite<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    writeLock = writeLock.then(async () => {
      try {
        resolve(await fn())
      } catch (err) {
        reject(err)
      }
    })
  })
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS })
  res.end(JSON.stringify(data))
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function findEntry(entries: FileEntry[], targetPath: string): FileEntry | null {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry
    if (entry.children) {
      const found = findEntry(entry.children, targetPath)
      if (found) return found
    }
  }
  return null
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  const route = `${req.method} ${url.pathname}`

  try {
    switch (route) {
      case 'GET /api/health': {
        json(res, 200, { running: true, project: currentProject })
        return
      }

      case 'GET /api/status': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const files = await gitOps.getStatus()
        json(res, 200, files)
        return
      }

      case 'GET /api/file': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const filePath = url.searchParams.get('path')
        if (!filePath) {
          json(res, 400, { error: 'Missing path parameter' })
          return
        }
        const files = await gitOps.getStatus()
        const entry = findEntry(files, filePath)
        if (!entry) {
          json(res, 404, { error: 'File not found' })
          return
        }
        // Augment with "newer-on-remote" freshness flag so the SW
        // add-in can show a "Newer version available — Download?"
        // banner when the user opens a stale local copy
        const newerOnRemote = await gitOps.isFileNewerOnRemote(filePath).catch(() => false)
        json(res, 200, { ...entry, newerOnRemote })
        return
      }

      case 'GET /api/locks': {
        const locks = await lockOps.getLocks()
        json(res, 200, locks)
        return
      }

      case 'POST /api/checkout': {
        const body = parseJson(await readBody(req)) as { path?: string } | null
        if (!body?.path) {
          json(res, 400, { error: 'Missing or invalid path in request body' })
          return
        }
        try {
          await serialWrite(() => lockOps.checkOut(body.path!))
          json(res, 200, { success: true })
        } catch (err) {
          json(res, 500, { success: false, error: (err as Error).message })
        }
        return
      }

      case 'POST /api/checkin': {
        const body = parseJson(await readBody(req)) as { path?: string } | null
        if (!body?.path) {
          json(res, 400, { error: 'Missing or invalid path in request body' })
          return
        }
        try {
          await serialWrite(() => lockOps.checkIn(body.path!))
          json(res, 200, { success: true })
        } catch (err) {
          json(res, 500, { success: false, error: (err as Error).message })
        }
        return
      }

      case 'POST /api/sync': {
        const result: SyncResult = await serialWrite(() => gitOps.sync())
        json(res, result.success ? 200 : 500, result)
        return
      }

      case 'POST /api/publish': {
        const body = parseJson(await readBody(req)) as { message?: string } | null
        if (!body?.message) {
          json(res, 400, { error: 'Missing or invalid message in request body' })
          return
        }
        const result: PublishResult = await serialWrite(() => gitOps.publish(body.message!))
        json(res, result.success ? 200 : 500, result)
        return
      }

      case 'GET /api/parts': {
        const manifest = await partsOps.loadManifest()
        json(res, 200, manifest)
        return
      }

      case 'POST /api/parts/new-part': {
        const body = parseJson(await readBody(req)) as { folder?: string; description?: string } | null
        const folder = body?.folder ?? ''
        const result = await serialWrite(() => partsOps.createNewPart(folder, body?.description))
        json(res, 200, { success: true, ...result })
        return
      }

      case 'POST /api/part-mass-auto': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const body = parseJson(await readBody(req)) as { path?: string; mass?: number } | null
        if (!body?.path || typeof body.mass !== 'number') {
          json(res, 400, { error: 'Missing path or mass' })
          return
        }
        try {
          // Lazy import so rest.ts doesn't pull in meta on load
          const meta = await import('./meta')
          await serialWrite(() => meta.setPartMass(body.path!, body.mass!))
          broadcastStatus()
          json(res, 200, { success: true })
        } catch (err) {
          json(res, 500, { success: false, error: (err as Error).message })
        }
        return
      }

      case 'POST /api/focus': {
        // Bring TrentCAD's main window to the foreground. Used by the
        // SW add-in's "Show in TrentCAD" button so the user doesn't
        // have to alt-tab to find it.
        const win = getMainWindowRef?.()
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
          json(res, 200, { success: true })
        } else {
          json(res, 503, { success: false, error: 'TrentCAD window unavailable' })
        }
        return
      }

      case 'GET /api/meta': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const url = new URL(req.url || '', 'http://localhost')
        const filePath = url.searchParams.get('path')
        if (!filePath) { json(res, 400, { error: 'Missing path query param' }); return }
        try {
          const meta = await import('./meta')
          const result = await meta.getPartMeta(filePath)
          json(res, 200, result)
        } catch (err) {
          json(res, 500, { error: (err as Error).message })
        }
        return
      }

      case 'POST /api/release-state': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const body = parseJson(await readBody(req)) as { path?: string; state?: string; note?: string } | null
        if (!body?.path || !body?.state) {
          json(res, 400, { error: 'Missing path or state' })
          return
        }
        const validStates = ['draft', 'in-review', 'released', 'manufactured']
        if (!validStates.includes(body.state)) {
          json(res, 400, { error: `Invalid state. Expected one of: ${validStates.join(', ')}` })
          return
        }
        try {
          const meta = await import('./meta')
          await serialWrite(() => meta.setReleaseState(
            body.path!,
            body.state as 'draft' | 'in-review' | 'released' | 'manufactured',
            body.note
          ))
          broadcastStatus()
          json(res, 200, { success: true })
        } catch (err) {
          json(res, 500, { success: false, error: (err as Error).message })
        }
        return
      }

      case 'GET /api/title-block-data': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const filePath = url.searchParams.get('path')
        if (!filePath) { json(res, 400, { error: 'Missing path' }); return }
        try {
          const parts = await import('./parts')
          const manifest = await parts.loadManifest()
          const entry = manifest.entries[filePath]
          // Drawings link to a part via `linkedTo` and share its number.
          // For mass/material, pull from the LINKED part's metadata if
          // it exists; fall back to the drawing's own meta otherwise.
          const linkedPath = entry?.linkedTo || filePath
          const meta = await import('./meta')
          const linkedMeta = await meta.getPartMeta(linkedPath).catch(() => ({}))
          // Designer = the user who's about to publish. git config
          // user.name is the right field — same one used as commit
          // author throughout TrentCAD.
          const identity = await gitOps.getGitIdentity().catch(() => ({ name: '', email: '' }))
          const today = new Date()
          const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
          const massLb = typeof linkedMeta.mass === 'number' ? linkedMeta.mass : null
          json(res, 200, {
            partNumber: entry?.partNumber ?? '',
            description: entry?.description ?? '',
            material: linkedMeta.manufacturingMaterial ?? '',
            mass: massLb !== null ? `${massLb.toFixed(3)} lb` : '',
            designer: identity.name || '',
            date
          })
        } catch (err) {
          json(res, 500, { error: (err as Error).message })
        }
        return
      }

      case 'POST /api/material': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const body = parseJson(await readBody(req)) as { path?: string; material?: string } | null
        if (!body?.path || typeof body.material !== 'string') {
          json(res, 400, { error: 'Missing path or material' })
          return
        }
        try {
          const meta = await import('./meta')
          await serialWrite(() => meta.setManufacturingMaterial(body.path!, body.material!))
          broadcastStatus()
          json(res, 200, { success: true })
        } catch (err) {
          json(res, 500, { success: false, error: (err as Error).message })
        }
        return
      }

      case 'POST /api/manufacturing-method': {
        // SolidWorks add-in sets manufacturing method directly so the
        // designer doesn't have to alt-tab to TrentCAD to make their
        // part show up on the shop-floor queue.
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const body = parseJson(await readBody(req)) as { path?: string; method?: string | null } | null
        if (!body?.path) { json(res, 400, { error: 'Missing path' }); return }
        const validMethods = ['print', 'cnc', 'manual', 'other']
        const method = body.method === null || body.method === '' ? null : body.method
        if (method !== null && !validMethods.includes(method)) {
          json(res, 400, { error: `Invalid method. Expected one of: ${validMethods.join(', ')}, or null to clear` })
          return
        }
        try {
          const meta = await import('./meta')
          await serialWrite(() => meta.setManufacturingMethod(
            body.path!,
            method as 'print' | 'cnc' | 'manual' | 'other' | null
          ))
          broadcastStatus()
          json(res, 200, { success: true })
        } catch (err) {
          json(res, 500, { success: false, error: (err as Error).message })
        }
        return
      }

      case 'POST /api/comments': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const body = parseJson(await readBody(req)) as { path?: string; text?: string } | null
        if (!body?.path || !body?.text || !body.text.trim()) {
          json(res, 400, { error: 'Missing path or text' })
          return
        }
        try {
          const meta = await import('./meta')
          await serialWrite(() => meta.addComment(body.path!, body.text!.trim()))
          broadcastStatus()
          json(res, 200, { success: true })
        } catch (err) {
          json(res, 500, { success: false, error: (err as Error).message })
        }
        return
      }

      case 'POST /api/stage': {
        if (!currentProject) { json(res, 503, { error: 'No project open' }); return }
        const body = parseJson(await readBody(req)) as { path?: string } | null
        if (!body?.path) { json(res, 400, { error: 'Missing path' }); return }
        try {
          await serialWrite(() => gitOps.getGit().raw(['add', '--', body.path!]))
          json(res, 200, { success: true })
        } catch (err) {
          json(res, 500, { success: false, error: (err as Error).message })
        }
        return
      }

      case 'GET /api/pending-creates': {
        json(res, 200, pendingCreates)
        return
      }

      case 'POST /api/pending-creates/done': {
        const body = parseJson(await readBody(req)) as { id?: string } | null
        if (!body?.id) {
          json(res, 400, { error: 'Missing id' })
          return
        }
        const idx = pendingCreates.findIndex(p => p.id === body.id)
        if (idx >= 0) pendingCreates.splice(idx, 1)
        json(res, 200, { success: true })
        return
      }

      case 'POST /api/parts/new-subsystem': {
        const body = parseJson(await readBody(req)) as {
          parentFolder?: string
          name?: string
        } | null
        if (!body?.name) {
          json(res, 400, { error: 'Missing name for subsystem' })
          return
        }
        const result = await serialWrite(() =>
          partsOps.createSubsystem(body.parentFolder ?? '', body.name!)
        )
        json(res, 200, { success: true, ...result })
        return
      }

      case 'POST /api/parts/new-assembly': {
        const body = parseJson(await readBody(req)) as {
          parentFolder?: string
          name?: string
          description?: string
        } | null
        if (!body?.name) {
          json(res, 400, { error: 'Missing name for assembly' })
          return
        }
        const result = await serialWrite(() =>
          partsOps.createNewAssembly(body.parentFolder ?? '', body.name!, body.description)
        )
        json(res, 200, { success: true, ...result })
        return
      }

      default:
        json(res, 404, { error: 'Not found' })
    }
  } catch (err) {
    if (!res.headersSent) {
      json(res, 500, { error: (err as Error).message })
    }
  }
}

export function startRestServer(project?: ProjectConfig, port?: number): void {
  if (project) currentProject = project

  if (server) return

  activePort = port || Number(process.env.TRENTCAD_API_PORT) || DEFAULT_PORT

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'Internal server error' })
    })
  })

  server.listen(activePort, '127.0.0.1', () => {
    console.log(`TrentCAD REST API running on http://127.0.0.1:${activePort}`)
  })

  server.on('error', (err) => {
    console.error('REST API server error:', err.message)
  })
}

export function setRestProject(project: ProjectConfig): void {
  currentProject = project
}

export function setRestMainWindow(getter: () => BrowserWindow | null): void {
  getMainWindowRef = getter
}

export function clearRestProject(): void {
  currentProject = null
}

export function stopRestServer(): void {
  if (server) {
    server.close()
    server = null
    activePort = null
    currentProject = null
  }
}

export function getRestPort(): number | null {
  return activePort
}
