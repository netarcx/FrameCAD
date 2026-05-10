import { useState } from 'react'
import type { FileEntry } from '@shared/types'

interface Props {
  onSync: () => void
  onPublish: (message: string) => void
  onCheckOut: (path: string) => void
  onCheckIn: (path: string) => void
  selectedFile: FileEntry | null
  isLoading: boolean
  hasProject: boolean
}

export default function Toolbar({ onSync, onPublish, onCheckOut, onCheckIn, selectedFile, isLoading, hasProject }: Props) {
  const [showPublish, setShowPublish] = useState(false)
  const [message, setMessage] = useState('')

  const handlePublish = () => {
    if (!message.trim()) return
    onPublish(message.trim())
    setMessage('')
    setShowPublish(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePublish()
    if (e.key === 'Escape') setShowPublish(false)
  }

  const canCheckOut = selectedFile && !selectedFile.isDirectory &&
    selectedFile.state !== 'locked-by-you' && selectedFile.state !== 'locked-by-other'

  const canCheckIn = selectedFile?.state === 'locked-by-you'

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-group">
          <button
            className="toolbar-btn"
            onClick={onSync}
            disabled={!hasProject || isLoading}
            title="Get the latest files from your team"
          >
            {isLoading ? <span className="loading-spinner" /> : '↻'} Sync
          </button>
          <button
            className="toolbar-btn primary"
            onClick={() => setShowPublish(true)}
            disabled={!hasProject || isLoading}
            title="Save and share your changes with the team"
          >
            {'↑'} Publish
          </button>
        </div>

        <div className="toolbar-sep" />

        <div className="toolbar-group">
          <button
            className="toolbar-btn"
            onClick={() => selectedFile && onCheckOut(selectedFile.path)}
            disabled={!canCheckOut || isLoading}
            title="Lock this file so only you can edit it"
          >
            Check Out
          </button>
          <button
            className="toolbar-btn"
            onClick={() => selectedFile && onCheckIn(selectedFile.path)}
            disabled={!canCheckIn || isLoading}
            title="Unlock this file so others can edit it"
          >
            Check In
          </button>
        </div>

        <div className="toolbar-spacer" />
      </div>

      {showPublish && (
        <div className="modal-overlay" onClick={() => setShowPublish(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Publish Changes</h2>
            <input
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What did you change? (e.g., Updated gearbox plate dimensions)"
              autoFocus
            />
            <div className="actions">
              <button className="toolbar-btn" onClick={() => setShowPublish(false)}>Cancel</button>
              <button
                className="toolbar-btn primary"
                onClick={handlePublish}
                disabled={!message.trim() || isLoading}
              >
                {isLoading ? <span className="loading-spinner" /> : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
