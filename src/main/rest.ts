import http from 'http'
import type { FileEntry, ProjectConfig, PublishResult, SyncResult } from '@shared/types'
import * as gitOps from './git'
import * as lockOps from './locking'
import * as partsOps from './parts'

const DEFAULT_PORT = 42129
const MAX_BODY_SIZE = 1024 * 64 // 64 KB

let server: http.Server | null = null
let currentProject: ProjectConfig | null = null
let activePort: number | null = null

let writeLock: Promise<void> = Promise.resolve()

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
        const files = await gitOps.getStatus()
        json(res, 200, files)
        return
      }

      case 'GET /api/file': {
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
        json(res, 200, entry)
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

export function startRestServer(project: ProjectConfig, port?: number): void {
  stopRestServer()
  currentProject = project
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
