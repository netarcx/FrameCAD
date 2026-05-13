import { useState } from 'react'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function HealthScanner() {
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [largeFiles, setLargeFiles] = useState<Array<{
    path: string
    absolutePath: string
    size: number
    isLfsTracked: boolean
    status: 'blocker' | 'warning' | 'ok-lfs' | 'lfs-too-large'
  }> | null>(null)

  const handleScan = async () => {
    setScanning(true)
    setError(null)
    try {
      const r = await window.api.scanLargeFiles()
      if (r.success) setLargeFiles(r.files)
      else setError(r.error || 'Scan failed')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const handleReveal = async (absPath: string) => {
    const r = await window.api.revealInFolder(absPath)
    if (!r.success) setError(r.error || 'Could not open folder')
  }

  return (
    <div className="admin-section">
      <h3>Repository Health — Large Files</h3>
      <p className="admin-hint">
        Scans the project for files over 50 MB and shows which would
        trip GitHub's pre-receive hook on publish. Blockers (red) need
        to be deleted, moved out of the repo, or added to LFS before
        the next push will succeed.
      </p>
      <div className="admin-section-actions" style={{ justifyContent: 'flex-start' }}>
        <button
          className="toolbar-btn primary"
          onClick={handleScan}
          disabled={scanning}
        >
          {scanning ? 'Scanning…' : largeFiles ? 'Re-scan' : 'Scan for large files'}
        </button>
      </div>
      {largeFiles !== null && largeFiles.length === 0 && (
        <div className="admin-status">✓ No files over 50 MB found. You're good to push.</div>
      )}
      {largeFiles !== null && largeFiles.length > 0 && (
        <div className="large-files-list">
          {largeFiles.map(f => (
            <div key={f.path} className={`large-file-row large-file-${f.status}`}>
              <div className="large-file-meta">
                <span className={`large-file-badge large-file-badge-${f.status}`}>
                  {f.status === 'blocker' && 'BLOCKER'}
                  {f.status === 'warning' && 'WARNING'}
                  {f.status === 'ok-lfs' && 'OK (LFS)'}
                  {f.status === 'lfs-too-large' && 'LFS OVER 5 GB'}
                </span>
                <span className="large-file-size">{formatSize(f.size)}</span>
              </div>
              <div className="large-file-path" title={f.absolutePath}>{f.path}</div>
              <div className="large-file-hint">
                {f.status === 'blocker' && 'GitHub rejects non-LFS files over 100 MB. Delete this, move it out of the repo, or add its extension to .gitattributes and re-stage.'}
                {f.status === 'warning' && 'Over GitHub\'s 50 MB recommendation. Will succeed but could grow into a blocker.'}
                {f.status === 'ok-lfs' && 'Tracked by Git LFS — fine at any size up to 5 GB.'}
                {f.status === 'lfs-too-large' && 'LFS objects max out at 5 GB. Split this file before publishing.'}
              </div>
              <div className="large-file-actions">
                <button className="toolbar-btn" onClick={() => handleReveal(f.absolutePath)}>
                  Show in folder
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div className="admin-error">{error}</div>}
    </div>
  )
}
