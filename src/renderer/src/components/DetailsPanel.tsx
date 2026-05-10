import type { FileEntry, FileState } from '@shared/types'

interface Props {
  file: FileEntry | null
  onCheckOut: (path: string) => void
  onCheckIn: (path: string) => void
}

function stateLabel(state: FileState): string {
  switch (state) {
    case 'synced': return 'Synced'
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

export default function DetailsPanel({ file, onCheckOut, onCheckIn }: Props) {
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
