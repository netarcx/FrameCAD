import { useState, useEffect, useCallback } from 'react'
import logoUrl from '../assets/logo.png'
import BrowseProjects from './BrowseProjects'
import type { AdminConfig, GitHubAuthStatus, ProjectConfig } from '@shared/types'

interface Props {
  onCreateProject: (name: string, path: string, remote: string, isCotsProject?: boolean) => Promise<void>
  onJoinProject: (url: string, path: string) => Promise<void>
  onOpenProject: (path: string) => Promise<void>
  isLoading: boolean
  /**
   * Most recently joined project's admin config. We fetch it from the user's
   * latest project so the welcome screen can show Browse / org-aware Create
   * before they've opened anything.
   */
  fallbackAdminConfig?: AdminConfig
}

type Mode = 'select' | 'create' | 'join' | 'open'

export default function ProjectSetup({ onCreateProject, onJoinProject, onOpenProject, isLoading, fallbackAdminConfig }: Props) {
  const [mode, setMode] = useState<Mode>('select')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [remote, setRemote] = useState('')
  const [url, setUrl] = useState('')
  const [isCotsProject, setIsCotsProject] = useState(false)
  const [recentProjects, setRecentProjects] = useState<ProjectConfig[]>([])
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus | null>(null)
  const [resetupMsg, setResetupMsg] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showBrowse, setShowBrowse] = useState(false)
  const [creatingOnGitHub, setCreatingOnGitHub] = useState(false)
  const [createMsg, setCreateMsg] = useState<string | null>(null)

  const orgConfigured = (fallbackAdminConfig?.gitHubOrg || '').trim()
  const projectPrefix = (fallbackAdminConfig?.projectPrefix || '').trim()
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
      if (!result.launched) {
        setResetupMsg(result.error || 'Could not launch GitHub login')
      } else {
        setResetupMsg('Sign-in opened in a new window — when done, click "Check sign-in" to refresh')
      }
    } finally {
      setLoggingIn(false)
    }
  }

  const handleResetup = async () => {
    setResetting(true)
    setResetupMsg(null)
    try {
      const result = await window.api.gitResetup()
      setResetupMsg((result.success ? '✓ ' : '✗ ') + (result.error || result.messages.join(' · ')))
    } finally {
      setResetting(false)
    }
  }

  const handleBrowse = async () => {
    const dir = await window.api.selectDirectory()
    if (dir) setPath(dir)
  }

  if (mode === 'select') {
    return (
      <div className="setup-screen">
        <img className="setup-logo" src={logoUrl} alt="TrentCAD" />
        <h1>TrentCAD</h1>
        <p className="subtitle">CAD collaboration for FRC Team 2129</p>
        <div className="setup-cards">
          <button className="setup-card" onClick={() => setMode('create')}>
            <span className="card-icon">+</span>
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
            <span className="card-icon">{'⌕'}</span>
            <span className="card-title">{canBrowse ? 'Browse Projects' : 'Join Project'}</span>
            <span className="card-desc">{canBrowse
              ? <>List repos from<br />the {orgConfigured} org</>
              : <>Download a team project<br />from GitHub</>}</span>
          </button>
          <button className="setup-card" onClick={() => setMode('open')}>
            <span className="card-icon">{'⊞'}</span>
            <span className="card-title">Open Project</span>
            <span className="card-desc">Open an existing<br />project folder</span>
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
              <span className="setup-auth-status">
                ✓ Signed in to GitHub as <strong>{authStatus.username}</strong>
              </span>
            ) : (
              <span className="setup-auth-status muted">
                {authStatus?.ghCliAvailable === false
                  ? 'GitHub CLI not detected — install to enable sign-in'
                  : 'Not signed in to GitHub'}
              </span>
            )}
            <button
              className="toolbar-btn"
              onClick={handleGitHubLogin}
              disabled={loggingIn || authStatus?.ghCliAvailable === false}
            >
              {loggingIn ? 'Opening...' : authStatus?.loggedIn ? 'Re-sign in' : 'Sign in with GitHub'}
            </button>
            <button className="toolbar-btn" onClick={refreshAuth}>
              Check sign-in
            </button>
            <button className="toolbar-btn" onClick={handleResetup} disabled={resetting}>
              {resetting ? 'Resetting...' : 'Re-setup Git'}
            </button>
          </div>
          {resetupMsg && <div className="setup-toolbar-msg">{resetupMsg}</div>}
        </div>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <h3>Recent Projects</h3>
            <div className="recent-list">
              {recentProjects.map(p => (
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
      <div className="setup-form">
        <div className="form-group">
          <label>Project Folder</label>
          <div className="path-input">
            <input value={path} onChange={e => setPath(e.target.value)} placeholder="C:\Users\team2129\Documents\2026-Robot" />
            <button className="browse-btn" onClick={handleBrowse}>Browse</button>
          </div>
        </div>
        <div className="form-actions">
          <button className="toolbar-btn" onClick={() => setMode('select')}>Back</button>
          <button
            className="toolbar-btn primary"
            disabled={!path || isLoading}
            onClick={() => onOpenProject(path)}
          >
            {isLoading ? <span className="loading-spinner" /> : 'Open'}
          </button>
        </div>
      </div>
    </div>
  )
}
