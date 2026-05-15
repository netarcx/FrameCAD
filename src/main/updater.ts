import { autoUpdater } from 'electron-updater'
import { ipcMain, BrowserWindow } from 'electron'

export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Treat -beta / -rc builds as valid updates. Combined with
  // electron-builder's `channel: latest` override, this means every
  // published build (stable or prerelease) is offered to all users.
  autoUpdater.allowPrerelease = true

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
    const message = err?.message || String(err)
    console.error('Auto-update error:', message)
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-error', { message })
    }
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
      const msg = (err as Error).message || ''
      // Common case: no GitHub release exists yet (fresh project / first
      // build that hasn't been published). electron-updater fails when
      // latest.yml / latest-mac.yml / latest-linux.yml can't be fetched.
      // Report it as a successful "no updates" check so the alert
      // doesn't scare the user.
      if (/404|not found|cannot find|latest.*yml|enotfound/i.test(msg)) {
        return {
          success: true,
          currentVersion: autoUpdater.currentVersion?.version || '',
          latestVersion: '',
          updateAvailable: false,
          noReleasesYet: true
        }
      }
      return { success: false, error: msg }
    }
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 3000)
}
