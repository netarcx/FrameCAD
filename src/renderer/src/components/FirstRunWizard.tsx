import { useState } from 'react'
import { X } from 'lucide-react'
import type { GlobalAdminConfig } from '@shared/types'

interface Props {
  /** Build-time defaults so we can show meaningful placeholders for any
   *  fields the fork already baked in. */
  defaults: GlobalAdminConfig
  /** Called with the values to persist. Empty fields are dropped. */
  onSubmit(config: GlobalAdminConfig, adminPin: string): Promise<void> | void
  /** "Skip for now" — dismisses without writing. Caller is responsible
   *  for ensuring the wizard doesn't reappear next launch. */
  onSkip(): void
}

/**
 * One-time setup modal shown to a brand-new user on a fresh public-binary
 * install (no global-admin override exists yet and the build didn't bake
 * one in). Collects the bare-minimum team identity needed for part
 * numbering, Browse Projects, and Create-on-GitHub to work without
 * making the user hunt for the admin panel.
 */
export default function FirstRunWizard({ defaults, onSubmit, onSkip }: Props) {
  const [teamName, setTeamName] = useState(defaults.teamName ?? '')
  const [teamNumber, setTeamNumber] = useState(defaults.teamNumber ?? '')
  const [gitHubOrg, setGitHubOrg] = useState(defaults.gitHubOrg ?? '')
  const [projectPrefix, setProjectPrefix] = useState(defaults.projectPrefix ?? '')
  const [adminPin, setAdminPin] = useState('')
  const [adminPinConfirm, setAdminPinConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-suggest a project prefix from the team number when the user
  // hasn't typed one themselves yet. "9999" → "frc9999-". Stops as soon
  // as the user edits the prefix manually.
  const [prefixIsDerived, setPrefixIsDerived] = useState(!projectPrefix)
  function onTeamNumberChange(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 5)
    setTeamNumber(digits)
    if (prefixIsDerived) {
      setProjectPrefix(digits ? `frc${digits}-` : '')
    }
  }
  function onPrefixChange(v: string) {
    setProjectPrefix(v)
    setPrefixIsDerived(false)
  }

  const trimmedTeamName = teamName.trim()
  const trimmedTeamNumber = teamNumber.trim()
  const trimmedOrg = gitHubOrg.trim()
  const trimmedPrefix = projectPrefix.trim()

  const pinPresent = adminPin.length > 0 || adminPinConfirm.length > 0
  const pinValid = !pinPresent || (adminPin.length >= 4 && adminPin === adminPinConfirm)
  const canSave = trimmedTeamName.length > 0 && trimmedTeamNumber.length > 0 && pinValid

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(
        {
          teamName: trimmedTeamName,
          teamNumber: trimmedTeamNumber,
          gitHubOrg: trimmedOrg || undefined,
          projectPrefix: trimmedPrefix || undefined,
        },
        pinPresent ? adminPin : ''
      )
    } catch (e) {
      setError((e as Error).message || 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay first-run-overlay">
      <div className="modal first-run-modal" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          className="modal-close"
          onClick={onSkip}
          title="Skip for now (you can configure later in Admin)"
          aria-label="Skip first-run setup"
        >
          <X size={18} />
        </button>
        <h2>Welcome to FrameCAD</h2>
        <p className="first-run-intro">
          Two minutes of setup so the app knows your team. You can change
          any of this later from the Admin panel (Ctrl+Shift+A).
        </p>

        <div className="first-run-grid">
          <label>
            <span>Team name <em className="req">*</em></span>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder={defaults.teamName || 'e.g. FRC Team 9999 (Your Mascot)'}
              autoFocus
            />
          </label>

          <label>
            <span>FRC team number <em className="req">*</em></span>
            <input
              type="text"
              inputMode="numeric"
              value={teamNumber}
              onChange={e => onTeamNumberChange(e.target.value)}
              placeholder={defaults.teamNumber || 'e.g. 9999'}
            />
            <small>
              Used in part numbers — every part this team designs will be
              prefixed with this number (e.g. <code>26-{trimmedTeamNumber || 'NNNN'}-001</code>).
            </small>
          </label>

          <label>
            <span>GitHub organisation</span>
            <input
              type="text"
              value={gitHubOrg}
              onChange={e => setGitHubOrg(e.target.value)}
              placeholder={defaults.gitHubOrg || 'e.g. frc9999'}
            />
            <small>
              Where your team's robot repos live. Powers "Browse Projects"
              and "Create on GitHub". Leave blank if you don't have one
              yet — you can paste repo URLs by hand instead.
            </small>
          </label>

          <label>
            <span>Project repo prefix</span>
            <input
              type="text"
              value={projectPrefix}
              onChange={e => onPrefixChange(e.target.value)}
              placeholder={defaults.projectPrefix || 'e.g. frc9999-'}
            />
            <small>
              Browse Projects filters the org by this prefix so unrelated
              repos don't clutter the list.
            </small>
          </label>

          <label>
            <span>Admin PIN (optional)</span>
            <input
              type="password"
              value={adminPin}
              onChange={e => setAdminPin(e.target.value)}
              placeholder="Leave blank for an open admin panel"
              autoComplete="new-password"
            />
            {pinPresent && (
              <input
                type="password"
                value={adminPinConfirm}
                onChange={e => setAdminPinConfirm(e.target.value)}
                placeholder="Confirm PIN"
                autoComplete="new-password"
                style={{ marginTop: 6 }}
              />
            )}
            <small>
              Set this if students share the laptop and you want to gate
              the admin panel. Hashed locally; not synced with the team.
            </small>
          </label>
        </div>

        {pinPresent && !pinValid && (
          <div className="first-run-error">
            {adminPin.length < 4
              ? 'PIN must be at least 4 characters.'
              : 'PINs don\'t match.'}
          </div>
        )}
        {error && <div className="first-run-error">{error}</div>}

        <div className="first-run-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={onSkip}
            disabled={saving}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={!canSave || saving}
          >
            {saving ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
