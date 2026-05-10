import { useState } from 'react'
import type { FileEntry } from '@shared/types'

interface Props {
  onSync: () => void
  onPublish: (message: string) => void
  onCheckOut: (path: string) => void
  onCheckIn: (path: string) => void
  onNewPart: (folder: string, description?: string) => Promise<{ partNumber: string; filePath: string } | null>
  onNewAssembly: (parentFolder: string, name: string, description?: string) => Promise<{ partNumber: string; filePath: string } | null>
  selectedFile: FileEntry | null
  isLoading: boolean
  hasProject: boolean
}

function getSelectedFolder(file: FileEntry | null): string {
  if (!file) return ''
  if (file.isDirectory) return file.path
  return file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
}

export default function Toolbar({ onSync, onPublish, onCheckOut, onCheckIn, onNewPart, onNewAssembly, selectedFile, isLoading, hasProject }: Props) {
  const [showPublish, setShowPublish] = useState(false)
  const [message, setMessage] = useState('')
  const [showNewPart, setShowNewPart] = useState(false)
  const [showNewAssembly, setShowNewAssembly] = useState(false)
  const [partDescription, setPartDescription] = useState('')
  const [assemblyName, setAssemblyName] = useState('')
  const [assemblyDescription, setAssemblyDescription] = useState('')
  const [createdInfo, setCreatedInfo] = useState<{ partNumber: string; filePath: string } | null>(null)

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

  const handleNewPart = async () => {
    const folder = getSelectedFolder(selectedFile)
    const result = await onNewPart(folder, partDescription.trim() || undefined)
    if (result) {
      setCreatedInfo(result)
      setPartDescription('')
      setShowNewPart(false)
    }
  }

  const handleNewAssembly = async () => {
    if (!assemblyName.trim()) return
    const parentFolder = getSelectedFolder(selectedFile)
    const result = await onNewAssembly(parentFolder, assemblyName.trim(), assemblyDescription.trim() || undefined)
    if (result) {
      setCreatedInfo(result)
      setAssemblyName('')
      setAssemblyDescription('')
      setShowNewAssembly(false)
    }
  }

  const canCheckOut = selectedFile && !selectedFile.isDirectory &&
    selectedFile.state !== 'locked-by-you' && selectedFile.state !== 'locked-by-other'

  const canCheckIn = selectedFile?.state === 'locked-by-you'

  const currentFolder = getSelectedFolder(selectedFile)

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

        <div className="toolbar-sep" />

        <div className="toolbar-group">
          <button
            className="toolbar-btn"
            onClick={() => setShowNewPart(true)}
            disabled={!hasProject || isLoading}
            title="Create a new part file with an assigned part number"
          >
            + Part
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setShowNewAssembly(true)}
            disabled={!hasProject || isLoading}
            title="Create a new assembly folder with an assigned part number"
          >
            + Assembly
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

      {showNewPart && (
        <div className="modal-overlay" onClick={() => setShowNewPart(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Part</h2>
            <div className="modal-info">
              Creating in: <span className="modal-path">{currentFolder || '/ (project root)'}</span>
            </div>
            <input
              value={partDescription}
              onChange={e => setPartDescription(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleNewPart()
                if (e.key === 'Escape') setShowNewPart(false)
              }}
              placeholder="Description (optional, e.g., Gearbox Plate)"
              autoFocus
            />
            <div className="actions">
              <button className="toolbar-btn" onClick={() => setShowNewPart(false)}>Cancel</button>
              <button
                className="toolbar-btn primary"
                onClick={handleNewPart}
                disabled={isLoading}
              >
                Create Part
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewAssembly && (
        <div className="modal-overlay" onClick={() => setShowNewAssembly(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Assembly</h2>
            <div className="modal-info">
              Creating in: <span className="modal-path">{currentFolder || '/ (project root)'}</span>
            </div>
            <input
              value={assemblyName}
              onChange={e => setAssemblyName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleNewAssembly()
                if (e.key === 'Escape') setShowNewAssembly(false)
              }}
              placeholder="Assembly name (e.g., Drivetrain)"
              autoFocus
            />
            <input
              value={assemblyDescription}
              onChange={e => setAssemblyDescription(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleNewAssembly()
                if (e.key === 'Escape') setShowNewAssembly(false)
              }}
              placeholder="Description (optional)"
              style={{ marginTop: 8 }}
            />
            <div className="actions">
              <button className="toolbar-btn" onClick={() => setShowNewAssembly(false)}>Cancel</button>
              <button
                className="toolbar-btn primary"
                onClick={handleNewAssembly}
                disabled={!assemblyName.trim() || isLoading}
              >
                Create Assembly
              </button>
            </div>
          </div>
        </div>
      )}

      {createdInfo && (
        <div className="modal-overlay" onClick={() => setCreatedInfo(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Part Created</h2>
            <div className="created-details">
              <div className="created-number">{createdInfo.partNumber}</div>
              <div className="created-path">{createdInfo.filePath}</div>
              <p className="created-hint">
                Open SolidWorks and save your work to this file.
              </p>
            </div>
            <div className="actions">
              <button
                className="toolbar-btn"
                onClick={() => {
                  window.api.openFileExplorer(createdInfo.filePath)
                  setCreatedInfo(null)
                }}
              >
                Show in Explorer
              </button>
              <button className="toolbar-btn primary" onClick={() => setCreatedInfo(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
