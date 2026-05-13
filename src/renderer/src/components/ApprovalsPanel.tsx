import type { JoinedPart } from './PartsManager'

interface Props {
  parts: JoinedPart[]
  rowSaving: string | null
  onApprove: (path: string) => void
  onReject: (path: string) => void
  onRefresh: () => void
}

export default function ApprovalsPanel({ parts, rowSaving, onApprove, onReject, onRefresh }: Props) {
  return (
    <div className="admin-section">
      <h3>Approvals — In-Review Parts</h3>
      <p className="admin-hint">
        Parts marked <em>in-review</em> are waiting for a mentor sign-off
        before they enter the manufacturing queue. Approve to mark
        <strong> released</strong>; reject to send back to <strong> draft</strong>.
      </p>
      <div className="admin-section-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="toolbar-btn" onClick={onRefresh}>Refresh</button>
        <span className="parts-count">{parts.length} awaiting review</span>
      </div>
      {parts.length === 0 ? (
        <div className="admin-status">✓ No parts waiting on a review right now.</div>
      ) : (
        <div className="approvals-list">
          {parts.map(p => {
            const filename = p.path.includes('/') ? p.path.slice(p.path.lastIndexOf('/') + 1) : p.path
            const isSaving = rowSaving === p.path
            return (
              <div key={p.path} className="approval-row">
                <div className="approval-main">
                  <div className="approval-pn">{p.partNumber}</div>
                  <div className="approval-meta">
                    <strong>{filename}</strong> · {p.topLevel}
                    {p.meta.manufacturingMethod && <> · {p.meta.manufacturingMethod}</>}
                    {p.meta.manufacturingMaterial && <> · {p.meta.manufacturingMaterial}</>}
                    {typeof p.meta.mass === 'number' && <> · {p.meta.mass.toFixed(2)} lb</>}
                  </div>
                  {p.description && <div className="approval-desc">{p.description}</div>}
                </div>
                <div className="approval-actions">
                  <button
                    className="toolbar-btn"
                    onClick={() => onReject(p.path)}
                    disabled={isSaving}
                  >
                    Send back to draft
                  </button>
                  <button
                    className="toolbar-btn primary"
                    onClick={() => onApprove(p.path)}
                    disabled={isSaving}
                  >
                    Approve & release
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
