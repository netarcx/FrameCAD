import { useState, useEffect, useMemo } from 'react'
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

type SortKey = 'name' | 'partnum' | 'status' | 'lockedby'
type SortDir = 'asc' | 'desc'

function stateLabel(state: FileState): string {
  switch (state) {
    case 'synced': return 'Up to date'
    case 'modified': return 'Modified'
    case 'untracked': return 'New'
    case 'locked-by-you': return 'Checked out'
    case 'locked-by-other': return 'Locked'
  }
}

const STATE_ORDER: Record<FileState, number> = {
  'locked-by-other': 0,
  'locked-by-you': 1,
  'modified': 2,
  'untracked': 3,
  'synced': 4
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

function compareEntries(a: FileEntry, b: FileEntry, key: SortKey, dir: SortDir): number {
  // Directories always come first regardless of sort
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1

  let cmp = 0
  switch (key) {
    case 'name':
      cmp = a.name.localeCompare(b.name)
      break
    case 'partnum':
      cmp = (a.partNumber || '').localeCompare(b.partNumber || '')
      break
    case 'status':
      cmp = STATE_ORDER[a.state] - STATE_ORDER[b.state]
      if (cmp === 0) cmp = a.name.localeCompare(b.name)
      break
    case 'lockedby':
      cmp = (a.lockedBy || '').localeCompare(b.lockedBy || '')
      if (cmp === 0) cmp = a.name.localeCompare(b.name)
      break
  }
  return dir === 'asc' ? cmp : -cmp
}

function sortTree(entries: FileEntry[], key: SortKey, dir: SortDir): FileEntry[] {
  const sorted = [...entries].sort((a, b) => compareEntries(a, b, key, dir))
  return sorted.map(e => e.children
    ? { ...e, children: sortTree(e.children, key, dir) }
    : e)
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
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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

  const setSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const handleContext = (e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  const sortedFiles = useMemo(
    () => sortTree(files, sortKey, sortDir),
    [files, sortKey, sortDir]
  )
  const rows = flattenTree(sortedFiles, 0, collapsed)

  const allFolderPaths = useMemo(() => {
    const out: string[] = []
    const walk = (entries: FileEntry[]) => {
      for (const e of entries) {
        if (e.isDirectory) {
          out.push(e.path)
          if (e.children) walk(e.children)
        }
      }
    }
    walk(files)
    return out
  }, [files])

  const collapseAll = () => setCollapsed(new Set(allFolderPaths))
  const expandAll = () => setCollapsed(new Set())

  const canCheckOut = contextMenu?.file && !contextMenu.file.isDirectory &&
    contextMenu.file.state !== 'locked-by-you' && contextMenu.file.state !== 'locked-by-other'

  const canCheckIn = contextMenu?.file && contextMenu.file.state === 'locked-by-you'

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▴' : ' ▾') : ''

  return (
    <>
      <div className="file-tree-controls">
        <button className="tree-control" onClick={collapseAll} disabled={allFolderPaths.length === 0}>
          Collapse all
        </button>
        <button className="tree-control" onClick={expandAll} disabled={collapsed.size === 0}>
          Expand all
        </button>
      </div>
      <div className="file-table-header">
        <span className="col-name sortable" onClick={() => setSort('name')}>Name{sortArrow('name')}</span>
        <span className="col-partnum sortable" onClick={() => setSort('partnum')}>Part #{sortArrow('partnum')}</span>
        <span className="col-status sortable" onClick={() => setSort('status')}>Status{sortArrow('status')}</span>
        <span className="col-lock sortable" onClick={() => setSort('lockedby')}>Checked Out By{sortArrow('lockedby')}</span>
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
