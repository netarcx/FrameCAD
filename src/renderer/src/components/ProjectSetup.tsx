import { useState, useEffect } from 'react'
import type { ProjectConfig } from '@shared/types'

interface Props {
  onCreateProject: (name: string, path: string, remote: string) => Promise<void>
  onJoinProject: (url: string, path: string) => Promise<void>
  onOpenProject: (path: string) => Promise<void>
  isLoading: boolean
}

type Mode = 'select' | 'create' | 'join' | 'open'

export default function ProjectSetup({ onCreateProject, onJoinProject, onOpenProject, isLoading }: Props) {
  const [mode, setMode] = useState<Mode>('select')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [remote, setRemote] = useState('')
  const [url, setUrl] = useState('')
  const [recentProjects, setRecentProjects] = useState<ProjectConfig[]>([])

  useEffect(() => {
    window.api.getRecentProjects().then(setRecentProjects).catch(() => {})
  }, [])

  const handleBrowse = async () => {
    const dir = await window.api.selectDirectory()
    if (dir) setPath(dir)
  }

  if (mode === 'select') {
    return (
      <div className="setup-screen">
        <h1>TrentCAD</h1>
        <p className="subtitle">CAD collaboration for FRC Team 2129</p>
        <div className="setup-cards">
          <button className="setup-card" onClick={() => setMode('create')}>
            <span className="card-icon">+</span>
            <span className="card-title">Create Project</span>
            <span className="card-desc">Start a new CAD project<br />with version control</span>
          </button>
          <button className="setup-card" onClick={() => setMode('join')}>
            <span className="card-icon">{'↓'}</span>
            <span className="card-title">Join Project</span>
            <span className="card-desc">Download a team project<br />from GitHub</span>
          </button>
          <button className="setup-card" onClick={() => setMode('open')}>
            <span className="card-icon">{'⊞'}</span>
            <span className="card-title">Open Project</span>
            <span className="card-desc">Open an existing<br />project folder</span>
          </button>
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
          </div>
          <div className="form-actions">
            <button className="toolbar-btn" onClick={() => setMode('select')}>Back</button>
            <button
              className="toolbar-btn primary"
              disabled={!name || !path || isLoading}
              onClick={() => onCreateProject(name, `${path}/${name}`, remote)}
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
