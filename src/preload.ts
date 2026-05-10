import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi } from '@shared/types'

const api: IpcApi = {
  createProject: (name, path, remote) =>
    ipcRenderer.invoke('create-project', name, path, remote),

  joinProject: (url, path) =>
    ipcRenderer.invoke('join-project', url, path),

  openProject: (path) =>
    ipcRenderer.invoke('open-project', path),

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

  getGitIdentity: () =>
    ipcRenderer.invoke('get-git-identity'),

  setGitIdentity: (name, email) =>
    ipcRenderer.invoke('set-git-identity', name, email),

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
  }
}

contextBridge.exposeInMainWorld('api', api)
