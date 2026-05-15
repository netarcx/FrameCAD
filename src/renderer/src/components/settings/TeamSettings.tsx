import { useState, useEffect } from 'react'
import type { GlobalAdminConfig, GlobalAdminState } from '@shared/types'

export default function TeamSettings() {
  const [globalState, setGlobalState] = useState<GlobalAdminState | null>(null)
  const [form, setForm] = useState<GlobalAdminConfig>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    window.api.getGlobalAdmin()
      .then(state => {
        setGlobalState(state)
        setForm(state.effective)
      })
      .catch(() => {})
  }, [])

  const set = <K extends keyof GlobalAdminConfig>(key: K, value: GlobalAdminConfig[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      await window.api.saveGlobalAdmin(form)
      const fresh = await window.api.getGlobalAdmin()
      setGlobalState(fresh)
      setForm(fresh.effective)
      setStatus('Saved locally. This computer keeps these values across updates.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setError(null)
    setStatus(null)
    try {
      await window.api.resetGlobalAdmin()
      const fresh = await window.api.getGlobalAdmin()
      setGlobalState(fresh)
      setForm(fresh.effective)
      setStatus('Reset to team defaults shipped with this install.')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!globalState) return null

  const overrideStatusLine = globalState.hasLocalOverride
    ? 'Showing your local overrides. These survive app updates until you Reset.'
    : 'Showing team defaults shipped with this install.'

  return (
    <>
      <p className="admin-warning">
        Team and GitHub Browse settings are saved on this computer only.
        {' '}{overrideStatusLine}
      </p>

      <div className="admin-section">
        <h3>Team</h3>
        <label>Team name</label>
        <input
          value={form.teamName ?? ''}
          onChange={e => set('teamName', e.target.value)}
          placeholder={globalState.defaults.teamName || 'e.g. FRC Team 9999'}
        />
        <label>Welcome message</label>
        <textarea
          value={form.welcomeMessage ?? ''}
          onChange={e => set('welcomeMessage', e.target.value)}
          placeholder={globalState.defaults.welcomeMessage || 'Optional message shown to teammates'}
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
          value={form.gitHubOrg ?? ''}
          onChange={e => set('gitHubOrg', e.target.value)}
          placeholder={globalState.defaults.gitHubOrg || 'netarcx'}
        />
        <label>Project name prefix</label>
        <input
          value={form.projectPrefix ?? ''}
          onChange={e => set('projectPrefix', e.target.value)}
          placeholder={globalState.defaults.projectPrefix || 'framecad-'}
        />
      </div>

      <div className="admin-section-actions">
        <button
          className="toolbar-btn"
          onClick={handleReset}
          disabled={saving || !globalState.hasLocalOverride}
          title={globalState.hasLocalOverride
            ? 'Discard local overrides and use the team defaults shipped with this install'
            : 'No local overrides to reset'}
        >
          Reset to team defaults
        </button>
        <button className="toolbar-btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save (local)'}
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}
      {status && <div className="admin-status">{status}</div>}
    </>
  )
}
