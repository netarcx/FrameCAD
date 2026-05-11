import { useEffect, useRef, useState } from 'react'

interface AdminPinPromptProps {
  onSuccess: () => void
  onClose: () => void
}

export default function AdminPinPrompt({ onSuccess, onClose }: AdminPinPromptProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (verifying) return
    setError(null)
    setVerifying(true)
    try {
      const ok = await window.api.adminPinVerify(pin)
      if (ok) {
        onSuccess()
      } else {
        setError('Incorrect PIN')
        setPin('')
        inputRef.current?.focus()
      }
    } catch {
      setError('Could not verify PIN')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal admin-pin-modal" onClick={e => e.stopPropagation()}>
        <h2>Admin PIN</h2>
        <p className="admin-pin-help">
          Enter the team admin PIN to open the admin settings.
        </p>
        <form onSubmit={submit}>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="PIN"
            disabled={verifying}
          />
          {error && <div className="admin-pin-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={verifying}>Cancel</button>
            <button type="submit" className="primary" disabled={verifying || !pin}>
              {verifying ? 'Checking…' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
