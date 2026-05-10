import { useState } from 'react'
import type { HistoryEntry } from '@shared/types'

interface Props {
  history: HistoryEntry[]
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

export default function ActivityFeed({ history }: Props) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="activity-panel">
      <div className="activity-header" onClick={() => setExpanded(!expanded)}>
        <span>Activity ({history.length})</span>
        <span className={`toggle${expanded ? '' : ' collapsed'}`}>{'▾'}</span>
      </div>
      {expanded && (
        <div className="activity-list">
          {history.length === 0 ? (
            <div className="activity-item">
              <span className="message" style={{ color: 'var(--text-muted)' }}>No activity yet</span>
            </div>
          ) : (
            history.slice(0, 20).map(entry => (
              <div key={entry.hash} className="activity-item">
                <span className="author">{entry.author}</span>
                <span className="message">{entry.message}</span>
                <span className="meta">
                  {entry.files.length > 0 && `${entry.files.length} file${entry.files.length !== 1 ? 's' : ''} · `}
                  {formatDate(entry.date)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
