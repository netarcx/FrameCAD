import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi } from '@shared/types'

const api: IpcApi = {
  createProject: (name, path, remote) =>
    ipcRenderer.invoke('create-project', name, path, remote),

  joinProject: (url, path) =>
    ipcRenderer.invoke('join-project', url, path),

  openProject: (path) =>
    ipcRenderer.invoke('open-project', path),

  closeProject: () =>
    ipcRenderer.invoke('close-project'),

  sync: () =>
    ipcRenderer.invoke('sync'),

  publish: (message) =>
    ipcRenderer.invoke('publish', message),

  getStatus: () =>
    ipcRenderer.invoke('get-status'),

  getHistory: (limit?) =>
    ipcRenderer.invoke('get-history', limit),

  checkOut: (filePath) =>
    ipcRenderer.invoke('check-out', filePath),

  checkIn: (filePath) =>
    ipcRenderer.invoke('check-in', filePath),

  getLocks: () =>
    ipcRenderer.invoke('get-locks'),

  selectDirectory: () =>
    ipcRenderer.invoke('select-directory'),

  openFileExplorer: (path) =>
    ipcRenderer.invoke('open-file-explorer', path),

  getProjectConfig: () =>
    ipcRenderer.invoke('get-project-config'),

  getPartsManifest: () =>
    ipcRenderer.invoke('get-parts-manifest'),

  createNewPart: (folder, description?) =>
    ipcRenderer.invoke('create-new-part', folder, description),

  createNewAssembly: (parentFolder, name, description?) =>
    ipcRenderer.invoke('create-new-assembly', parentFolder, name, description),

  connectDrive: () =>
    ipcRenderer.invoke('connect-drive'),

  disconnectDrive: () =>
    ipcRenderer.invoke('disconnect-drive'),

  getDriveStatus: () =>
    ipcRenderer.invoke('get-drive-status'),

  syncToDrive: () =>
    ipcRenderer.invoke('sync-to-drive'),

  getRecentProjects: () =>
    ipcRenderer.invoke('get-recent-projects'),

  createSubsystem: (parentFolder, name) =>
    ipcRenderer.invoke('create-subsystem', parentFolder, name),

  getGitIdentity: () =>
    ipcRenderer.invoke('get-git-identity'),

  setGitIdentity: (name, email) =>
    ipcRenderer.invoke('set-git-identity', name, email),

  restartToUpdate: () =>
    ipcRenderer.invoke('restart-to-update'),

  getAppVersion: () =>
    ipcRenderer.invoke('get-app-version'),

  checkDependencies: () =>
    ipcRenderer.invoke('check-dependencies'),

  openExternal: (url) =>
    ipcRenderer.invoke('open-external', url),

  getAdminConfig: () =>
    ipcRenderer.invoke('get-admin-config'),

  saveAdminConfig: (config) =>
    ipcRenderer.invoke('save-admin-config', config),

  syncCots: () =>
    ipcRenderer.invoke('sync-cots'),

  onFileChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, files: unknown) =>
      callback(files as Parameters<typeof callback>[0])
    ipcRenderer.on('file-change', handler)
    return () => ipcRenderer.removeListener('file-change', handler)
  },

  onError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) =>
      callback(error)
    ipcRenderer.on('error', handler)
    return () => ipcRenderer.removeListener('error', handler)
  },

  onUpdateAvailable: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown) =>
      callback(info as Parameters<typeof callback>[0])
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },

  onUpdateDownloadProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      callback(progress as Parameters<typeof callback>[0])
    ipcRenderer.on('update-download-progress', handler)
    return () => ipcRenderer.removeListener('update-download-progress', handler)
  },

  onUpdateDownloaded: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
