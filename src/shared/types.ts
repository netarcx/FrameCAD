export interface ProjectConfig {
  name: string
  path: string
  remote: string
  partPrefix?: string
}

export type FileState = 'synced' | 'modified' | 'untracked' | 'locked-by-you' | 'locked-by-other'

export type ReleaseState = 'draft' | 'in-review' | 'released' | 'manufactured'

export interface PartComment {
  id: string
  author: string
  text: string
  at: string
}

export interface PartReleaseInfo {
  state: ReleaseState
  by?: string
  at?: string
  note?: string
}

export interface PartMeta {
  release?: PartReleaseInfo
  comments?: PartComment[]
  manufacturingNotes?: string
}

export interface FileEntry {
  path: string
  name: string
  isDirectory: boolean
  state: FileState
  lockedBy?: string
  partNumber?: string
  partDescription?: string
  releaseState?: ReleaseState
  commentCount?: number
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

export interface UpdateInfo {
  version: string
}

export interface PublishProgress {
  phase: 'preparing' | 'uploading' | 'done' | 'error'
  files?: string[]
  percent?: number
  detail?: string
  error?: string
}

export interface DependencyStatus {
  git: { installed: boolean; version?: string }
  lfs: { installed: boolean; version?: string }
}

export interface GitHubAuthStatus {
  ghCliAvailable: boolean
  loggedIn: boolean
  username?: string
}

export interface AdminConfig {
  teamName?: string
  welcomeMessage?: string
  defaultPartPrefix?: string
  mainRepoUrl?: string
  cotsRepoUrl?: string
  cotsBranch?: string
  isCotsProject?: boolean
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
  createProject(name: string, path: string, remote: string, isCotsProject?: boolean): Promise<void>
  joinProject(url: string, path: string): Promise<void>
  openProject(path: string): Promise<ProjectConfig>
  closeProject(): Promise<void>
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
  getRecentProjects(): Promise<ProjectConfig[]>
  createSubsystem(parentFolder: string, name: string): Promise<{ folderPath: string }>
  getGitIdentity(): Promise<{ name: string; email: string }>
  setGitIdentity(name: string, email: string): Promise<void>
  restartToUpdate(): Promise<void>
  getAppVersion(): Promise<string>
  checkDependencies(): Promise<DependencyStatus>
  openExternal(url: string): Promise<void>
  githubAuthStatus(): Promise<GitHubAuthStatus>
  githubLogin(): Promise<{ launched: boolean; error?: string }>
  gitResetup(): Promise<{ success: boolean; messages: string[]; error?: string }>
  getAdminConfig(): Promise<AdminConfig>
  saveAdminConfig(config: AdminConfig): Promise<void>
  syncCots(): Promise<{ success: boolean; cloned?: boolean; error?: string }>
  createProgressTag(name: string, message?: string): Promise<{ success: boolean; error?: string }>
  getMainRemoteUrl(): Promise<string>
  getPartMeta(filePath: string): Promise<PartMeta>
  setReleaseState(filePath: string, state: ReleaseState, note?: string): Promise<void>
  addComment(filePath: string, text: string): Promise<void>
  setManufacturingNotes(filePath: string, notes: string): Promise<void>
  onFileChange(callback: (files: FileEntry[]) => void): () => void
  onError(callback: (error: string) => void): () => void
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
  onUpdateDownloadProgress(callback: (progress: { percent: number }) => void): () => void
  onUpdateDownloaded(callback: () => void): () => void
  onPublishProgress(callback: (progress: PublishProgress) => void): () => void
}

declare global {
  interface Window {
    api: IpcApi
  }
}
