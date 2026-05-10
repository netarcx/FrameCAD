import { autoUpdater } from 'electron-updater'
import { ipcMain, BrowserWindow } from 'electron'

export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-available', {
        version: info.version
      })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-download-progress', {
        percent: Math.round(progress.percent)
      })
    }
  })

  autoUpdater.on('update-downloaded', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-downloaded')
    }
  })

  ipcMain.handle('restart-to-update', () => {
    autoUpdater.quitAndInstall()
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 3000)
}
