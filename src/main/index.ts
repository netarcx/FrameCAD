import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { setupIpc, stopWatching, stopRestServer, isPublishing } from './ipc'
import { startRestServer } from './rest'
import { initAutoUpdater } from './updater'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

let mainWindow: BrowserWindow | null = null

// Holds a deep-link URL that arrived before the renderer was ready to
// receive it. Flushed by the renderer via `consume-pending-deep-link`
// once it has mounted.
let pendingDeepLink: string | null = null

function parseTrentCADUrl(rawUrl: string): { action: 'join'; url: string } | null {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'trentcad:') return null
    // Both `trentcad://join?url=...` (host=join) and `trentcad:join?url=...`
    // (pathname=join) are valid depending on the platform's URL parser.
    const action = u.hostname || u.pathname.replace(/^\/+/, '').split('/')[0]
    if (action === 'join') {
      const target = u.searchParams.get('url')
      if (!target) return null
      return { action: 'join', url: target }
    }
    return null
  } catch {
    return null
  }
}

function handleDeepLink(rawUrl: string | undefined): void {
  if (!rawUrl) return
  const parsed = parseTrentCADUrl(rawUrl)
  if (!parsed) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.webContents.send('deep-link', parsed)
  } else {
    // Renderer not ready yet — stash and let it pull on mount.
    pendingDeepLink = rawUrl
  }
}

// Register the trentcad:// scheme so README "Open in TrentCAD" links
// route back to the app. On Windows this writes to the registry on first
// run; on macOS it relies on Info.plist (set via electron-builder).
if (!app.isDefaultProtocolClient('trentcad')) {
  if (process.platform === 'win32' && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('trentcad', process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('trentcad')
  }
}

// Single-instance lock: a second launch (typically from a trentcad:// URL
// on Windows/Linux) shovels its argv into the existing instance.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // Focus the existing window even when there's no deep link — a user
    // double-clicking the icon expects the running app to come forward.
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const url = argv.find(a => a.startsWith('trentcad://'))
    handleDeepLink(url)
  })
}

// macOS delivers the URL via this event.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Layout floor: 180 (sidebar) + ~570 (file table + toolbar room)
    // + 320 (DetailsPanel) ≈ 1070. Bumped to 1100 to leave a comfort
    // margin so the toolbar buttons (Sync / Publish / + New) and the
    // file-table columns never collide. Height covers toolbar +
    // header + status bar with several visible rows.
    minWidth: 1100,
    minHeight: 720,
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

ipcMain.handle('consume-pending-deep-link', () => {
  if (!pendingDeepLink) return null
  const parsed = parseTrentCADUrl(pendingDeepLink)
  pendingDeepLink = null
  return parsed
})

app.whenReady().then(() => {
  // Cold launch from a deep link (Windows/Linux): URL arrives in argv.
  // Capture before createWindow so handleDeepLink can stash it for the
  // renderer to consume once mounted.
  if (process.platform !== 'darwin') {
    const url = process.argv.find(a => a.startsWith('trentcad://'))
    if (url) pendingDeepLink = url
  }
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
