import { google, drive_v3 } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import http from 'http'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { app, shell } from 'electron'
import { getProjectPath } from './git'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const TOKEN_FILE = 'drive-tokens.json'
const DRIVE_CONFIG_FILE = 'drive-config.json'

// Users must supply their own OAuth client credentials.
// Create at https://console.cloud.google.com/apis/credentials
// Set as env vars or place in drive-config.json in userData.
function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TRENTCAD_GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.TRENTCAD_GOOGLE_CLIENT_SECRET || ''
  if (clientId && clientSecret) return { clientId, clientSecret }

  try {
    const configPath = path.join(app.getPath('userData'), DRIVE_CONFIG_FILE)
    const data = fsSync.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(data)
    return { clientId: config.clientId || '', clientSecret: config.clientSecret || '' }
  } catch {
    return { clientId: '', clientSecret: '' }
  }
}

let oauth2Client: OAuth2Client | null = null
let driveApi: drive_v3.Drive | null = null
let driveFolderId: string | null = null
let lastSyncTime: string | null = null

interface DriveStatus {
  connected: boolean
  configured: boolean
  folderUrl?: string
  lastSync?: string
}

async function getTokenPath(): Promise<string> {
  return path.join(app.getPath('userData'), TOKEN_FILE)
}

async function saveTokens(tokens: object): Promise<void> {
  const tokenPath = await getTokenPath()
  await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2))
}

async function loadTokens(): Promise<object | null> {
  try {
    const tokenPath = await getTokenPath()
    const data = await fs.readFile(tokenPath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

function createOAuth2Client(): OAuth2Client | null {
  const { clientId, clientSecret } = getClientCredentials()
  if (!clientId || !clientSecret) return null
  return new google.auth.OAuth2(clientId, clientSecret, 'http://127.0.0.1:0')
}

export async function initDrive(): Promise<boolean> {
  oauth2Client = createOAuth2Client()
  if (!oauth2Client) return false

  const tokens = await loadTokens()
  if (!tokens) return false

  oauth2Client.setCredentials(tokens as Parameters<OAuth2Client['setCredentials']>[0])
  oauth2Client.on('tokens', async (newTokens) => {
    const existing = await loadTokens()
    await saveTokens({ ...existing, ...newTokens })
  })

  driveApi = google.drive({ version: 'v3', auth: oauth2Client })
  return true
}

export async function connectDrive(): Promise<{ success: boolean; error?: string }> {
  oauth2Client = createOAuth2Client()
  if (!oauth2Client) {
    return {
      success: false,
      error: 'Google Drive not configured. Set TRENTCAD_GOOGLE_CLIENT_ID and TRENTCAD_GOOGLE_CLIENT_SECRET, or create drive-config.json in the app data folder.'
    }
  }

  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Authorization denied.</h2><p>You can close this window.</p></body></html>')
          srv.close()
          resolve({ success: false, error: 'Authorization denied by user' })
          return
        }

        if (!code) {
          res.writeHead(400)
          res.end('Missing code')
          return
        }

        const { tokens } = await oauth2Client!.getToken(code)
        oauth2Client!.setCredentials(tokens)
        await saveTokens(tokens)

        oauth2Client!.on('tokens', async (newTokens) => {
          const existing = await loadTokens()
          await saveTokens({ ...existing, ...newTokens })
        })

        driveApi = google.drive({ version: 'v3', auth: oauth2Client! })

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h2>Connected to Google Drive!</h2><p>You can close this window.</p></body></html>')
        srv.close()
        resolve({ success: true })
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end('<html><body><h2>Error</h2><p>Authentication failed.</p></body></html>')
        srv.close()
        resolve({ success: false, error: (err as Error).message })
      }
    })

    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (!addr || typeof addr === 'string') {
        srv.close()
        resolve({ success: false, error: 'Failed to start auth server' })
        return
      }

      const redirectUri = `http://127.0.0.1:${addr.port}`
      oauth2Client!.redirectUri = redirectUri

      const authUrl = oauth2Client!.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
      })

      shell.openExternal(authUrl)
    })

    setTimeout(() => {
      srv.close()
      resolve({ success: false, error: 'Authentication timed out (2 minutes)' })
    }, 120000)
  })
}

export async function disconnectDrive(): Promise<void> {
  try {
    const tokenPath = await getTokenPath()
    await fs.unlink(tokenPath)
  } catch {
    // Token file may not exist
  }
  oauth2Client = null
  driveApi = null
  driveFolderId = null
  lastSyncTime = null
}

export function getDriveStatus(): DriveStatus {
  const { clientId } = getClientCredentials()
  return {
    connected: driveApi !== null,
    configured: !!clientId,
    folderUrl: driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : undefined,
    lastSync: lastSyncTime ?? undefined
  }
}

async function ensureDriveFolder(name: string, parentId?: string): Promise<string> {
  if (!driveApi) throw new Error('Drive not connected')

  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  let query = `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  if (parentId) query += ` and '${parentId}' in parents`

  const res = await driveApi.files.list({ q: query, fields: 'files(id, name)', spaces: 'drive' })
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!
  }

  const createRes = await driveApi.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined
    },
    fields: 'id'
  })

  return createRes.data.id!
}

async function uploadOrUpdateFile(localPath: string, fileName: string, parentId: string): Promise<void> {
  if (!driveApi) throw new Error('Drive not connected')

  const escapedFileName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const query = `name='${escapedFileName}' and '${parentId}' in parents and trashed=false`
  const existing = await driveApi.files.list({ q: query, fields: 'files(id)', spaces: 'drive' })

  const media = { body: fsSync.createReadStream(localPath) }

  if (existing.data.files && existing.data.files.length > 0) {
    await driveApi.files.update({
      fileId: existing.data.files[0].id!,
      media
    })
  } else {
    await driveApi.files.create({
      requestBody: { name: fileName, parents: [parentId] },
      media,
      fields: 'id'
    })
  }
}

async function syncDirectory(localDir: string, driveParentId: string, relativeTo: string): Promise<number> {
  let count = 0
  let items: string[]
  try {
    items = await fs.readdir(localDir)
  } catch {
    return count
  }

  for (const item of items) {
    if (item === '.git' || item === '.claude' || item === 'node_modules') continue

    const fullPath = path.join(localDir, item)
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat) continue

    if (stat.isDirectory()) {
      const folderId = await ensureDriveFolder(item, driveParentId)
      count += await syncDirectory(fullPath, folderId, relativeTo)
    } else {
      await uploadOrUpdateFile(fullPath, item, driveParentId)
      count++
    }
  }

  return count
}

export async function syncToDrive(): Promise<{ success: boolean; filesUploaded: number; error?: string }> {
  if (!driveApi) return { success: false, filesUploaded: 0, error: 'Google Drive not connected' }

  try {
    const projectDir = getProjectPath()
    const projectName = path.basename(projectDir)

    driveFolderId = await ensureDriveFolder(`TrentCAD - ${projectName}`)
    const filesUploaded = await syncDirectory(projectDir, driveFolderId, projectDir)

    lastSyncTime = new Date().toISOString()
    return { success: true, filesUploaded }
  } catch (err) {
    return { success: false, filesUploaded: 0, error: (err as Error).message }
  }
}

export function isDriveConnected(): boolean {
  return driveApi !== null
}
