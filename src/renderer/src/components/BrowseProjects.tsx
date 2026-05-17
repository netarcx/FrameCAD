import { useEffect, useState, useCallback } from 'react'
import type { GitHubRepoSummary } from '@shared/types'
import ErrorMsg from './ErrorMsg'

interface Props {
  org: string
  prefix?: string
  onPick: (url: string, suggestedName: string) => void
  onClose: () => void
}

function relativeTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toLocaleDateString()
}

function stripPrefix(name: string, prefix?: string): string {
  if (prefix && name.toLowerCase().startsWith(prefix.toLowerCase())) {
    return name.slice(prefix.length)
  }
  return name
}

export default function BrowseProjects({ org, prefix, onPick, onClose }: Props) {
  const [repos, setRepos] = useState<GitHubRepoSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.listGitHubRepos(org, prefix)
      if (result.success) setRepos(result.repos)
      else setError(result.error || 'Could not list repos')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [org, prefix])

  useEffect(() => { refresh() }, [refresh])

  const visible = repos.filter(r => {
    if (!filter.trim()) return true
    const q = filter.trim().toLowerCase()
    return r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)
  })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal browse-modal" onClick={e => e.stopPropagation()}>
        <h2>Browse Team Projects</h2>
        <p className="admin-hint">
          Projects in the <strong>{org}</strong> organization
          {prefix && <> matching the prefix <code>{prefix}</code></>}.
          Click <em>Join</em> to clone any of them locally.
        </p>

        <input
          className="browse-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by name or description..."
        />

        {loading && <div className="browse-empty">Loading projects from GitHub...</div>}
        {error && <ErrorMsg text={error} />}
        {!loading && !error && visible.length === 0 && (
          <div className="browse-empty">
            {repos.length === 0
              ? `No projects found in ${org}${prefix ? ` matching "${prefix}"` : ''}`
              : 'No projects match your filter'}
          </div>
        )}

        {visible.length > 0 && (
          <div className="browse-list">
            {visible.map(r => (
              <div className="browse-item" key={r.url}>
                <div className="browse-item-main">
                  <div className="browse-item-name">
                    {stripPrefix(r.name, prefix)}
                    {r.isPrivate && <span className="browse-private-badge">private</span>}
                  </div>
                  {r.description && <div className="browse-item-desc">{r.description}</div>}
                  <div className="browse-item-meta">
                    {r.name}
                    {r.updatedAt && <> · updated {relativeTime(r.updatedAt)}</>}
                  </div>
                </div>
                <button
                  className="toolbar-btn primary"
                  onClick={() => onPick(r.url, stripPrefix(r.name, prefix))}
                >
                  Join
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="actions">
          <button className="toolbar-btn" onClick={refresh} disabled={loading}>Refresh</button>
          <button className="toolbar-btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
