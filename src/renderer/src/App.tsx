import { useMemo, useState, useEffect, useCallback } from 'react'
import { useGit } from './hooks/useGit'
import ProfileSetup from './components/ProfileSetup'
import ProjectSetup from './components/ProjectSetup'
import ProjectBrowser from './components/ProjectBrowser'
import Toolbar from './components/Toolbar'
import ActivityFeed from './components/ActivityFeed'
import DetailsPanel from './components/DetailsPanel'
import AdminPage from './components/AdminPage'
import AdminPinPrompt from './components/AdminPinPrompt'
import ManufacturingQueue from './components/ManufacturingQueue'
import OnboardingTour from './components/OnboardingTour'
import logoUrl from './assets/logo.png'
import type { AdminConfig, DependencyStatus, FileEntry, GlobalAdminConfig, ProjectTotals, PublishProgress, UpdateInfo } from '@shared/types'

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
    closeProject,
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
  const [appVersion, setAppVersion] = useState<string>('')
  const [adminConfig, setAdminConfig] = useState<AdminConfig>({})
  const [globalAdmin, setGlobalAdmin] = useState<GlobalAdminConfig>({})

  const refreshGlobalAdmin = useCallback(() => {
    window.api.getGlobalAdmin()
      .then(state => setGlobalAdmin(state.effective))
      .catch(() => {})
  }, [])
  const [showAdmin, setShowAdmin] = useState(false)
  const [adminPinPromptOpen, setAdminPinPromptOpen] = useState(false)
  const [showMfgQueue, setShowMfgQueue] = useState(false)
  const [ghLoggedIn, setGhLoggedIn] = useState(false)
  // Error-banner report state: 'idle' → 'confirm' → 'sending' → 'sent' | 'failed'
  const [reportState, setReportState] = useState<'idle' | 'confirm' | 'sending' | 'sent' | 'failed'>('idle')
  const [reportResult, setReportResult] = useState<{ url?: string; number?: number; error?: string }>({})

  // Refresh on every error so a stale logged-out state doesn't hide the
  // button. Always reset report state on error change (including
  // non-null -> non-null transitions) so a previous "sent" status from a
  // different error never leaks into the new banner.
  useEffect(() => {
    setReportState('idle')
    setReportResult({})
    if (!error) return
    window.api.githubAuthStatus()
      .then(s => setGhLoggedIn(!!s.loggedIn))
      .catch(() => setGhLoggedIn(false))
  }, [error])

  const submitReport = useCallback(async () => {
    if (!error) return
    setReportState('sending')
    try {
      const r = await window.api.reportIssue(error)
      if (r.success) {
        setReportResult({ url: r.url, number: r.number })
        setReportState('sent')
      } else {
        setReportResult({ error: r.error || 'Unknown error' })
        setReportState('failed')
      }
    } catch (err) {
      setReportResult({ error: (err as Error).message })
      setReportState('failed')
    }
  }, [error])
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    // Show the tour once per user (gate via localStorage)
    if (!localStorage.getItem('trentcad-onboarding-seen')) {
      setShowOnboarding(true)
    }
  }, [])

  const dismissOnboarding = useCallback(() => {
    localStorage.setItem('trentcad-onboarding-seen', '1')
    setShowOnboarding(false)
  }, [])
  const [missingDeps, setMissingDeps] = useState<DependencyStatus | null>(null)
  const [checkingDeps, setCheckingDeps] = useState(false)
  const [publishProgress, setPublishProgress] = useState<PublishProgress | null>(null)
  const [projectTotals, setProjectTotals] = useState<ProjectTotals | null>(null)

  useEffect(() => {
    const cleanup = window.api.onPublishProgress((p) => {
      setPublishProgress(p)
      if (p.phase === 'done' || p.phase === 'error') {
        // Auto-dismiss "done" after a short delay; keep "error" until user closes
        if (p.phase === 'done') {
          setTimeout(() => setPublishProgress(null), 2000)
        }
      }
    })
    return cleanup
  }, [])

  const recheckDeps = useCallback(() => {
    setCheckingDeps(true)
    window.api.checkDependencies().then(status => {
      setMissingDeps(!status.git.installed || !status.lfs.installed ? status : null)
    }).catch(() => {}).finally(() => setCheckingDeps(false))
  }, [])

  useEffect(() => {
    window.api.getAppVersion().then(setAppVersion).catch(() => {})
    recheckDeps()
  }, [recheckDeps])

  useEffect(() => {
    if (!project) {
      setAdminConfig({})
      return
    }
    window.api.getAdminConfig().then(c => setAdminConfig(c || {})).catch(() => {})
  }, [project])

  useEffect(() => {
    // Global admin (Team + Browse) is loaded at startup and refreshed
    // whenever the admin page closes. It applies to both the welcome
    // screen and the in-project view.
    refreshGlobalAdmin()
  }, [refreshGlobalAdmin])

  useEffect(() => {
    if (!project) {
      setProjectTotals(null)
      return
    }
    const refresh = () =>
      window.api.getProjectTotals().then(setProjectTotals).catch(() => setProjectTotals(null))
    refresh()
    // Files state changes whenever the watcher fires, but mass/cost lives in
    // the meta file the watcher doesn't follow; re-fetch every 5s while a
    // project is open so totals stay current after team uploads
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [project, files])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (showAdmin) {
          setShowAdmin(false)
          return
        }
        if (adminPinPromptOpen) return
        window.api.adminPinRequired().then(required => {
          if (required) {
            setAdminPinPromptOpen(true)
          } else {
            setShowAdmin(true)
          }
        }).catch(() => {
          // If we can't determine, fail closed and require the PIN
          setAdminPinPromptOpen(true)
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showAdmin, adminPinPromptOpen])
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('trentcad-theme')
    return stored === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('trentcad-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

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

  const errorBanner = error && (
    <div className="error-banner">
      <span className="error-banner-message" title={error}>{error}</span>
      <div className="error-banner-actions">
        {reportState === 'idle' && ghLoggedIn && (
          <button
            onClick={() => setReportState('confirm')}
            title="Open a GitHub issue with this error"
          >
            Report
          </button>
        )}
        {reportState === 'confirm' && (
          <>
            <span className="error-banner-prompt">Report to GitHub?</span>
            <button onClick={submitReport} className="primary">Yes</button>
            <button onClick={() => setReportState('idle')}>No</button>
          </>
        )}
        {reportState === 'sending' && (
          <span className="error-banner-prompt">Reporting…</span>
        )}
        {reportState === 'sent' && (
          reportResult.url
            ? <button
                onClick={() => reportResult.url && window.api.openExternal(reportResult.url)}
                title={reportResult.url}
              >
                ✓ Issue #{reportResult.number ?? '?'} →
              </button>
            : <span className="error-banner-prompt">✓ Reported</span>
        )}
        {reportState === 'failed' && (
          <span
            className="error-banner-prompt"
            title={reportResult.error}
          >
            ✗ Report failed
          </span>
        )}
        <button onClick={copyError} title="Copy error">Copy</button>
        <button onClick={dismissError}>{'×'}</button>
      </div>
    </div>
  )

  const updateBanner = updateInfo && (
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
  )

  if (!identityChecked) return null

  const versionCorner = appVersion && <div className="app-version-corner">v{appVersion}</div>

  const offlineBanner = offline && (
    <div className="offline-banner">
      You're offline — Download / Upload will fail until your connection is back. Local edits are safe.
    </div>
  )

  const onboardingModal = showOnboarding && (
    <OnboardingTour onClose={dismissOnboarding} />
  )

  const depsModal = missingDeps && (
    <div className="modal-overlay">
      <div className="modal deps-modal">
        <h2>Required software missing</h2>
        <p className="deps-intro">
          TrentCAD uses Git and Git LFS under the hood to manage CAD files.
          Install whichever is missing and click "Check again" to continue.
        </p>
        {!missingDeps.git.installed && (
          <div className="deps-row">
            <div>
              <strong>Git</strong>
              <div className="deps-sub">Not found in PATH</div>
            </div>
            <button className="toolbar-btn primary" onClick={() => window.api.openExternal('https://git-scm.com/download/win')}>
              Download Git
            </button>
          </div>
        )}
        {!missingDeps.lfs.installed && (
          <div className="deps-row">
            <div>
              <strong>Git LFS</strong>
              <div className="deps-sub">Not found in PATH</div>
            </div>
            <button className="toolbar-btn primary" onClick={() => window.api.openExternal('https://git-lfs.com')}>
              Download Git LFS
            </button>
          </div>
        )}
        <div className="actions">
          <button className="toolbar-btn primary" onClick={recheckDeps} disabled={checkingDeps}>
            {checkingDeps ? 'Checking...' : 'Check again'}
          </button>
        </div>
      </div>
    </div>
  )

  if (needsProfile || showProfileEdit) {
    return (
      <div className="app">
        {updateBanner}
        <ProfileSetup
          onComplete={handleProfileComplete}
          onCancel={needsProfile ? undefined : () => setShowProfileEdit(false)}
          initialName={gitName}
          initialEmail={gitEmail}
        />
        {depsModal}
        {offlineBanner}
        {onboardingModal}
        {versionCorner}
      </div>
    )
  }

  if (!project) {
    return (
      <div className="app">
        {updateBanner}
        {errorBanner}
        <ProjectSetup
          onCreateProject={createProject}
          onJoinProject={joinProject}
          onOpenProject={openProject}
          isLoading={isLoading}
          globalAdmin={globalAdmin}
        />
        {adminPinPromptOpen && (
          <AdminPinPrompt
            onClose={() => setAdminPinPromptOpen(false)}
            onSuccess={() => {
              setAdminPinPromptOpen(false)
              setShowAdmin(true)
            }}
          />
        )}
        {showAdmin && (
          <AdminPage
            hasProject={false}
            onClose={() => {
              setShowAdmin(false)
              refreshGlobalAdmin()
            }}
          />
        )}
        {depsModal}
        {offlineBanner}
        {onboardingModal}
        {versionCorner}
      </div>
    )
  }

  return (
    <div className="app">
      {updateBanner}
      {errorBanner}

      <div className="app-header">
        <img className="logo-img" src={logoUrl} alt="TrentCAD" />
        <span className="logo">TrentCAD</span>
        {appVersion && <span className="version">v{appVersion}</span>}
        <span className="divider" />
        <button
          className="project-name-btn"
          onClick={closeProject}
          title="Close this project and go back to the project picker"
        >
          {'←'} {project.name}
        </button>
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
          className="header-mfg-btn"
          onClick={() => setShowMfgQueue(true)}
          title="Manufacturing queue: see released parts ready for the shop"
        >
          Shop
        </button>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button
          className="user-badge"
          onClick={() => setShowProfileEdit(true)}
          title={`Signed in as ${gitName} (${gitEmail})`}
        >
          {gitName}
        </button>
        <span className="team-badge">{globalAdmin.teamName || 'FRC 2129'}</span>
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
        isCotsProject={adminConfig.isCotsProject}
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

      {adminPinPromptOpen && (
        <AdminPinPrompt
          onClose={() => setAdminPinPromptOpen(false)}
          onSuccess={() => {
            setAdminPinPromptOpen(false)
            setShowAdmin(true)
          }}
        />
      )}

      {showAdmin && (
        <AdminPage
          hasProject={!!project}
          onClose={() => {
            setShowAdmin(false)
            refreshGlobalAdmin()
            if (project) {
              window.api.getAdminConfig().then(c => setAdminConfig(c || {})).catch(() => {})
            }
          }}
        />
      )}

      {showMfgQueue && (
        <ManufacturingQueue onClose={() => setShowMfgQueue(false)} />
      )}

      {offlineBanner}
      {onboardingModal}

      {publishProgress && (
        <div className="modal-overlay">
          <div className="modal publish-progress-modal">
            <h2>
              {publishProgress.phase === 'preparing' && 'Preparing upload...'}
              {publishProgress.phase === 'uploading' && 'Uploading to GitHub'}
              {publishProgress.phase === 'done' && 'Upload complete'}
              {publishProgress.phase === 'error' && 'Upload failed'}
            </h2>
            {publishProgress.detail && <p className="publish-detail">{publishProgress.detail}</p>}
            {typeof publishProgress.percent === 'number' && (
              <div className="publish-progress-bar">
                <div className="publish-progress-fill" style={{ width: `${publishProgress.percent}%` }} />
                <span className="publish-progress-pct">{publishProgress.percent}%</span>
              </div>
            )}
            {publishProgress.files && publishProgress.files.length > 0 && (
              <div className="publish-file-list">
                <div className="publish-file-list-header">
                  {publishProgress.files.length} file{publishProgress.files.length === 1 ? '' : 's'} in this upload
                </div>
                <ul>
                  {publishProgress.files.slice(0, 30).map(f => (
                    <li key={f}>{f}</li>
                  ))}
                  {publishProgress.files.length > 30 && (
                    <li className="publish-file-more">+ {publishProgress.files.length - 30} more</li>
                  )}
                </ul>
              </div>
            )}
            {publishProgress.phase === 'error' && (
              <div className="admin-error">{publishProgress.error || 'Unknown error'}</div>
            )}
            <div className="actions">
              {publishProgress.phase === 'error' || publishProgress.phase === 'done' ? (
                <button className="toolbar-btn primary" onClick={() => setPublishProgress(null)}>Close</button>
              ) : (
                <button
                  className="toolbar-btn"
                  onClick={() => setPublishProgress(null)}
                  title="Hide this dialog. The upload keeps running in the background."
                >
                  Hide
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {depsModal}

      <div className="status-bar">
        {projectTotals && projectTotals.totalParts > 0 && (
          <>
            <span className="status-item robot-totals" title={`From ${projectTotals.partsWithMass} of ${projectTotals.totalParts} parts`}>
              <strong>Robot:</strong> {projectTotals.mass.toFixed(1)} lb
            </span>
            <span className="status-item robot-totals" title={`From ${projectTotals.partsWithCost} of ${projectTotals.totalParts} parts`}>
              <strong>$</strong>{projectTotals.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="status-sep" />
          </>
        )}
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
