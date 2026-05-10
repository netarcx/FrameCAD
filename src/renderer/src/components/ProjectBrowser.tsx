import { useState, useEffect } from 'react'
import type { FileEntry, FileState } from '@shared/types'

interface Props {
  files: FileEntry[]
  selectedFile: FileEntry | null
  onSelect: (file: FileEntry) => void
  onCheckOut: (path: string) => void
  onCheckIn: (path: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  file: FileEntry
}

function stateLabel(state: FileState): string {
  switch (state) {
    case 'synced': return 'Synced'
    case 'modified': return 'Modified'
    case 'untracked': return 'New'
    case 'locked-by-you': return 'Checked out'
    case 'locked-by-other': return 'Locked'
  }
}

function fileIcon(entry: FileEntry): string {
  if (entry.isDirectory) return '\u{1F4C1}'
  const ext = entry.name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'sldprt': return 'P'
    case 'sldasm': return 'A'
    case 'slddrw': return 'D'
    case 'step': case 'stp': return 'S'
    case 'stl': return '△'
    case 'pdf': return '□'
    default: return '□'
  }
}

function fileIconTitle(entry: FileEntry): string {
  if (entry.isDirectory) return 'Folder'
  const ext = entry.name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'sldprt': return 'Part'
    case 'sldasm': return 'Assembly'
    case 'slddrw': return 'Drawing'
    case 'step': case 'stp': return 'STEP'
    case 'stl': return 'STL'
    case 'pdf': return 'PDF'
    default: return 'File'
  }
}

function flattenTree(entries: FileEntry[], depth: number, collapsed: Set<string>): { entry: FileEntry; depth: number }[] {
  const result: { entry: FileEntry; depth: number }[] = []
  for (const entry of entries) {
    result.push({ entry, depth })
    if (entry.isDirectory && entry.children && !collapsed.has(entry.path)) {
      result.push(...flattenTree(entry.children, depth + 1, collapsed))
    }
  }
  return result
}

export default function ProjectBrowser({ files, selectedFile, onSelect, onCheckOut, onCheckIn }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const toggleCollapse = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleContext = (e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  const rows = flattenTree(files, 0, collapsed)

  const canCheckOut = contextMenu?.file && !contextMenu.file.isDirectory &&
    contextMenu.file.state !== 'locked-by-you' && contextMenu.file.state !== 'locked-by-other'

  const canCheckIn = contextMenu?.file && contextMenu.file.state === 'locked-by-you'

  return (
    <>
      <div className="file-table-header">
        <span className="col-name">Name</span>
        <span className="col-partnum">Part #</span>
        <span className="col-status">Status</span>
        <span className="col-lock">Checked Out By</span>
      </div>
      <div className="file-table">
        {rows.length === 0 ? (
          <div className="empty-state">
            <p>No files yet</p>
            <p>Add SolidWorks files to your project folder</p>
          </div>
        ) : (
          rows.map(({ entry, depth }) => (
            <div
              key={entry.path}
              className={`file-row${selectedFile?.path === entry.path ? ' selected' : ''}`}
              onClick={() => {
                if (entry.isDirectory) toggleCollapse(entry.path)
                else onSelect(entry)
              }}
              onContextMenu={e => handleContext(e, entry)}
            >
              <div className="col-name">
                <span className="indent" style={{ width: depth * 20 }} />
                {entry.isDirectory ? (
                  <span className="expand-toggle">
                    {collapsed.has(entry.path) ? '▸' : '▾'}
                  </span>
                ) : (
                  <span className="expand-toggle" />
                )}
                <span className="icon" title={fileIconTitle(entry)}>{fileIcon(entry)}</span>
                <span className="name">{entry.name}</span>
              </div>
              <div className="col-partnum">
                {!entry.isDirectory && entry.partNumber && (
                  <span className="part-number">{entry.partNumber}</span>
                )}
              </div>
              <div className="col-status">
                {!entry.isDirectory && (
                  <>
                    <span className={`status-dot ${entry.state}`} />
                    <span className={`status-label ${entry.state}`}>{stateLabel(entry.state)}</span>
                  </>
                )}
              </div>
              <div className="col-lock">
                {entry.lockedBy || ''}
              </div>
            </div>
          ))
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="context-menu-item"
            disabled={!canCheckOut}
            onClick={() => {
              onCheckOut(contextMenu.file.path)
              setContextMenu(null)
            }}
          >
            Check Out
          </button>
          <button
            className="context-menu-item"
            disabled={!canCheckIn}
            onClick={() => {
              onCheckIn(contextMenu.file.path)
              setContextMenu(null)
            }}
          >
            Check In
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item"
            onClick={() => {
              window.api.openFileExplorer(contextMenu.file.path)
              setContextMenu(null)
            }}
          >
            Show in Explorer
          </button>
        </div>
      )}
    </>
  )
}
