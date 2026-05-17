import { useState } from 'react'
import ErrorMsg from './ErrorMsg'

export default function DocumentsPanel() {
  const [generating, setGenerating] = useState<null | 'bom' | 'manufacturing' | 'summary' | 'bom-by-subsystem'>(null)
  const [generated, setGenerated] = useState<Record<string, { filePath: string; relPath: string; pdfFilePath?: string } | undefined>>({})
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const handleGenerate = async (type: 'bom' | 'manufacturing' | 'summary' | 'bom-by-subsystem') => {
    setGenerating(type)
    setError(null)
    setStatus(null)
    try {
      const r = await window.api.generateDocument(type)
      if (r.success && r.filePath && r.relPath) {
        setGenerated(prev => ({
          ...prev,
          [type]: { filePath: r.filePath!, relPath: r.relPath!, pdfFilePath: r.pdfFilePath }
        }))
        const pdfNote = r.pdfFilePath
          ? ' (PDF written too)'
          : r.pdfError ? ` — PDF failed: ${r.pdfError}` : ''
        setStatus(`Wrote ${r.relPath}${pdfNote}. Upload to share with the team.`)
      } else {
        setError(r.error || 'Could not generate document')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGenerating(null)
    }
  }

  const handleOpenDoc = async (type: 'bom' | 'manufacturing' | 'summary' | 'bom-by-subsystem') => {
    const doc = generated[type]
    if (!doc) return
    const r = await window.api.openPath(doc.filePath)
    if (!r.success) setError(r.error || 'Could not open file')
  }

  const handleOpenPdf = async (type: 'bom' | 'manufacturing' | 'summary' | 'bom-by-subsystem') => {
    const doc = generated[type]
    if (!doc?.pdfFilePath) return
    const r = await window.api.openPath(doc.pdfFilePath)
    if (!r.success) setError(r.error || 'Could not open PDF')
  }

  const docs = [
    { id: 'bom' as const, title: 'Bill of Materials', sub: 'Every released and in-progress part — one combined sheet' },
    { id: 'manufacturing' as const, title: 'Manufacturing Queue', sub: 'Released + in-review parts grouped by method / material' },
    { id: 'summary' as const, title: 'Project Summary', sub: 'Mass + cost rollup by subsystem and by shop method' },
    { id: 'bom-by-subsystem' as const, title: 'BOMs by Subsystem', sub: 'One BOM per top-level folder (Drivetrain, Intake, etc.)' }
  ]

  return (
    <div className="admin-section">
      <h3>Build & Manufacturing Documents</h3>
      <p className="admin-hint">
        Generate up-to-date documents from this project's part data —
        Bill of Materials, manufacturing cut list, project summary, and
        per-subsystem BOMs. Files write to a <code>Documents/</code>
        folder in the project root and ride along on your next publish.
      </p>
      <div className="doc-grid">
        {docs.map(d => {
          const doc = generated[d.id]
          return (
            <div key={d.id} className="doc-card">
              <div className="doc-card-title">{d.title}</div>
              <div className="doc-card-sub">{d.sub}</div>
              <div className="doc-card-actions">
                <button
                  className="toolbar-btn primary"
                  disabled={generating !== null}
                  onClick={() => handleGenerate(d.id)}
                >
                  {generating === d.id ? 'Generating…' : doc ? 'Regenerate' : 'Generate'}
                </button>
                {doc && (
                  <button
                    className="toolbar-btn"
                    onClick={() => handleOpenDoc(d.id)}
                    title={doc.filePath}
                  >
                    Open source
                  </button>
                )}
                {doc?.pdfFilePath && (
                  <button
                    className="toolbar-btn"
                    onClick={() => handleOpenPdf(d.id)}
                    title={doc.pdfFilePath}
                  >
                    Open PDF
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {error && <ErrorMsg text={error} />}
      {status && <div className="admin-status">{status}</div>}
    </div>
  )
}
