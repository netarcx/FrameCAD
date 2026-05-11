import { useState, useEffect } from 'react'
import type { AdminConfig, GlobalAdminConfig, GlobalAdminState } from '@shared/types'

interface Props {
  hasProject: boolean
  onClose: () => void
}

export default function AdminPage({ hasProject, onClose }: Props) {
  // Per-project (only used in project mode)
  const [config, setConfig] = useState<AdminConfig>({})
  // Install-wide
  const [globalState, setGlobalState] = useState<GlobalAdminState | null>(null)
  const [globalForm, setGlobalForm] = useState<GlobalAdminConfig>({})

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncingCots, setSyncingCots] = useState(false)
  const [taggingNow, setTaggingNow] = useState(false)
  const [tagName, setTagName] = useState(() => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `progress-${yyyy}-${mm}-${dd}`
  })
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let done = 0
    const finish = () => { done++; if (done === (hasProject ? 2 : 1)) setLoaded(true) }

    window.api.getGlobalAdmin()
      .then(state => {
        setGlobalState(state)
        setGlobalForm(state.effective)
      })
      .catch(() => {})
      .finally(finish)

    if (hasProject) {
      window.api.getAdminConfig()
        .then(c => setConfig(c || {}))
        .catch(() => setConfig({}))
        .finally(finish)
      // Pre-populate the main repo URL from the live git remote
      window.api.getMainRemoteUrl().then(url => {
        if (url) setConfig(prev => ({ ...prev, mainRepoUrl: prev.mainRepoUrl || url }))
      }).catch(() => {})
    }
  }, [hasProject])

  const set = <K extends keyof AdminConfig>(key: K, value: AdminConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const setGlobal = <K extends keyof GlobalAdminConfig>(key: K, value: GlobalAdminConfig[K]) => {
    setGlobalForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSaveGlobal = async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      await window.api.saveGlobalAdmin(globalForm)
      const fresh = await window.api.getGlobalAdmin()
      setGlobalState(fresh)
      setGlobalForm(fresh.effective)
      setStatus('Saved locally. This computer keeps these values across updates.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleResetGlobal = async () => {
    setError(null)
    setStatus(null)
    try {
      await window.api.resetGlobalAdmin()
      const fresh = await window.api.getGlobalAdmin()
      setGlobalState(fresh)
      setGlobalForm(fresh.effective)
      setStatus('Reset to team defaults shipped with this install.')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleSaveProject = async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const cleaned: AdminConfig = {}
      ;(Object.keys(config) as (keyof AdminConfig)[]).forEach(key => {
        const v = config[key]
        if (typeof v === 'string' && v.trim() === '') return
        ;(cleaned as Record<string, unknown>)[key] = v
      })
      await window.api.saveAdminConfig(cleaned)
      setStatus('Saved and pushed to git. Teammates will see this on next sync.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleCopyRepoUrl = async () => {
    setError(null)
    setStatus(null)
    const url = (config.mainRepoUrl || '').trim()
    if (!url) { setError('No Git URL to copy'); return }
    try {
      await navigator.clipboard.writeText(url)
      setStatus('Git URL copied to clipboard')
    } catch (err) {
      setError('Could not copy: ' + (err as Error).message)
    }
  }

  const handleCreateTag = async () => {
    setTaggingNow(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.api.createProgressTag(tagName)
      if (result.success) setStatus(`Tag "${tagName}" created and pushed`)
      else setError(result.error || 'Failed to create tag')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setTaggingNow(false)
    }
  }

  const handleSyncCots = async () => {
    setSyncingCots(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.api.syncCots()
      if (result.success) setStatus(result.cloned ? 'COTS repo cloned into COTS/' : 'COTS folder updated.')
      else setError(result.error || 'COTS sync failed')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSyncingCots(false)
    }
  }

  if (!loaded) return null

  const overrideStatusLine = globalState && globalState.hasLocalOverride
    ? 'Showing your local overrides. These survive app updates until you Reset.'
    : 'Showing team defaults shipped with this install.'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal admin-modal" onClick={e => e.stopPropagation()}>
        <h2>Admin Settings</h2>

        {/* GLOBAL SECTIONS — always shown */}
        <p className="admin-warning">
          Team and GitHub Browse settings are saved on this computer only.
          {' '}{overrideStatusLine}
        </p>

        <div className="admin-section">
          <h3>Team</h3>
          <label>Team name</label>
          <input
            value={globalForm.teamName ?? ''}
            onChange={e => setGlobal('teamName', e.target.value)}
            placeholder={globalState?.defaults.teamName || 'FRC Team 2129'}
          />
          <label>Welcome message</label>
          <textarea
            value={globalForm.welcomeMessage ?? ''}
            onChange={e => setGlobal('welcomeMessage', e.target.value)}
            placeholder={globalState?.defaults.welcomeMessage || 'Optional message shown to teammates'}
            rows={2}
          />
        </div>

        <div className="admin-section">
          <h3>GitHub Browse</h3>
          <p className="admin-hint">
            When set, students see a "Browse Projects" button on the welcome
            screen listing repos in this organisation that match the prefix.
            New projects use the prefix automatically.
          </p>
          <label>GitHub organisation</label>
          <input
            value={globalForm.gitHubOrg ?? ''}
            onChange={e => setGlobal('gitHubOrg', e.target.value)}
            placeholder={globalState?.defaults.gitHubOrg || 'netarcx'}
          />
          <label>Project name prefix</label>
          <input
            value={globalForm.projectPrefix ?? ''}
            onChange={e => setGlobal('projectPrefix', e.target.value)}
            placeholder={globalState?.defaults.projectPrefix || 'trentcad-'}
          />
        </div>

        <div className="admin-section-actions">
          <button
            className="toolbar-btn"
            onClick={handleResetGlobal}
            disabled={saving || !globalState?.hasLocalOverride}
            title={globalState?.hasLocalOverride
              ? 'Discard local overrides and use the team defaults shipped with this install'
              : 'No local overrides to reset'}
          >
            Reset to team defaults
          </button>
          <button className="toolbar-btn primary" onClick={handleSaveGlobal} disabled={saving}>
            {saving ? 'Saving…' : 'Save (local)'}
          </button>
        </div>

        {/* PROJECT-SPECIFIC SECTIONS — only when a project is open */}
        {hasProject && (
          <>
            <hr className="admin-divider" />

            <p className="admin-warning">
              The settings below are committed and pushed to <em>this project's</em>
              {' '}git repo on Save. Every teammate picks them up on their next Download.
            </p>

            <div className="admin-section">
              <h3>Part Numbering</h3>
              <label>Default part-number prefix</label>
              <input
                value={config.defaultPartPrefix ?? ''}
                onChange={e => set('defaultPartPrefix', e.target.value)}
                placeholder="e.g. 26-2129"
              />
              <p className="admin-hint">
                Stays with this project. Used by the auto-numbering when creating
                new parts and assemblies.
              </p>
            </div>

            <div className="admin-section">
              <h3>Main Repository</h3>
              <label>Git remote URL</label>
              <div className="inline-input-row">
                <input
                  value={config.mainRepoUrl ?? ''}
                  onChange={e => set('mainRepoUrl', e.target.value)}
                  placeholder="https://github.com/org/main-project.git"
                />
                <button className="toolbar-btn" onClick={handleCopyRepoUrl}>Copy</button>
              </div>
              <p className="admin-hint">
                Saving rewrites this project's `origin` remote to match.
              </p>
            </div>

            <div className="admin-section">
              <h3>Weekly Progress Tag</h3>
              <p className="admin-hint">
                Annotated Git tag at the current commit, pushed. Use to mark
                weekly snapshots so the team can browse the CAD state at any
                past milestone.
              </p>
              <label>Tag name</label>
              <div className="inline-input-row">
                <input
                  value={tagName}
                  onChange={e => setTagName(e.target.value)}
                  placeholder="progress-2026-05-10"
                />
                <button
                  className="toolbar-btn primary"
                  onClick={handleCreateTag}
                  disabled={!tagName.trim() || taggingNow}
                >
                  {taggingNow ? 'Tagging...' : 'Tag now'}
                </button>
              </div>
            </div>

            <div className="admin-section">
              <h3>COTS Library</h3>
              <p className="admin-hint">
                Commercial Off-The-Shelf parts live in a separate Git repo and
                are cloned into a <code>COTS/</code> subfolder. The folder is
                gitignored so the two histories stay separate.
              </p>
              <label>COTS repo URL</label>
              <input
                value={config.cotsRepoUrl ?? ''}
                onChange={e => set('cotsRepoUrl', e.target.value)}
                placeholder="https://github.com/org/cots-library.git"
              />
              <label>COTS branch (optional)</label>
              <input
                value={config.cotsBranch ?? ''}
                onChange={e => set('cotsBranch', e.target.value)}
                placeholder="main"
              />
              <button
                className="toolbar-btn"
                onClick={handleSyncCots}
                disabled={!config.cotsRepoUrl || syncingCots}
              >
                {syncingCots ? 'Downloading...' : 'Download COTS now'}
              </button>
            </div>

            <div className="admin-section-actions">
              <button className="toolbar-btn primary" onClick={handleSaveProject} disabled={saving}>
                {saving ? 'Saving...' : 'Save project settings & Upload'}
              </button>
            </div>
          </>
        )}

        {error && <div className="admin-error">{error}</div>}
        {status && <div className="admin-status">{status}</div>}

        <div className="actions">
          <button className="toolbar-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
