import type { ReleaseState, ManufacturingMethod, PartMeta } from '@shared/types'

export interface JoinedPart {
  path: string
  partNumber: string
  type: string
  description?: string
  topLevel: string
  meta: PartMeta
}

export function topLevelOf(path: string): string {
  const i = path.indexOf('/')
  return i === -1 ? '(root)' : path.slice(0, i)
}

interface Props {
  loading: boolean
  parts: JoinedPart[]
  allParts: JoinedPart[]
  filter: string
  setFilter: (s: string) => void
  subsystem: string
  setSubsystem: (s: string) => void
  subsystemOptions: string[]
  state: ReleaseState | 'all'
  setState: (s: ReleaseState | 'all') => void
  rowSaving: string | null
  onRefresh: () => void
  onSetRelease: (path: string, state: ReleaseState) => void
  onSetMethod: (path: string, m: ManufacturingMethod | null) => void
  onSetMaterial: (path: string, m: string) => void
  onSetMass: (path: string, mass: number | null) => void
  onSetCost: (path: string, cost: number | null) => void
}

export default function PartsManager(props: Props) {
  const {
    loading, parts, allParts, filter, setFilter, subsystem, setSubsystem,
    subsystemOptions, state, setState, rowSaving,
    onRefresh, onSetRelease, onSetMethod, onSetMaterial, onSetMass, onSetCost
  } = props

  return (
    <div className="admin-section">
      <h3>Parts Manager</h3>
      <p className="admin-hint">
        Inline-edit metadata for every part in the project. Changes save
        automatically when you leave a cell. Mentors: use this to fix
        misclassified parts, bulk-update material/method, or move parts
        between release states.
      </p>
      <div className="parts-filter-row">
        <input
          placeholder="Search part #, file, description…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <select value={subsystem} onChange={e => setSubsystem(e.target.value)}>
          <option value="all">All subsystems</option>
          {subsystemOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={state} onChange={e => setState(e.target.value as ReleaseState | 'all')}>
          <option value="all">All states</option>
          <option value="draft">draft</option>
          <option value="in-review">in-review</option>
          <option value="released">released</option>
          <option value="manufactured">manufactured</option>
        </select>
        <button className="toolbar-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="parts-count">{parts.length} of {allParts.length}</span>
      </div>
      {loading && <div className="admin-status">Loading parts…</div>}
      {!loading && parts.length === 0 && (
        <div className="admin-status">
          {allParts.length === 0 ? 'No parts in this project yet.' : 'No parts match the current filter.'}
        </div>
      )}
      {!loading && parts.length > 0 && (
        <div className="parts-table-wrap">
          <table className="parts-table">
            <thead>
              <tr>
                <th>Part #</th>
                <th>File</th>
                <th>Subsystem</th>
                <th>Release</th>
                <th>Method</th>
                <th>Material</th>
                <th>Mass (lb)</th>
                <th>Cost ($)</th>
              </tr>
            </thead>
            <tbody>
              {parts.map(p => {
                const filename = p.path.includes('/') ? p.path.slice(p.path.lastIndexOf('/') + 1) : p.path
                const isSaving = rowSaving === p.path
                return (
                  <tr key={p.path} className={isSaving ? 'parts-row-saving' : ''}>
                    <td className="parts-cell-pn">{p.partNumber}</td>
                    <td className="parts-cell-file" title={p.path}>{filename}</td>
                    <td>{p.topLevel}</td>
                    <td>
                      <select
                        value={p.meta.release?.state ?? 'draft'}
                        onChange={e => onSetRelease(p.path, e.target.value as ReleaseState)}
                        disabled={isSaving}
                      >
                        <option value="draft">draft</option>
                        <option value="in-review">in-review</option>
                        <option value="released">released</option>
                        <option value="manufactured">manufactured</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={p.meta.manufacturingMethod ?? ''}
                        onChange={e => onSetMethod(p.path, e.target.value ? e.target.value as ManufacturingMethod : null)}
                        disabled={isSaving}
                      >
                        <option value="">—</option>
                        <option value="print">3D Print</option>
                        <option value="cnc">CNC</option>
                        <option value="manual">Hand</option>
                        <option value="other">Other</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        list="default-materials"
                        defaultValue={p.meta.manufacturingMaterial ?? ''}
                        onBlur={e => {
                          const v = e.target.value.trim()
                          if (v !== (p.meta.manufacturingMaterial ?? '')) onSetMaterial(p.path, v)
                        }}
                        disabled={isSaving}
                        placeholder="—"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={typeof p.meta.mass === 'number' ? p.meta.mass : ''}
                        onBlur={e => {
                          const raw = e.target.value.trim()
                          const parsed = raw === '' ? null : parseFloat(raw)
                          const same = (parsed === null && typeof p.meta.mass !== 'number') ||
                            (parsed !== null && parsed === p.meta.mass)
                          if (!same) onSetMass(p.path, parsed)
                        }}
                        disabled={isSaving}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={typeof p.meta.cost === 'number' ? p.meta.cost : ''}
                        onBlur={e => {
                          const raw = e.target.value.trim()
                          const parsed = raw === '' ? null : parseFloat(raw)
                          const same = (parsed === null && typeof p.meta.cost !== 'number') ||
                            (parsed !== null && parsed === p.meta.cost)
                          if (!same) onSetCost(p.path, parsed)
                        }}
                        disabled={isSaving}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
