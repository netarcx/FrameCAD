import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import path from 'path'
import { watch } from 'chokidar'
import * as gitOps from './git'
import * as lockOps from './locking'
import * as partsOps from './parts'
import * as adminOps from './admin'
import * as depsOps from './deps'
import { addRecentProject, getRecentProjects } from './config'
import { setRestProject, clearRestProject, stopRestServer, queuePendingCreate } from './rest'
import * as driveOps from './drive'
import type { ProjectConfig } from '@shared/types'

let watcher: ReturnType<typeof watch> | null = null
let publishingNow = false

export function isPublishing(): boolean {
  return publishingNow
}

function debounce<T extends (...args: unknown[]) => unknown>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: unknown[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as unknown as T
}

function notifyFileChange(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  partsOps.syncManifest()
    .then(() => gitOps.getStatus())
    .then(files => { if (!win.isDestroyed()) win.webContents.send('file-change', files) })
    .catch(() => {
      gitOps.getStatus().then(files => {
        if (!win.isDestroyed()) win.webContents.send('file-change', files)
      }).catch(() => {})
    })
}

function startWatching(dirPath: string, win: BrowserWindow): void {
  stopWatching()
  const debouncedNotify = debounce(() => notifyFileChange(win), 500)
  watcher = watch(dirPath, {
    ignored: [/(^|[/\\])\../, /node_modules/, /parts\.json$/],
    persistent: true,
    ignoreInitial: true,
    depth: 10
  })
  watcher.on('all', debouncedNotify)
}

function stopWatching(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}

export function setupIpc(getMainWindow: () => BrowserWindow | null): void {
  let currentProject: ProjectConfig | null = null

  ipcMain.handle('create-project', async (_e, name: string, dirPath: string, remote: string, isCotsProject?: boolean) => {
    await gitOps.createProject(name, dirPath, remote)
    if (isCotsProject) {
      await adminOps.writeLocalAdminConfig({ isCotsProject: true })
    }
    currentProject = { name, path: dirPath, remote }
    await addRecentProject(currentProject)
    setRestProject(currentProject)
    driveOps.initDrive().catch(() => {})
    const win = getMainWindow()
    if (win) startWatching(dirPath, win)
  })

  ipcMain.handle('join-project', async (_e, url: string, dirPath: string) => {
    await gitOps.joinProject(url, dirPath)
    const name = path.basename(dirPath)
    currentProject = { name, path: dirPath, remote: url }
    await addRecentProject(currentProject)
    setRestProject(currentProject)
    driveOps.initDrive().catch(() => {})
    // If the joined project has admin-configured COTS, download it as part
    // of the join so the COTS library is ready before the user enters the
    // project. Network errors are tolerated — the project still opens.
    try {
      const cfg = await adminOps.loadAdminConfig()
      if (cfg.cotsRepoUrl) {
        await gitOps.syncCotsRepo(cfg.cotsRepoUrl, cfg.cotsBranch)
      }
    } catch { /* best effort */ }
    const win = getMainWindow()
    if (win) startWatching(dirPath, win)
  })

  ipcMain.handle('open-project', async (_e, dirPath: string) => {
    await gitOps.openProject(dirPath)
    const name = path.basename(dirPath)
    const git = gitOps.getGit()
    let remote = ''
    try {
      const remotes = await git.getRemotes(true)
      remote = remotes.find(r => r.name === 'origin')?.refs.push || ''
    } catch { /* no remote */ }
    currentProject = { name, path: dirPath, remote }
    await addRecentProject(currentProject)
    setRestProject(currentProject)
    driveOps.initDrive().catch(() => {})
    // Apply admin config: pull the shared COTS library in the background
    adminOps.loadAdminConfig().then(cfg => {
      if (cfg.cotsRepoUrl) gitOps.syncCotsRepo(cfg.cotsRepoUrl, cfg.cotsBranch).catch(() => {})
    }).catch(() => {})
    const win = getMainWindow()
    if (win) startWatching(dirPath, win)
    return currentProject
  })

  ipcMain.handle('sync', async () => {
    return gitOps.sync()
  })

  ipcMain.handle('publish', async (_e, message: string) => {
    const win = getMainWindow()
    publishingNow = true
    try {
      const result = await gitOps.publish(message, (progress) => {
        if (win && !win.isDestroyed()) win.webContents.send('publish-progress', progress)
      })
      if (result.success && driveOps.isDriveConnected()) {
        driveOps.syncToDrive().catch(() => {})
      }
      return result
    } finally {
      publishingNow = false
    }
  })

  ipcMain.handle('get-status', async () => {
    return gitOps.getStatus()
  })

  ipcMain.handle('get-history', async (_e, limit?: number) => {
    return gitOps.getHistory(limit)
  })

  ipcMain.handle('check-out', async (_e, filePath: string) => {
    await lockOps.checkOut(filePath)
  })

  ipcMain.handle('check-in', async (_e, filePath: string) => {
    await lockOps.checkIn(filePath)
  })

  ipcMain.handle('get-locks', async () => {
    return lockOps.getLocks()
  })

  ipcMain.handle('select-directory', async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('open-file-explorer', async (_e, filePath: string) => {
    const projectDir = gitOps.getProjectPath()
    shell.showItemInFolder(path.join(projectDir, filePath))
  })

  ipcMain.handle('get-project-config', () => {
    return currentProject
  })

  ipcMain.handle('get-parts-manifest', async () => {
    try {
      return await partsOps.loadManifest()
    } catch {
      return null
    }
  })

  ipcMain.handle('create-new-part', async (_e, folder: string, description?: string) => {
    const result = await partsOps.createNewPart(folder, description)
    queuePendingCreate('part', result.filePath, result.partNumber)
    return result
  })

  ipcMain.handle('create-new-assembly', async (_e, parentFolder: string, name: string, description?: string) => {
    const result = await partsOps.createNewAssembly(parentFolder, name, description)
    queuePendingCreate('assembly', result.filePath, result.partNumber)
    return result
  })

  ipcMain.handle('connect-drive', async () => {
    return driveOps.connectDrive()
  })

  ipcMain.handle('disconnect-drive', async () => {
    await driveOps.disconnectDrive()
  })

  ipcMain.handle('get-drive-status', () => {
    return driveOps.getDriveStatus()
  })

  ipcMain.handle('sync-to-drive', async () => {
    return driveOps.syncToDrive()
  })

  ipcMain.handle('create-subsystem', async (_e, parentFolder: string, name: string) => {
    return partsOps.createSubsystem(parentFolder, name)
  })

  ipcMain.handle('get-recent-projects', async () => {
    return getRecentProjects()
  })

  ipcMain.handle('get-git-identity', async () => {
    return gitOps.getGitIdentity()
  })

  ipcMain.handle('set-git-identity', async (_e, name: string, email: string) => {
    await gitOps.setGitIdentity(name, email)
  })

  ipcMain.handle('close-project', () => {
    currentProject = null
    clearRestProject()
    stopWatching()
  })

  ipcMain.handle('get-app-version', () => app.getVersion())

  ipcMain.handle('check-dependencies', async () => depsOps.checkDependencies())

  ipcMain.handle('open-external', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle('get-admin-config', async () => {
    try { return await adminOps.loadAdminConfig() } catch { return {} }
  })

  ipcMain.handle('save-admin-config', async (_e, config) => {
    await adminOps.saveAndPublishAdminConfig(config)
    if (config?.mainRepoUrl) {
      try { await gitOps.setMainRemoteUrl(config.mainRepoUrl) } catch { /* leave to admin */ }
    }
  })

  ipcMain.handle('sync-cots', async () => {
    const config = await adminOps.loadAdminConfig()
    if (!config.cotsRepoUrl) return { success: false, error: 'No COTS repo configured' }
    return gitOps.syncCotsRepo(config.cotsRepoUrl, config.cotsBranch)
  })
}

export { stopWatching, stopRestServer }
