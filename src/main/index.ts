import { app, BrowserWindow, Menu, dialog } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { setupIpc, stopWatching, stopRestServer, isPublishing } from './ipc'
import { startRestServer } from './rest'
import { initAutoUpdater } from './updater'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'TrentCAD',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Drop the default Electron File/Edit/View menu so students don't see a
  // distracting menu bar — TrentCAD's own UI exposes everything they need
  Menu.setApplicationMenu(null)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('context-menu', (_e, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    ])
    menu.popup()
  })

  mainWindow.on('close', (e) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (isPublishing()) {
      e.preventDefault()
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Keep TrentCAD open', 'Close anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Upload in progress',
        message: 'TrentCAD is uploading parts to GitHub.',
        detail: 'Closing now will interrupt the upload. Files that have already been uploaded will be safe, but anything still in flight will need to be re-uploaded on the next attempt.'
      })
      if (choice === 1) {
        // User chose to close anyway — bypass the guard and force-destroy
        mainWindow.destroy()
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

setupIpc(() => mainWindow)

app.whenReady().then(() => {
  createWindow()
  startRestServer()
  initAutoUpdater(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWatching()
  stopRestServer()
  if (process.platform !== 'darwin') app.quit()
})
