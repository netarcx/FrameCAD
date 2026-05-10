import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import path from 'path'
import { watch } from 'chokidar'
import * as gitOps from './git'
import * as lockOps from './locking'
import { addRecentProject } from './config'
import type { ProjectConfig } from '@shared/types'

let watcher: ReturnType<typeof watch> | null = null

function debounce<T extends (...args: unknown[]) => unknown>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: unknown[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as unknown as T
}

function notifyFileChange(win: BrowserWindow): void {
  gitOps.getStatus().then(files => {
    win.webContents.send('file-change', files)
  }).catch(() => {})
}

function startWatching(dirPath: string, win: BrowserWindow): void {
  stopWatching()
  const debouncedNotify = debounce(() => notifyFileChange(win), 500)
  watcher = watch(dirPath, {
    ignored: [/(^|[/\\])\../, /node_modules/],
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

  ipcMain.handle('create-project', async (_e, name: string, dirPath: string, remote: string) => {
    await gitOps.createProject(name, dirPath, remote)
    currentProject = { name, path: dirPath, remote }
    await addRecentProject(currentProject)
    const win = getMainWindow()
    if (win) startWatching(dirPath, win)
  })

  ipcMain.handle('join-project', async (_e, url: string, dirPath: string) => {
    await gitOps.joinProject(url, dirPath)
    const name = path.basename(dirPath)
    currentProject = { name, path: dirPath, remote: url }
    await addRecentProject(currentProject)
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
    const win = getMainWindow()
    if (win) startWatching(dirPath, win)
    return currentProject
  })

  ipcMain.handle('sync', async () => {
    return gitOps.sync()
  })

  ipcMain.handle('publish', async (_e, message: string) => {
    return gitOps.publish(message)
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
}

export { stopWatching }
