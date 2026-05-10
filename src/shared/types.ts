export interface ProjectConfig {
  name: string
  path: string
  remote: string
  partPrefix?: string
}

export type FileState = 'synced' | 'modified' | 'untracked' | 'locked-by-you' | 'locked-by-other'

export interface FileEntry {
  path: string
  name: string
  isDirectory: boolean
  state: FileState
  lockedBy?: string
  partNumber?: string
  partDescription?: string
  children?: FileEntry[]
}

export interface LockInfo {
  path: string
  owner: string
  id: string
}

export interface HistoryEntry {
  hash: string
  message: string
  author: string
  date: string
  files: string[]
}

export interface PublishResult {
  success: boolean
  hash?: string
  error?: string
}

export interface SyncResult {
  success: boolean
  filesUpdated: number
  error?: string
}

export interface GitStatusFile {
  path: string
  index: string
  working_dir: string
}

export type PartType = 'part' | 'assembly' | 'drawing'

export interface PartEntry {
  partNumber: string
  assignedAt: string
  type: PartType
  description?: string
  linkedTo?: string
}

export interface PartsManifest {
  prefix: string
  nextCounters: Record<string, number>
  nextAssemblyCounters: Record<string, number>
  entries: Record<string, PartEntry>
  assemblies: Record<string, string>
}

export interface DriveStatus {
  connected: boolean
  configured: boolean
  folderUrl?: string
  lastSync?: string
}

export interface DriveSyncResult {
  success: boolean
  filesUploaded: number
  error?: string
}

export interface AppState {
  currentProject: ProjectConfig | null
  files: FileEntry[]
  locks: LockInfo[]
  history: HistoryEntry[]
  isLoading: boolean
  error: string | null
}

export interface IpcApi {
  createProject(name: string, path: string, remote: string): Promise<void>
  joinProject(url: string, path: string): Promise<void>
  openProject(path: string): Promise<ProjectConfig>
  sync(): Promise<SyncResult>
  publish(message: string): Promise<PublishResult>
  getStatus(): Promise<FileEntry[]>
  getHistory(limit?: number): Promise<HistoryEntry[]>
  checkOut(filePath: string): Promise<void>
  checkIn(filePath: string): Promise<void>
  getLocks(): Promise<LockInfo[]>
  selectDirectory(): Promise<string | null>
  openFileExplorer(path: string): Promise<void>
  getProjectConfig(): Promise<ProjectConfig | null>
  getPartsManifest(): Promise<PartsManifest | null>
  createNewPart(folder: string, description?: string): Promise<{ partNumber: string; filePath: string }>
  createNewAssembly(parentFolder: string, name: string, description?: string): Promise<{ partNumber: string; filePath: string }>
  connectDrive(): Promise<{ success: boolean; error?: string }>
  disconnectDrive(): Promise<void>
  getDriveStatus(): Promise<DriveStatus>
  syncToDrive(): Promise<DriveSyncResult>
  onFileChange(callback: (files: FileEntry[]) => void): () => void
  onError(callback: (error: string) => void): () => void
}

declare global {
  interface Window {
    api: IpcApi
  }
}
