import { useState, useEffect, useCallback, useRef } from 'react'
import type { FileEntry, FileState, PartMeta, ReleaseState } from '@shared/types'

interface Props {
  file: FileEntry | null
  onCheckOut: (path: string) => void
  onCheckIn: (path: string) => void
}

function stateLabel(state: FileState): string {
  switch (state) {
    case 'synced': return 'Up to date'
    case 'modified': return 'Modified locally'
    case 'untracked': return 'New file'
    case 'locked-by-you': return 'Checked out by you'
    case 'locked-by-other': return 'Checked out'
  }
}

function fileType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'sldprt': return 'SolidWorks Part'
    case 'sldasm': return 'SolidWorks Assembly'
    case 'slddrw': return 'SolidWorks Drawing'
    case 'step': case 'stp': return 'STEP File'
    case 'stl': return 'STL Mesh'
    case 'pdf': return 'PDF Document'
    case 'png': case 'jpg': case 'jpeg': return 'Image'
    default: return ext?.toUpperCase() || 'File'
  }
}

const RELEASE_STATES: ReleaseState[] = ['draft', 'in-review', 'released', 'manufactured']

function releaseLabel(s: ReleaseState | undefined): string {
  if (!s) return 'Draft'
  switch (s) {
    case 'draft': return 'Draft'
    case 'in-review': return 'In Review'
    case 'released': return 'Released'
    case 'manufactured': return 'Manufactured'
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return d.toLocaleDateString()
}

export default function DetailsPanel({ file, onCheckOut, onCheckIn }: Props) {
  const [meta, setMeta] = useState<PartMeta>({})
  const [loading, setLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)
  const [mfgNotes, setMfgNotes] = useState('')
  const [massText, setMassText] = useState('')
  const [costText, setCostText] = useState('')
  const [savingState, setSavingState] = useState<ReleaseState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mfgTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshMeta = useCallback(async (path: string) => {
    setLoading(true)
    try {
      const m = await window.api.getPartMeta(path)
      setMeta(m || {})
      setMfgNotes(m?.manufacturingNotes || '')
      setMassText(typeof m?.mass === 'number' ? String(m.mass) : '')
      setCostText(typeof m?.cost === 'number' ? String(m.cost) : '')
    } catch {
      setMeta({})
      setMfgNotes('')
      setMassText('')
      setCostText('')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (file && !file.isDirectory) refreshMeta(file.path)
  }, [file, refreshMeta])

  if (!file) {
    return (
      <div className="details-panel">
        <div className="details-empty">
          Click a file to see details
        </div>
      </div>
    )
  }

  const canCheckOut = !file.isDirectory &&
    file.state !== 'locked-by-you' && file.state !== 'locked-by-other'

  const canCheckIn = file.state === 'locked-by-you'

  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '/'

  const currentState: ReleaseState = meta.release?.state || 'draft'

  const handleSetState = async (state: ReleaseState) => {
    if (state === currentState) return
    setSavingState(state)
    setError(null)
    try {
      await window.api.setReleaseState(file.path, state)
      await refreshMeta(file.path)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSavingState(null)
    }
  }

  const handlePostComment = async () => {
    const text = commentText.trim()
    if (!text) return
    setPosting(true)
    setError(null)
    try {
      await window.api.addComment(file.path, text)
      setCommentText('')
      await refreshMeta(file.path)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPosting(false)
    }
  }

  const handleMfgChange = (value: string) => {
    setMfgNotes(value)
    if (mfgTimeout.current) clearTimeout(mfgTimeout.current)
    mfgTimeout.current = setTimeout(async () => {
      try {
        await window.api.setManufacturingNotes(file.path, value)
      } catch (err) {
        setError((err as Error).message)
      }
    }, 1500)
  }

  const commitMass = async () => {
    setError(null)
    const trimmed = massText.trim()
    if (trimmed === '' && typeof meta.mass !== 'number') return
    const parsed = trimmed === '' ? null : parseFloat(trimmed)
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) {
      setError('Mass must be a positive number')
      return
    }
    if (parsed === meta.mass) return
    try {
      await window.api.setPartMass(file.path, parsed)
      await refreshMeta(file.path)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const commitCost = async () => {
    setError(null)
    const trimmed = costText.trim()
    if (trimmed === '' && typeof meta.cost !== 'number') return
    const parsed = trimmed === '' ? null : parseFloat(trimmed)
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) {
      setError('Cost must be a positive number')
      return
    }
    if (parsed === meta.cost) return
    try {
      await window.api.setPartCost(file.path, parsed)
      await refreshMeta(file.path)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="details-panel">
      <div className="details-header">
        <div className="file-name">{file.name}</div>
        <div className="file-path">{dir}</div>
      </div>

      <div className="details-section">
        <div className="section-title">Info</div>
        <div className="details-row">
          <span className="label">Type</span>
          <span className="value">{file.isDirectory ? 'Folder' : fileType(file.name)}</span>
        </div>
        {file.partNumber && (
          <div className="details-row">
            <span className="label">Part #</span>
            <span className="value part-number-detail">{file.partNumber}</span>
          </div>
        )}
        {file.partDescription && (
          <div className="details-row">
            <span className="label">Description</span>
            <span className="value">{file.partDescription}</span>
          </div>
        )}
        <div className="details-row">
          <span className="label">Status</span>
          <span className="value">{stateLabel(file.state)}</span>
        </div>
        {file.lockedBy && (
          <div className="details-row">
            <span className="label">Locked by</span>
            <span className="value">{file.lockedBy}</span>
          </div>
        )}
      </div>

      {!file.isDirectory && (
        <>
          <div className="details-section">
            <div className="section-title">Release</div>
            <div className="release-row">
              <span className={`release-badge release-${currentState}`}>{releaseLabel(currentState)}</span>
              {meta.release?.at && (
                <span className="release-meta">
                  {meta.release.by ? `by ${meta.release.by} · ` : ''}{formatTime(meta.release.at)}
                </span>
              )}
            </div>
            <div className="release-buttons">
              {RELEASE_STATES.map(s => (
                <button
                  key={s}
                  className={`release-pill release-${s}${currentState === s ? ' active' : ''}`}
                  onClick={() => handleSetState(s)}
                  disabled={loading || savingState !== null}
                >
                  {savingState === s ? '...' : releaseLabel(s)}
                </button>
              ))}
            </div>
          </div>

          <div className="details-section">
            <div className="section-title">
              Comments {meta.comments && meta.comments.length > 0 ? `(${meta.comments.length})` : ''}
            </div>
            <div className="comments-list">
              {(meta.comments || []).map(c => (
                <div className="comment" key={c.id}>
                  <div className="comment-head">
                    <span className="comment-author">{c.author}</span>
                    <span className="comment-time">{formatTime(c.at)}</span>
                  </div>
                  <div className="comment-body">{c.text}</div>
                </div>
              ))}
              {(!meta.comments || meta.comments.length === 0) && (
                <div className="comments-empty">No comments yet</div>
              )}
            </div>
            <div className="comment-form">
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
              />
              <button
                className="toolbar-btn primary"
                onClick={handlePostComment}
                disabled={!commentText.trim() || posting}
              >
                {posting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>

          <div className="details-section">
            <div className="section-title">Mass & Cost</div>
            <div className="mass-cost-grid">
              <label className="mass-cost-field">
                <span>Mass (lb)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={massText}
                  onChange={e => setMassText(e.target.value)}
                  onBlur={commitMass}
                  onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                  placeholder="0.0"
                />
              </label>
              <label className="mass-cost-field">
                <span>Cost ($)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costText}
                  onChange={e => setCostText(e.target.value)}
                  onBlur={commitCost}
                  onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                  placeholder="0.00"
                />
              </label>
            </div>
            <div className="mfg-hint">Press Enter or click away to save</div>
          </div>

          <div className="details-section">
            <div className="section-title">Manufacturing Notes</div>
            <textarea
              className="mfg-notes-input"
              value={mfgNotes}
              onChange={e => handleMfgChange(e.target.value)}
              placeholder="e.g., 1/4&quot; 6061, deburr edges"
              rows={3}
            />
            <div className="mfg-hint">Saves automatically</div>
          </div>
        </>
      )}

      {error && <div className="details-error">{error}</div>}

      {!file.isDirectory && (
        <div className="details-actions">
          {canCheckOut && (
            <button className="toolbar-btn" onClick={() => onCheckOut(file.path)}>
              Check Out
            </button>
          )}
          {canCheckIn && (
            <button className="toolbar-btn" onClick={() => onCheckIn(file.path)}>
              Check In
            </button>
          )}
          <button className="toolbar-btn" onClick={() => window.api.openFileExplorer(file.path)}>
            Show in Explorer
          </button>
        </div>
      )}
    </div>
  )
}
