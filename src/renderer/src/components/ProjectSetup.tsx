import { useState, useEffect, useCallback, useRef } from 'react'
import { FilePlus2, Search, Download, FolderOpen, Factory, Pin, PinOff, X, ShieldCheck } from 'lucide-react'
import logoUrl from '../assets/logo.png'
import BrowseProjects from './BrowseProjects'
import type { GitHubAuthStatus, GlobalAdminConfig, ProjectConfig } from '@shared/types'

interface Props {
  onCreateProject: (name: string, path: string, remote: string, isCotsProject?: boolean) => Promise<void>
  onJoinProject: (url: string, path: string) => Promise<void>
  onOpenProject: (path: string) => Promise<void>
  /** Open the most recently used project and jump straight into the
   *  Manufacturing View (shop-floor mode). Disabled when there are no
   *  recent projects to open. */
  onEnterManufacturingView?: () => void
  /** Triggered by the unlocked Admin Panel button (9-click easter egg).
   *  Parent runs the existing PIN prompt → admin overlay flow. */
  onOpenAdmin?: () => void
  isLoading: boolean
  /**
   * Install-wide admin settings (Team + Browse). Used to enable the
   * welcome-screen Browse button and the org-aware Create flow.
   */
  globalAdmin?: GlobalAdminConfig
  /** When set, jump straight into the Join Project flow with this URL
   *  prefilled. Used by the trentcad:// deep-link handler so README
   *  "Open in TrentCAD" links land on a ready-to-go join form. */
  prefilledJoinUrl?: string | null
  /** Monotonic counter bumped on every deep-link arrival so the same
   *  URL can re-trigger the prefill (e.g. user backs out then clicks
   *  the link again). */
  prefilledJoinSeq?: number
}

type Mode = 'select' | 'create' | 'join' | 'open'

export default function ProjectSetup({ onCreateProject, onJoinProject, onOpenProject, onEnterManufacturingView, onOpenAdmin, isLoading, globalAdmin, prefilledJoinUrl, prefilledJoinSeq }: Props) {
  const [mode, setMode] = useState<Mode>('select')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [remote, setRemote] = useState('')
  const [url, setUrl] = useState('')
  // React to deep-link arrivals: prefill the join URL field and snap to
  // the join mode. Keyed on the seq counter so re-clicking the same
  // link still re-routes the user.
  useEffect(() => {
    if (prefilledJoinUrl) {
      setUrl(prefilledJoinUrl)
      setMode('join')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledJoinSeq, prefilledJoinUrl])
  const [isCotsProject, setIsCotsProject] = useState(false)
  const [recentProjects, setRecentProjects] = useState<ProjectConfig[]>([])
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus | null>(null)
  const [resetupMsg, setResetupMsg] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  // True between clicking "Sign in" and seeing the gh CLI flip to
  // logged-in. While true we auto-poll status every 3 s so most users
  // never need to click anything to confirm sign-in landed.
  const [signInPending, setSignInPending] = useState(false)
  const [showBrowse, setShowBrowse] = useState(false)
  const [creatingOnGitHub, setCreatingOnGitHub] = useState(false)
  const [createMsg, setCreateMsg] = useState<string | null>(null)

  const orgConfigured = (globalAdmin?.gitHubOrg || '').trim()
  const projectPrefix = (globalAdmin?.projectPrefix || '').trim()
  const canBrowse = !!orgConfigured && !!authStatus?.loggedIn

  const refreshAuth = useCallback(() => {
    window.api.githubAuthStatus().then(setAuthStatus).catch(() => {})
  }, [])

  useEffect(() => {
    window.api.getRecentProjects().then(setRecentProjects).catch(() => {})
    refreshAuth()
  }, [refreshAuth])

  const handleGitHubLogin = async () => {
    setLoggingIn(true)
    setResetupMsg(null)
    try {
      const result = await window.api.githubLogin()
      if (result.launched) {
        setSignInPending(true)
        setResetupMsg('Sign-in opened in a new window. Finish there — TrentCAD will detect it automatically.')
      } else if (result.error?.startsWith('MANUAL_SIGNIN_REQUIRED:')) {
        // Mac/Linux: we can't reliably spawn a terminal, so we tell the
        // user to run the command themselves. Strip the sentinel prefix.
        setSignInPending(true)
        setResetupMsg(result.error.slice('MANUAL_SIGNIN_REQUIRED:'.length))
      } else {
        setResetupMsg(result.error || 'Could not launch GitHub login')
      }
    } finally {
      setLoggingIn(false)
    }
  }

  // While sign-in is pending, poll auth status every 3 s so we can
  // auto-detect when the user completes sign-in in the other window.
  // Stops itself once we see loggedIn=true; bounded at ~2 minutes so we
  // don't poll forever if the user abandons sign-in.
  useEffect(() => {
    if (!signInPending) return
    let cancelled = false
    const start = Date.now()
    const interval = setInterval(async () => {
      if (cancelled || Date.now() - start > 120000) {
        setSignInPending(false)
        return
      }
      try {
        const status = await window.api.githubAuthStatus()
        if (cancelled) return
        setAuthStatus(status)
        if (status.loggedIn) {
          setSignInPending(false)
          setResetupMsg(`✓ Signed in as ${status.username}`)
        }
      } catch { /* ignore — try again next tick */ }
    }, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [signInPending])

  const handleBrowse = async () => {
    const dir = await window.api.selectDirectory()
    if (dir) setPath(dir)
  }

  const refreshRecents = useCallback(() => {
    window.api.getRecentProjects().then(setRecentProjects).catch(() => {})
  }, [])

  const handleBrowseAndOpen = async () => {
    const dir = await window.api.selectDirectory()
    if (dir) onOpenProject(dir)
  }

  const togglePin = useCallback(async (p: ProjectConfig) => {
    try {
      await window.api.setProjectPinned(p.path, !p.pinned)
      refreshRecents()
    } catch (err) {
      setResetupMsg(`Could not ${p.pinned ? 'unpin' : 'pin'} project: ${(err as Error).message}`)
    }
  }, [refreshRecents])

  const removeFromRecent = useCallback(async (p: ProjectConfig) => {
    try {
      await window.api.removeRecentProject(p.path)
      refreshRecents()
    } catch (err) {
      setResetupMsg(`Could not remove project: ${(err as Error).message}`)
    }
  }, [refreshRecents])

  const pinnedProjects = recentProjects.filter(p => p.pinned)
  const unpinnedProjects = recentProjects.filter(p => !p.pinned)

  // Easter-egg unlock: persisted in localStorage by AdminPage's
  // 9-click corner sequence. Once unlocked, the welcome screen shows
  // a permanent Admin Panel button.
  const [adminUnlocked, setAdminUnlocked] = useState(
    () => localStorage.getItem('trentcad-admin-shortcut-unlocked') === '1'
  )
  useEffect(() => {
    const recheck = () =>
      setAdminUnlocked(localStorage.getItem('trentcad-admin-shortcut-unlocked') === '1')
    // Same-window unlock (admin overlay closes back into the welcome
    // screen). storage events only fire cross-window, so AdminPage
    // dispatches a custom event we listen for here.
    window.addEventListener('admin-shortcut-unlocked', recheck)
    // Cross-window or external edit (rare).
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'trentcad-admin-shortcut-unlocked') recheck()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', recheck)
    return () => {
      window.removeEventListener('admin-shortcut-unlocked', recheck)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', recheck)
    }
  }, [])

  // Logo double-click easter egg
  const logoRef = useRef<HTMLImageElement | null>(null)
  const spinLogo = (cls: 'spinning' | 'flipping') => {
    const el = logoRef.current
    if (!el) return
    // Already animating — let it finish, ignore the extra click. Avoids
    // the visual glitch of class-toggling mid-animation.
    if (el.classList.contains('spinning') || el.classList.contains('flipping')) return
    el.classList.add(cls)
    const onEnd = () => {
      el.classList.remove(cls)
      el.removeEventListener('animationend', onEnd)
    }
    el.addEventListener('animationend', onEnd)
  }
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<number | null>(null)
  const onLogoClick = () => {
    clickCountRef.current += 1
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = window.setTimeout(() => {
      const n = clickCountRef.current
      clickCountRef.current = 0
      clickTimerRef.current = null
      if (n >= 3) spinLogo('flipping')
      else if (n === 2) spinLogo('spinning')
    }, 280)
  }

  if (mode === 'select') {
    return (
      <div className="setup-screen">
        {adminUnlocked && onOpenAdmin && (
          <button
            className="welcome-admin-btn"
            onClick={onOpenAdmin}
            title="Open the admin panel"
          >
            <ShieldCheck size={14} strokeWidth={1.75} />
            <span>Admin Panel</span>
          </button>
        )}
        <img
          ref={logoRef}
          className="setup-logo"
          src={logoUrl}
          alt="TrentCAD"
          onClick={onLogoClick}
        />
        <h1>TrentCAD</h1>
        <p className="subtitle">{globalAdmin?.teamName ? `CAD collaboration for ${globalAdmin.teamName}` : 'CAD collaboration for FRC teams'}</p>
        {pinnedProjects.length > 0 && (
          <div className="pinned-projects">
            {pinnedProjects.map(p => (
              <div key={p.path} className="pinned-project-card" title={p.path}>
                <button
                  type="button"
                  className="pinned-project-open"
                  onClick={() => onOpenProject(p.path)}
                  disabled={isLoading}
                >
                  <Pin size={18} strokeWidth={1.75} className="pinned-project-pin" />
                  <span className="pinned-project-name">{p.name}</span>
                  <span className="pinned-project-path">{p.path}</span>
                </button>
                <button
                  type="button"
                  className="pinned-project-unpin"
                  onClick={() => togglePin(p)}
                  title="Unpin from welcome screen"
                  aria-label="Unpin"
                >
                  <PinOff size={14} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="setup-cards">
          <button className="setup-card" onClick={() => setMode('create')}>
            <span className="card-icon"><FilePlus2 size={32} strokeWidth={1.5} /></span>
            <span className="card-title">Create Project</span>
            <span className="card-desc">Start a new CAD project<br />with version control</span>
          </button>
          <button
            className="setup-card"
            onClick={() => canBrowse ? setShowBrowse(true) : setMode('join')}
            disabled={!canBrowse && !authStatus?.loggedIn}
            title={canBrowse
              ? 'Browse team projects from GitHub'
              : authStatus?.loggedIn
                ? 'Admin hasn\'t configured a GitHub organisation — paste a URL instead'
                : 'Sign in to GitHub to browse team projects'}
          >
            <span className="card-icon">
              {canBrowse
                ? <Search size={32} strokeWidth={1.5} />
                : <Download size={32} strokeWidth={1.5} />}
            </span>
            <span className="card-title">{canBrowse ? 'Browse Projects' : 'Join Project'}</span>
            <span className="card-desc">{canBrowse
              ? <>List repos from<br />the {orgConfigured} org</>
              : <>Download a team project<br />from GitHub</>}</span>
          </button>
          <button className="setup-card" onClick={() => setMode('open')}>
            <span className="card-icon"><FolderOpen size={32} strokeWidth={1.5} /></span>
            <span className="card-title">Open Project</span>
            <span className="card-desc">Open an existing<br />project folder</span>
          </button>
          <button
            className="setup-card"
            onClick={() => onEnterManufacturingView?.()}
            disabled={!onEnterManufacturingView || recentProjects.length === 0}
            title={recentProjects.length === 0
              ? 'Open or create a project first — the manufacturing queue lives inside a project'
              : 'Shop-floor view: just what needs to be made'}
          >
            <span className="card-icon"><Factory size={32} strokeWidth={1.5} /></span>
            <span className="card-title">Manufacturing View</span>
            <span className="card-desc">Shop-floor queue<br />grouped by method</span>
          </button>
        </div>

        {showBrowse && orgConfigured && (
          <BrowseProjects
            org={orgConfigured}
            prefix={projectPrefix || undefined}
            onPick={(url, suggestedName) => {
              setShowBrowse(false)
              setUrl(url)
              setName(suggestedName)
              setMode('join')
            }}
            onClose={() => setShowBrowse(false)}
          />
        )}
        <div className="setup-toolbar">
          <div className="setup-auth">
            {authStatus?.loggedIn ? (
              <>
                <span className="setup-auth-status">
                  ✓ Signed in to GitHub as <strong>{authStatus.username}</strong>
                </span>
                <button
                  className="toolbar-btn"
                  onClick={async () => {
                    setResetupMsg(null)
                    const r = await window.api.githubLogout()
                    if (r.success) {
                      setResetupMsg('Signed out of GitHub.')
                      refreshAuth()
                    } else {
                      setResetupMsg(r.error || 'Could not sign out.')
                    }
                  }}
                  title="Sign out of GitHub on this computer"
                >
                  Sign out
                </button>
              </>
            ) : signInPending ? (
              // Sign-in launched, waiting for the user to finish in the
              // browser/terminal. We auto-poll every 3s; the manual refresh
              // button is here as a fallback if polling misses.
              <>
                <span className="setup-auth-status muted">
                  Waiting for sign-in to complete…
                </span>
                <button
                  className="toolbar-btn"
                  onClick={refreshAuth}
                >
                  I signed in — refresh
                </button>
              </>
            ) : (
              <>
                <span className="setup-auth-status muted">
                  {authStatus?.ghCliAvailable === false
                    ? 'GitHub CLI not detected — install to enable sign-in'
                    : 'Not signed in to GitHub'}
                </span>
                <button
                  className="toolbar-btn primary"
                  onClick={handleGitHubLogin}
                  disabled={loggingIn || authStatus?.ghCliAvailable === false}
                >
                  {loggingIn ? 'Opening…' : 'Sign in with GitHub'}
                </button>
              </>
            )}
          </div>
          {resetupMsg && <div className="setup-toolbar-msg">{resetupMsg}</div>}
        </div>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <h3>Recent Projects</h3>
            <div className="recent-list">
              {recentProjects.slice(0, 3).map(p => (
                <button
                  key={p.path}
                  className="recent-item"
                  onClick={() => onOpenProject(p.path)}
                  disabled={isLoading}
                >
                  <span className="recent-name">{p.name}</span>
                  <span className="recent-path">{p.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (mode === 'create') {
    return (
      <div className="setup-screen">
        <h1>Create Project</h1>
        <div className="setup-form">
          <div className="form-group">
            <label>Project Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="2026-Robot"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Location</label>
            <div className="path-input">
              <input value={path} onChange={e => setPath(e.target.value)} placeholder="C:\Users\team2129\Documents" />
              <button className="browse-btn" onClick={handleBrowse}>Browse</button>
            </div>
          </div>
          <div className="form-group">
            <label>GitHub URL (optional)</label>
            <input
              value={remote}
              onChange={e => setRemote(e.target.value)}
              placeholder="https://github.com/frc2129/2026-robot.git"
            />
            {orgConfigured && projectPrefix && name && authStatus?.loggedIn && (
              <p className="admin-hint">
                Or click <strong>Create on GitHub</strong> to auto-create
                <code> {orgConfigured}/{projectPrefix}{name.replace(/[^a-zA-Z0-9._-]/g, '-')}</code>
                so other team members can find it via Browse.
              </p>
            )}
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={isCotsProject}
              onChange={e => setIsCotsProject(e.target.checked)}
            />
            <span>
              <strong>COTS library project</strong>
              <span className="checkbox-hint">Holds shared off-the-shelf parts. No part numbers will be assigned.</span>
            </span>
          </label>
          {createMsg && <div className="setup-toolbar-msg">{createMsg}</div>}
          <div className="form-actions">
            <button className="toolbar-btn" onClick={() => setMode('select')}>Back</button>
            {orgConfigured && projectPrefix && authStatus?.loggedIn && (
              <button
                className="toolbar-btn"
                disabled={!name || !path || isLoading || creatingOnGitHub}
                onClick={async () => {
                  setCreatingOnGitHub(true)
                  setCreateMsg(null)
                  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '-')
                  const repoName = `${projectPrefix}${safeName}`
                  try {
                    const result = await window.api.createGitHubRepo(
                      orgConfigured, repoName, true, `TrentCAD project — ${name}`
                    )
                    if (!result.success || !result.url) {
                      setCreateMsg('✗ ' + (result.error || 'Could not create repo on GitHub'))
                      return
                    }
                    setCreateMsg(`✓ Created ${orgConfigured}/${repoName} — pushing local project...`)
                    await onCreateProject(name, `${path}/${name}`, result.url, isCotsProject)
                  } catch (err) {
                    setCreateMsg('✗ ' + (err as Error).message)
                  } finally {
                    setCreatingOnGitHub(false)
                  }
                }}
              >
                {creatingOnGitHub ? 'Creating on GitHub...' : 'Create on GitHub'}
              </button>
            )}
            <button
              className="toolbar-btn primary"
              disabled={!name || !path || isLoading}
              onClick={() => onCreateProject(name, `${path}/${name}`, remote, isCotsProject)}
            >
              {isLoading ? <span className="loading-spinner" /> : 'Create'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'join') {
    return (
      <div className="setup-screen">
        <h1>Join Project</h1>
        <div className="setup-form">
          <div className="form-group">
            <label>GitHub URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://github.com/frc2129/2026-robot.git"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Save To</label>
            <div className="path-input">
              <input value={path} onChange={e => setPath(e.target.value)} placeholder="C:\Users\team2129\Documents" />
              <button className="browse-btn" onClick={handleBrowse}>Browse</button>
            </div>
          </div>
          <div className="form-actions">
            <button className="toolbar-btn" onClick={() => setMode('select')}>Back</button>
            <button
              className="toolbar-btn primary"
              disabled={!url || !path || isLoading}
              onClick={() => onJoinProject(url, path)}
            >
              {isLoading ? <span className="loading-spinner" /> : 'Join'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="setup-screen">
      <h1>Open Project</h1>
      <p className="subtitle">Pick a recent project, or browse for a folder.</p>
      <div className="open-projects">
        {pinnedProjects.length > 0 && (
          <div className="open-projects-section">
            <div className="open-projects-section-label">Pinned</div>
            {pinnedProjects.map(p => (
              <ProjectRow
                key={p.path}
                project={p}
                disabled={isLoading}
                onOpen={() => onOpenProject(p.path)}
                onTogglePin={() => togglePin(p)}
                onRemove={() => removeFromRecent(p)}
              />
            ))}
          </div>
        )}
        {unpinnedProjects.length > 0 && (
          <div className="open-projects-section">
            <div className="open-projects-section-label">Recent</div>
            {unpinnedProjects.map(p => (
              <ProjectRow
                key={p.path}
                project={p}
                disabled={isLoading}
                onOpen={() => onOpenProject(p.path)}
                onTogglePin={() => togglePin(p)}
                onRemove={() => removeFromRecent(p)}
              />
            ))}
          </div>
        )}
        {recentProjects.length === 0 && (
          <div className="open-projects-empty">
            No recent projects yet. Browse for a folder below to open one.
          </div>
        )}
        <button
          className="open-projects-browse"
          onClick={handleBrowseAndOpen}
          disabled={isLoading}
        >
          <FolderOpen size={18} strokeWidth={1.75} />
          <span>Browse for a project folder…</span>
        </button>
      </div>
      <div className="form-actions">
        <button className="toolbar-btn" onClick={() => setMode('select')}>Back</button>
      </div>
    </div>
  )
}

interface ProjectRowProps {
  project: ProjectConfig
  disabled: boolean
  onOpen: () => void
  onTogglePin: () => void
  onRemove: () => void
}

function ProjectRow({ project, disabled, onOpen, onTogglePin, onRemove }: ProjectRowProps) {
  return (
    <div className="open-project-row">
      <button
        className="open-project-main"
        onClick={onOpen}
        disabled={disabled}
        title={project.path}
      >
        <span className="open-project-name">{project.name}</span>
        <span className="open-project-path">{project.path}</span>
      </button>
      <button
        className="open-project-action"
        onClick={onTogglePin}
        title={project.pinned ? 'Unpin' : 'Pin to top'}
      >
        {project.pinned
          ? <PinOff size={14} strokeWidth={1.75} />
          : <Pin size={14} strokeWidth={1.75} />}
      </button>
      <button
        className="open-project-action"
        onClick={onRemove}
        title="Remove from list"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}
