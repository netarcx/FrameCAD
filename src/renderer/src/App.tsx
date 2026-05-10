import { useMemo, useState, useEffect, useCallback } from 'react'
import { useGit } from './hooks/useGit'
import ProfileSetup from './components/ProfileSetup'
import ProjectSetup from './components/ProjectSetup'
import ProjectBrowser from './components/ProjectBrowser'
import Toolbar from './components/Toolbar'
import ActivityFeed from './components/ActivityFeed'
import DetailsPanel from './components/DetailsPanel'
import type { FileEntry, UpdateInfo } from '@shared/types'

function countByState(files: FileEntry[], state: string): number {
  let count = 0
  for (const f of files) {
    if (!f.isDirectory && f.state === state) count++
    if (f.children) count += countByState(f.children, state)
  }
  return count
}

export default function App() {
  const {
    project,
    files,
    history,
    locks,
    isLoading,
    error,
    selectedFile,
    setSelectedFile,
    createProject,
    joinProject,
    openProject,
    sync,
    publish,
    checkOut,
    checkIn,
    createNewPart,
    createNewAssembly,
    createSubsystem,
    driveStatus,
    connectDrive,
    disconnectDrive,
    dismissError
  } = useGit()

  const [identityChecked, setIdentityChecked] = useState(false)
  const [needsProfile, setNeedsProfile] = useState(false)
  const [showProfileEdit, setShowProfileEdit] = useState(false)
  const [gitName, setGitName] = useState('')
  const [gitEmail, setGitEmail] = useState('')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    window.api.getGitIdentity().then(({ name, email }) => {
      setGitName(name)
      setGitEmail(email)
      setNeedsProfile(!name || !email)
      setIdentityChecked(true)
    }).catch(() => setIdentityChecked(true))
  }, [])

  useEffect(() => {
    const cleanups = [
      window.api.onUpdateAvailable((info) => setUpdateInfo(info)),
      window.api.onUpdateDownloadProgress(({ percent }) => setUpdateProgress(percent)),
      window.api.onUpdateDownloaded(() => {
        setUpdateProgress(null)
        setUpdateReady(true)
      })
    ]
    return () => cleanups.forEach(fn => fn())
  }, [])

  const handleProfileComplete = useCallback(() => {
    window.api.getGitIdentity().then(({ name, email }) => {
      setGitName(name)
      setGitEmail(email)
      setNeedsProfile(false)
      setShowProfileEdit(false)
    })
  }, [])

  const stats = useMemo(() => ({
    modified: countByState(files, 'modified'),
    untracked: countByState(files, 'untracked'),
    lockedByYou: countByState(files, 'locked-by-you'),
    lockedByOther: countByState(files, 'locked-by-other')
  }), [files])

  const copyError = () => {
    if (error) navigator.clipboard.writeText(error)
  }

  if (!identityChecked) return null

  if (needsProfile || showProfileEdit) {
    return (
      <div className="app">
        <ProfileSetup
          onComplete={handleProfileComplete}
          onCancel={needsProfile ? undefined : () => setShowProfileEdit(false)}
          initialName={gitName}
          initialEmail={gitEmail}
        />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="app">
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <div className="error-banner-actions">
              <button onClick={copyError} title="Copy error">Copy</button>
              <button onClick={dismissError}>{'×'}</button>
            </div>
          </div>
        )}
        <ProjectSetup
          onCreateProject={createProject}
          onJoinProject={joinProject}
          onOpenProject={openProject}
          isLoading={isLoading}
        />
      </div>
    )
  }

  return (
    <div className="app">
      {updateInfo && (
        <div className="update-banner">
          {updateReady ? (
            <>
              <span>Update v{updateInfo.version} ready to install</span>
              <button onClick={() => window.api.restartToUpdate()}>Restart Now</button>
            </>
          ) : updateProgress != null ? (
            <>
              <span>Downloading v{updateInfo.version}... {updateProgress}%</span>
              <div className="update-progress">
                <div className="update-progress-bar" style={{ width: `${updateProgress}%` }} />
              </div>
            </>
          ) : (
            <span>Update v{updateInfo.version} available — downloading...</span>
          )}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <div className="error-banner-actions">
            <button onClick={copyError} title="Copy error">Copy</button>
            <button onClick={dismissError}>{'×'}</button>
          </div>
        </div>
      )}

      <div className="app-header">
        <span className="logo">TrentCAD</span>
        <span className="divider" />
        <span className="project-name">{project.name}</span>
        <span className="spacer" />
        {driveStatus.configured && (
          <button
            className={`drive-badge ${driveStatus.connected ? 'connected' : ''}`}
            onClick={driveStatus.connected ? disconnectDrive : connectDrive}
            title={driveStatus.connected
              ? `Google Drive connected${driveStatus.lastSync ? ` — last sync: ${new Date(driveStatus.lastSync).toLocaleTimeString()}` : ''}`
              : 'Connect Google Drive'}
          >
            {driveStatus.connected ? 'Drive Connected' : 'Connect Drive'}
          </button>
        )}
        <button
          className="user-badge"
          onClick={() => setShowProfileEdit(true)}
          title={`Signed in as ${gitName} (${gitEmail})`}
        >
          {gitName}
        </button>
        <span className="team-badge">FRC 2129</span>
      </div>

      <Toolbar
        onSync={sync}
        onPublish={publish}
        onCheckOut={checkOut}
        onCheckIn={checkIn}
        onNewPart={createNewPart}
        onNewAssembly={createNewAssembly}
        onNewSubsystem={createSubsystem}
        selectedFile={selectedFile}
        isLoading={isLoading}
        hasProject={true}
      />

      <div className="app-body">
        <div className="file-panel">
          <ProjectBrowser
            files={files}
            selectedFile={selectedFile}
            onSelect={setSelectedFile}
            onCheckOut={checkOut}
            onCheckIn={checkIn}
          />
          <ActivityFeed history={history} />
        </div>
        <DetailsPanel
          file={selectedFile}
          onCheckOut={checkOut}
          onCheckIn={checkIn}
        />
      </div>

      <div className="status-bar">
        {stats.modified > 0 && (
          <span className="status-item">
            <span className="status-dot modified" />
            {stats.modified} modified
          </span>
        )}
        {stats.untracked > 0 && (
          <span className="status-item">
            <span className="status-dot untracked" />
            {stats.untracked} new
          </span>
        )}
        {stats.lockedByYou > 0 && (
          <span className="status-item">
            <span className="status-dot locked-by-you" />
            {stats.lockedByYou} checked out by you
          </span>
        )}
        {stats.lockedByOther > 0 && (
          <span className="status-item">
            <span className="status-dot locked-by-other" />
            {stats.lockedByOther} locked by others
          </span>
        )}
        {locks.length > 0 && (
          <span className="status-item">
            {locks.length} total lock{locks.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
