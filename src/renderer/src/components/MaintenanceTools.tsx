import { useState } from 'react'
import ErrorMsg from './ErrorMsg'

export default function MaintenanceTools() {
  const [integrity, setIntegrity] = useState<null | {
    duplicates?: Array<{ partNumber: string; paths: string[] }>
    orphanedDrawings?: Array<{ path: string; linkedTo: string }>
    tombstones?: string[]
    orphanedMeta?: string[]
  }>(null)
  const [integrityRunning, setIntegrityRunning] = useState(false)
  const [renormRunning, setRenormRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const handleIntegrityCheck = async () => {
    setIntegrityRunning(true)
    setError(null)
    setStatus(null)
    try {
      const r = await window.api.checkManifestIntegrity()
      if (r.success) {
        setIntegrity({
          duplicates: r.duplicates,
          orphanedDrawings: r.orphanedDrawings,
          tombstones: r.tombstones,
          orphanedMeta: r.orphanedMeta
        })
      } else {
        setError(r.error || 'Integrity check failed')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIntegrityRunning(false)
    }
  }

  const handleRenormalize = async () => {
    setRenormRunning(true)
    setError(null)
    setStatus(null)
    try {
      const r = await window.api.renormalizeAll()
      if (r.success) setStatus('Re-applied .gitattributes filters to every tracked file. Next publish will pick up any changes.')
      else setError(r.error || 'Re-normalize failed')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRenormRunning(false)
    }
  }

  return (
    <>
      <div className="admin-section">
        <h3>Manifest Integrity Check</h3>
        <p className="admin-hint">
          Scans parts.json for problems mentors should know about:
          duplicate part numbers (rare but breaks the BOM), drawings
          whose linked part no longer exists, and tombstone entries
          (parts.json knows about them but the file's gone from disk).
        </p>
        <div className="admin-section-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="toolbar-btn primary" onClick={handleIntegrityCheck} disabled={integrityRunning}>
            {integrityRunning ? 'Scanning…' : integrity ? 'Re-scan' : 'Run integrity check'}
          </button>
        </div>
        {integrity && (
          <div className="integrity-results">
            {(!integrity.duplicates || integrity.duplicates.length === 0) &&
             (!integrity.orphanedDrawings || integrity.orphanedDrawings.length === 0) &&
             (!integrity.tombstones || integrity.tombstones.length === 0) &&
             (!integrity.orphanedMeta || integrity.orphanedMeta.length === 0) && (
              <div className="admin-status">✓ No integrity problems found.</div>
            )}
            {integrity.duplicates && integrity.duplicates.length > 0 && (
              <div className="integrity-block">
                <h4>Duplicate part numbers ({integrity.duplicates.length})</h4>
                {integrity.duplicates.map(d => (
                  <div key={d.partNumber} className="integrity-row">
                    <strong>{d.partNumber}</strong>
                    <ul>{d.paths.map(p => <li key={p}>{p}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
            {integrity.orphanedDrawings && integrity.orphanedDrawings.length > 0 && (
              <div className="integrity-block">
                <h4>Orphaned drawings ({integrity.orphanedDrawings.length})</h4>
                {integrity.orphanedDrawings.map(o => (
                  <div key={o.path} className="integrity-row">
                    <div><strong>{o.path}</strong></div>
                    <div className="admin-hint" style={{ marginTop: 2 }}>links to missing part: {o.linkedTo}</div>
                  </div>
                ))}
              </div>
            )}
            {integrity.tombstones && integrity.tombstones.length > 0 && (
              <div className="integrity-block">
                <h4>Tombstones ({integrity.tombstones.length})</h4>
                <p className="admin-hint">
                  These are intentional — tombstones prevent part-number reuse.
                  Only worry if you actually deleted a file you didn't mean to.
                </p>
                <ul>{integrity.tombstones.map(t => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
            {integrity.orphanedMeta && integrity.orphanedMeta.length > 0 && (
              <div className="integrity-block">
                <h4>Orphaned metadata ({integrity.orphanedMeta.length})</h4>
                <p className="admin-hint">
                  parts-meta.json has entries for paths that don't exist in
                  parts.json. Usually leftover from a rename or delete that
                  happened before v0.8.5 — new renames migrate cleanly.
                  Safe to leave; can be removed by hand if it bothers you.
                </p>
                <ul>{integrity.orphanedMeta.map(m => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="admin-section">
        <h3>Re-apply LFS Filters</h3>
        <p className="admin-hint">
          Runs <code>git add --renormalize -A</code> across the project.
          Use this if you suspect a file got committed as a raw blob
          before its extension was added to LFS — re-staging through
          the current <code>.gitattributes</code> fixes the index.
          Publish already does this automatically, but a manual button
          helps when diagnosing a stuck push.
        </p>
        <div className="admin-section-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="toolbar-btn primary" onClick={handleRenormalize} disabled={renormRunning}>
            {renormRunning ? 'Re-normalizing…' : 'Re-normalize all files'}
          </button>
        </div>
      </div>

      {error && <ErrorMsg text={error} />}
      {status && <div className="admin-status">{status}</div>}
    </>
  )
}
