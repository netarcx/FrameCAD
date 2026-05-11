import { useState, useEffect } from 'react'
import type { AdminConfig } from '@shared/types'

interface Props {
  onClose: () => void
}

export default function AdminPage({ onClose }: Props) {
  const [config, setConfig] = useState<AdminConfig>({})
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncingCots, setSyncingCots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    window.api.getAdminConfig()
      .then(c => setConfig(c || {}))
      .catch(() => setConfig({}))
      .finally(() => setLoaded(true))
  }, [])

  const set = <K extends keyof AdminConfig>(key: K, value: AdminConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      // Strip empty strings so the config stays minimal
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

  const handleSyncCots = async () => {
    setSyncingCots(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.api.syncCots()
      if (result.success) {
        setStatus(result.cloned ? 'COTS repo cloned into COTS/' : 'COTS folder updated.')
      } else {
        setError(result.error || 'COTS sync failed')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSyncingCots(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal admin-modal" onClick={e => e.stopPropagation()}>
        <h2>Admin Settings</h2>
        <p className="admin-warning">
          Changes are committed and pushed to git on Save. Every team
          member picks them up on their next Download.
        </p>

        <div className="admin-section">
          <h3>Team</h3>
          <label>Team name</label>
          <input
            value={config.teamName ?? ''}
            onChange={e => set('teamName', e.target.value)}
            placeholder="FRC Team 2129"
          />
          <label>Welcome message</label>
          <textarea
            value={config.welcomeMessage ?? ''}
            onChange={e => set('welcomeMessage', e.target.value)}
            placeholder="Optional message shown to teammates"
            rows={2}
          />
          <label>Default part-number prefix</label>
          <input
            value={config.defaultPartPrefix ?? ''}
            onChange={e => set('defaultPartPrefix', e.target.value)}
            placeholder="e.g. 26-2129"
          />
        </div>

        <div className="admin-section">
          <h3>Main Repository</h3>
          <label>Git remote URL</label>
          <input
            value={config.mainRepoUrl ?? ''}
            onChange={e => set('mainRepoUrl', e.target.value)}
            placeholder="https://github.com/org/main-project.git"
          />
          <p className="admin-hint">
            Saving rewrites this project's `origin` remote to match.
          </p>
        </div>

        <div className="admin-section">
          <h3>COTS Library</h3>
          <p className="admin-hint">
            Commercial Off-The-Shelf parts live in a separate Git repo and
            are cloned into a <code>COTS/</code> subfolder. The folder is
            gitignored in this project so the two histories stay separate.
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

        {error && <div className="admin-error">{error}</div>}
        {status && <div className="admin-status">{status}</div>}

        <div className="actions">
          <button className="toolbar-btn" onClick={onClose}>Close</button>
          <button className="toolbar-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save & Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
