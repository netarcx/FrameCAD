import { useState } from 'react'

interface Props {
  onComplete: () => void
  onCancel?: () => void
  initialName?: string
  initialEmail?: string
  embedded?: boolean
}

export default function ProfileSetup({ onComplete, onCancel, initialName = '', initialEmail = '', embedded }: Props) {
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.api.setGitIdentity(name.trim(), email.trim())
      onComplete()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={embedded ? 'admin-section' : 'setup-screen'}>
      <h1>{embedded ? 'Profile' : 'Welcome to FrameCAD'}</h1>
      <p className={embedded ? 'admin-hint' : 'subtitle'}>Set up your profile so your team knows who made changes</p>
      <div className="setup-form">
        <div className="form-group">
          <label>Your Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jane Smith"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="jane@swrobotics.com"
            type="email"
          />
        </div>
        <div className="form-actions">
          {onCancel && (
            <button className="toolbar-btn" onClick={onCancel}>Cancel</button>
          )}
          <button
            className="toolbar-btn primary"
            disabled={!name.trim() || !email.trim() || saving}
            onClick={handleSave}
          >
            {saving ? <span className="loading-spinner" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
