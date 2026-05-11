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

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err?.message || err)
  })

  ipcMain.handle('restart-to-update', () => {
    autoUpdater.quitAndInstall()
  })

  // Manual update check bound to Ctrl+Shift+R in the renderer.
  // Returns the latest version info or an error so the UI can show
  // "you're on the latest" vs "downloading" without ambiguity.
  ipcMain.handle('check-for-update', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      // result is UpdateCheckResult; .updateInfo.version is the available
      // version (which may equal the current version if up-to-date)
      const currentVersion = autoUpdater.currentVersion?.version || ''
      const latestVersion = result?.updateInfo?.version || ''
      const updateAvailable = !!latestVersion && latestVersion !== currentVersion
      return {
        success: true,
        currentVersion,
        latestVersion,
        updateAvailable
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 3000)
}
