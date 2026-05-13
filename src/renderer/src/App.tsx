import { useMemo, useState, useEffect, useCallback } from 'react'
import { ChevronLeft, Sun, Moon, X } from 'lucide-react'
import { useGit } from './hooks/useGit'
import { DEFAULT_MATERIALS, DEFAULT_MATERIALS_DATALIST_ID } from './constants'
import useParts from './hooks/useParts'
import ProfileSetup from './components/ProfileSetup'
import ProjectSetup from './components/ProjectSetup'
import ProjectBrowser from './components/ProjectBrowser'
import Toolbar from './components/Toolbar'
import DetailsPanel from './components/DetailsPanel'
import AdminPage from './components/AdminPage'
import AdminPinPrompt from './components/AdminPinPrompt'
import ManufacturingQueue from './components/ManufacturingQueue'
import ManufacturingModeShell from './components/ManufacturingModeShell'
import OnboardingTour from './components/OnboardingTour'
import Sidebar, { type SidebarSection } from './components/Sidebar'
import ActivityView from './components/ActivityView'
import PartsManager from './components/PartsManager'
import ApprovalsPanel from './components/ApprovalsPanel'
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

  // Welcome-screen admin (kept for when no project is open)
  const [showAdmin, setShowAdmin] = useState(false)
  const [adminPinPromptOpen, setAdminPinPromptOpen] = useState(false)

  // Sidebar navigation (project view)
  const [activeSection, setActiveSection] = useState<SidebarSection>('files')
  const [inspectorOpen, setInspectorOpen] = useState(true)

  const [manufacturingView, setManufacturingView] = useState(false)

  useEffect(() => {
    if (manufacturingView && !project) {
      setManufacturingView(false)
    }
  }, [manufacturingView, project])

  // trentcad:// deep-link → prefill the Join Project URL field. Bumped
  // by sequence number so the same URL can re-trigger after the user
  // dismisses it. Pulled once on mount (cold launch) and on every
  // subsequent deep-link event (warm app).
  const [deepLinkJoinUrl, setDeepLinkJoinUrl] = useState<string | null>(null)
  const [deepLinkSeq, setDeepLinkSeq] = useState(0)
  useEffect(() => {
    window.api.consumePendingDeepLink().then(payload => {
      if (payload?.action === 'join' && payload.url) {
        setDeepLinkJoinUrl(payload.url)
        setDeepLinkSeq(s => s + 1)
      }
    }).catch(() => {})
    const cleanup = window.api.onDeepLink(payload => {
      if (payload?.action === 'join' && payload.url) {
        setDeepLinkJoinUrl(payload.url)
        setDeepLinkSeq(s => s + 1)
      }
    })
    return cleanup
  }, [])

  const [ghLoggedIn, setGhLoggedIn] = useState(false)
  const [reportState, setReportState] = useState<'idle' | 'confirm' | 'sending' | 'sent' | 'failed'>('idle')
  const [reportResult, setReportResult] = useState<{ url?: string; number?: number; error?: string }>({})

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
  const [progressHidden, setProgressHidden] = useState(false)
  const [progressKind, setProgressKind] = useState<'publish' | 'join'>('publish')
  const [projectTotals, setProjectTotals] = useState<ProjectTotals | null>(null)

  useEffect(() => {
    const cleanupPublish = window.api.onPublishProgress((p) => {
      setProgressKind('publish')
      setPublishProgress(p)
      if (p.phase === 'error' || p.phase === 'preparing') {
        setProgressHidden(false)
      }
      if (p.phase === 'done') {
        setTimeout(() => {
          setPublishProgress(null)
          setProgressHidden(false)
        }, 2000)
      }
    })
    const cleanupJoin = window.api.onJoinProgress((p) => {
      setProgressKind('join')
      setPublishProgress(p)
      if (p.phase === 'error' || p.phase === 'preparing') {
        setProgressHidden(false)
      }
      if (p.phase === 'done') {
        setTimeout(() => {
          setPublishProgress(null)
          setProgressHidden(false)
        }, 2000)
      }
    })
    return () => { cleanupPublish(); cleanupJoin() }
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

  const refreshAdminConfig = useCallback(() => {
    if (!project) {
      setAdminConfig({})
      return
    }
    window.api.getAdminConfig().then(c => setAdminConfig(c || {})).catch(() => {})
  }, [project])

  useEffect(() => {
    refreshAdminConfig()
  }, [refreshAdminConfig])

  useEffect(() => {
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
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [project])

  const openAdminOverlay = useCallback(() => {
    if (showAdmin) return
    if (adminPinPromptOpen) return
    window.api.adminPinRequired().then(required => {
      if (required) {
        setAdminPinPromptOpen(true)
      } else {
        setShowAdmin(true)
      }
    }).catch(() => {
      setAdminPinPromptOpen(true)
    })
  }, [showAdmin, adminPinPromptOpen])

  const handleSidebarSelect = useCallback((section: SidebarSection) => {
    if (section === 'admin') {
      openAdminOverlay()
    } else {
      setActiveSection(section)
    }
  }, [openAdminOverlay])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        ;(async () => {
          try {
            const r = await window.api.checkForUpdate()
            if (!r.success) {
              alert(`Could not check for updates: ${r.error || 'unknown error'}`)
            } else if (r.updateAvailable) {
              alert(`Update available — v${r.latestVersion} is downloading in the background.`)
            } else {
              alert(`You're on the latest version (v${r.currentVersion}).`)
            }
          } catch (err) {
            alert(`Could not check for updates: ${(err as Error).message}`)
          }
        })()
        return
      }
      // Ctrl+Shift+A: toggle the Admin overlay (works in welcome and project views)
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (showAdmin) {
          setShowAdmin(false)
          return
        }
        openAdminOverlay()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showAdmin, openAdminOverlay])

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

  // Parts data for the sidebar badge + Parts/Approvals views
  const parts = useParts({ enabled: !!project })

  const stats = useMemo(() => ({
    modified: countByState(files, 'modified'),
    untracked: countByState(files, 'untracked'),
    lockedByYou: countByState(files, 'locked-by-you'),
    lockedByOther: countByState(files, 'locked-by-other')
  }), [files])

  const sidebarBadges = useMemo(() => {
    const filesBadge = stats.modified + stats.untracked
    return {
      files: filesBadge > 0 ? filesBadge : undefined,
      parts: parts.inReviewParts.length > 0 ? parts.inReviewParts.length : undefined
    }
  }, [stats, parts.inReviewParts.length])

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
                Issue #{reportResult.number ?? '?'}
              </button>
            : <span className="error-banner-prompt">Reported</span>
        )}
        {reportState === 'failed' && (
          <span
            className="error-banner-prompt"
            title={reportResult.error}
          >
            Report failed
          </span>
        )}
        <button onClick={copyError} title="Copy error">Copy</button>
        <button onClick={dismissError} className="error-banner-close" title="Dismiss">
          <X size={14} strokeWidth={2} />
        </button>
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

  const progressModal = publishProgress && !progressHidden && (
    <div className="modal-overlay">
      <div className="modal publish-progress-modal">
        <h2>
          {publishProgress.phase === 'preparing' && (progressKind === 'join' ? 'Preparing download…' : 'Preparing upload...')}
          {publishProgress.phase === 'uploading' && (progressKind === 'join' ? 'Downloading from GitHub' : 'Uploading to GitHub')}
          {publishProgress.phase === 'done' && (progressKind === 'join' ? 'Download complete' : 'Upload complete')}
          {publishProgress.phase === 'error' && (progressKind === 'join' ? 'Download failed' : 'Upload failed')}
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
            <button
              className="toolbar-btn primary"
              onClick={() => { setPublishProgress(null); setProgressHidden(false) }}
            >
              Close
            </button>
          ) : (
            <button
              className="toolbar-btn"
              onClick={() => setProgressHidden(true)}
              title="Move this dialog to a strip at the bottom of the window. Upload keeps running."
            >
              Hide
            </button>
          )}
        </div>
      </div>
    </div>
  )

  // ── Profile setup (first launch) ──
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

  // ── Welcome screen (no project open) ──
  if (!project) {
    return (
      <div className="app">
        <datalist id={DEFAULT_MATERIALS_DATALIST_ID}>
          {DEFAULT_MATERIALS.map(m => <option key={m} value={m} />)}
        </datalist>
        {updateBanner}
        {errorBanner}
        <ProjectSetup
          onCreateProject={createProject}
          onJoinProject={joinProject}
          onOpenProject={openProject}
          prefilledJoinUrl={deepLinkJoinUrl}
          prefilledJoinSeq={deepLinkSeq}
          onEnterManufacturingView={async () => {
            try {
              const recents = await window.api.getRecentProjects()
              if (recents.length === 0) return
              await openProject(recents[0].path)
              setManufacturingView(true)
            } catch {
              // openProject surfaces errors via the error banner
            }
          }}
          onOpenAdmin={openAdminOverlay}
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
            appVersion={appVersion}
            gitName={gitName}
            gitEmail={gitEmail}
            onProfileUpdate={handleProfileComplete}
            onClose={() => {
              setShowAdmin(false)
              refreshGlobalAdmin()
            }}
          />
        )}
        {depsModal}
        {offlineBanner}
        {onboardingModal}
        {progressModal}
        {versionCorner}
      </div>
    )
  }

  // ── Shop-floor kiosk mode ──
  if (manufacturingView && project) {
    return (
      <ManufacturingModeShell
        project={project}
        onSwitchProject={async (targetPath) => {
          try {
            await closeProject()
            await openProject(targetPath)
          } catch {
            setManufacturingView(false)
          }
        }}
        onExit={() => { setManufacturingView(false); closeProject() }}
      />
    )
  }

  // ── Main project view (sidebar layout) ──
  const showInspector = (activeSection === 'files' || activeSection === 'parts') && inspectorOpen

  const materialDatalist = (
    <datalist id={DEFAULT_MATERIALS_DATALIST_ID}>
      {DEFAULT_MATERIALS.map(m => <option key={m} value={m} />)}
    </datalist>
  )

  return (
    <div className="app">
      {materialDatalist}
      {updateBanner}
      {errorBanner}

      <div className="app-header">
        <img className="logo-img" src={logoUrl} alt="TrentCAD" />
        <span className="logo">TrentCAD</span>
        <span className="divider" />
        <button
          className="back-btn"
          onClick={() => { setActiveSection('files'); closeProject() }}
          title="Close this project and go back to the project picker"
        >
          <ChevronLeft size={16} strokeWidth={2} />
          <span>Back</span>
        </button>
        <span className="project-name-label" title={project.path}>{project.name}</span>
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
          className="theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark'
            ? <Sun size={16} strokeWidth={1.75} />
            : <Moon size={16} strokeWidth={1.75} />}
        </button>
        <button
          className="user-badge"
          onClick={() => setShowProfileEdit(true)}
          title={`Signed in as ${gitName} (${gitEmail})`}
        >
          {gitName}
        </button>
      </div>

      <Toolbar
        onSync={sync}
        onPublish={publish}
        onNewPart={createNewPart}
        onNewAssembly={createNewAssembly}
        onNewSubsystem={createSubsystem}
        selectedFile={selectedFile}
        isLoading={isLoading}
        hasProject={true}
        isCotsProject={adminConfig.isCotsProject}
        activeSection={activeSection}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen(o => !o)}
      />

      <div className="app-main">
        <Sidebar
          active={activeSection}
          onSelect={handleSidebarSelect}
          badges={sidebarBadges}
        />

        <div className="app-content">
          {activeSection === 'files' && (
            <ProjectBrowser
              files={files}
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
              onCheckOut={checkOut}
              onCheckIn={checkIn}
            />
          )}

          {activeSection === 'parts' && (
            <div className="parts-content">
              {parts.error && <div className="admin-error" style={{ margin: '8px 16px' }}>{parts.error}</div>}
              <div className="parts-content-tabs">
                <button
                  className={`parts-tab${parts.stateFilter !== 'in-review' ? ' active' : ''}`}
                  onClick={() => parts.setStateFilter('all')}
                >
                  All Parts
                </button>
                <button
                  className={`parts-tab${parts.stateFilter === 'in-review' ? ' active' : ''}`}
                  onClick={() => parts.setStateFilter('in-review')}
                >
                  Needs Review {parts.inReviewCount > 0 && <span className="parts-tab-badge">{parts.inReviewCount}</span>}
                </button>
              </div>
              <div className="parts-panel">
                {parts.stateFilter === 'in-review' ? (
                  <ApprovalsPanel
                    parts={parts.inReviewParts}
                    onApprove={(p) => parts.setReleaseState(p, 'released')}
                    onReject={(p) => parts.setReleaseState(p, 'draft')}
                    onRefresh={parts.loadAllParts}
                  />
                ) : (
                  <PartsManager
                    loading={parts.loading}
                    parts={parts.filteredParts}
                    allParts={parts.allParts}
                    filter={parts.filter}
                    setFilter={parts.setFilter}
                    subsystem={parts.subsystem}
                    setSubsystem={parts.setSubsystem}
                    subsystemOptions={parts.subsystemOptions}
                    state={parts.stateFilter}
                    setState={parts.setStateFilter}
                    pendingCount={parts.pendingCount}
                    flushing={parts.flushing}
                    flushNow={parts.flushNow}
                    onRefresh={parts.loadAllParts}
                    onSetRelease={parts.setReleaseState}
                    onSetMethod={parts.setMethod}
                    onSetMaterial={parts.setMaterial}
                    onSetMass={parts.setMass}
                    onSetCost={parts.setCost}
                    onBulkApply={parts.bulkApply}
                  />
                )}
              </div>
            </div>
          )}

          {activeSection === 'activity' && (
            <ActivityView history={history} />
          )}

          {activeSection === 'shop' && (
            <ManufacturingQueue embedded onClose={() => setActiveSection('files')} />
          )}
        </div>

        {showInspector && (
          <DetailsPanel
            file={selectedFile}
            onCheckOut={checkOut}
            onCheckIn={checkIn}
          />
        )}
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
          hasProject={true}
          appVersion={appVersion}
          gitName={gitName}
          gitEmail={gitEmail}
          onProfileUpdate={handleProfileComplete}
          onClose={() => {
            setShowAdmin(false)
            refreshGlobalAdmin()
            // Pick up any per-project AdminConfig changes (e.g. COTS
            // toggle, mainRepoUrl) that the user just edited.
            refreshAdminConfig()
          }}
        />
      )}

      {offlineBanner}
      {onboardingModal}

      {progressModal}

      {publishProgress && progressHidden && (
        <button
          type="button"
          className="publish-mini-bar"
          onClick={() => setProgressHidden(false)}
          title="Click to expand the upload details"
        >
          <span className="publish-mini-bar-title">
            {publishProgress.phase === 'preparing' && (progressKind === 'join' ? 'Preparing download…' : 'Preparing upload…')}
            {publishProgress.phase === 'uploading' && (progressKind === 'join' ? 'Downloading from GitHub' : 'Uploading to GitHub')}
            {publishProgress.phase === 'done' && (progressKind === 'join' ? 'Download complete' : 'Upload complete')}
            {publishProgress.phase === 'error' && (progressKind === 'join' ? 'Download failed' : 'Upload failed')}
          </span>
          {publishProgress.detail && (
            <span className="publish-mini-bar-detail">{publishProgress.detail}</span>
          )}
          {typeof publishProgress.percent === 'number' && (
            <span className="publish-mini-bar-track">
              <span
                className="publish-mini-bar-fill"
                style={{ width: `${publishProgress.percent}%` }}
              />
            </span>
          )}
          {typeof publishProgress.percent === 'number' && (
            <span className="publish-mini-bar-pct">{publishProgress.percent}%</span>
          )}
          <span className="publish-mini-bar-expand">Show</span>
        </button>
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
