import { useState, useEffect, useMemo, useCallback } from 'react'
import type {
  AdminConfig, GlobalAdminConfig, GlobalAdminState,
  PartsManifest, PartMeta, ReleaseState, ManufacturingMethod
} from '@shared/types'

type AdminTab = 'settings' | 'parts' | 'approvals' | 'documents' | 'health' | 'tools'

interface JoinedPart {
  path: string
  partNumber: string
  type: string
  description?: string
  topLevel: string
  meta: PartMeta
}

function topLevelOf(path: string): string {
  const i = path.indexOf('/')
  return i === -1 ? '(root)' : path.slice(0, i)
}

interface Props {
  hasProject: boolean
  onClose: () => void
}

export default function AdminPage({ hasProject, onClose }: Props) {
  const [tab, setTab] = useState<AdminTab>('settings')

  // Per-project (only used in project mode)
  const [config, setConfig] = useState<AdminConfig>({})
  // Install-wide
  const [globalState, setGlobalState] = useState<GlobalAdminState | null>(null)
  const [globalForm, setGlobalForm] = useState<GlobalAdminConfig>({})

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncingCots, setSyncingCots] = useState(false)
  const [taggingNow, setTaggingNow] = useState(false)
  const [tagName, setTagName] = useState(() => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `progress-${yyyy}-${mm}-${dd}`
  })
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [generating, setGenerating] = useState<null | 'bom' | 'manufacturing' | 'summary' | 'bom-by-subsystem'>(null)
  const [generated, setGenerated] = useState<Record<string, { filePath: string; relPath: string; pdfFilePath?: string } | undefined>>({})
  const [scanning, setScanning] = useState(false)
  const [largeFiles, setLargeFiles] = useState<Array<{
    path: string
    absolutePath: string
    size: number
    isLfsTracked: boolean
    status: 'blocker' | 'warning' | 'ok-lfs' | 'lfs-too-large'
  }> | null>(null)

  // Parts Manager
  const [partsLoading, setPartsLoading] = useState(false)
  const [allParts, setAllParts] = useState<JoinedPart[]>([])
  const [partsFilter, setPartsFilter] = useState('')
  const [partsSubsystem, setPartsSubsystem] = useState<string>('all')
  const [partsState, setPartsState] = useState<ReleaseState | 'all'>('all')
  const [rowSaving, setRowSaving] = useState<string | null>(null)

  // Tools
  const [integrity, setIntegrity] = useState<null | {
    duplicates?: Array<{ partNumber: string; paths: string[] }>
    orphanedDrawings?: Array<{ path: string; linkedTo: string }>
    tombstones?: string[]
    orphanedMeta?: string[]
  }>(null)
  const [integrityRunning, setIntegrityRunning] = useState(false)
  const [renormRunning, setRenormRunning] = useState(false)

  useEffect(() => {
    let done = 0
    const finish = () => { done++; if (done === (hasProject ? 2 : 1)) setLoaded(true) }

    window.api.getGlobalAdmin()
      .then(state => {
        setGlobalState(state)
        setGlobalForm(state.effective)
      })
      .catch(() => {})
      .finally(finish)

    if (hasProject) {
      window.api.getAdminConfig()
        .then(c => setConfig(c || {}))
        .catch(() => setConfig({}))
        .finally(finish)
      // Pre-populate the main repo URL from the live git remote
      window.api.getMainRemoteUrl().then(url => {
        if (url) setConfig(prev => ({ ...prev, mainRepoUrl: prev.mainRepoUrl || url }))
      }).catch(() => {})
    }
  }, [hasProject])

  const set = <K extends keyof AdminConfig>(key: K, value: AdminConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const setGlobal = <K extends keyof GlobalAdminConfig>(key: K, value: GlobalAdminConfig[K]) => {
    setGlobalForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSaveGlobal = async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      await window.api.saveGlobalAdmin(globalForm)
      const fresh = await window.api.getGlobalAdmin()
      setGlobalState(fresh)
      setGlobalForm(fresh.effective)
      setStatus('Saved locally. This computer keeps these values across updates.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleResetGlobal = async () => {
    setError(null)
    setStatus(null)
    try {
      await window.api.resetGlobalAdmin()
      const fresh = await window.api.getGlobalAdmin()
      setGlobalState(fresh)
      setGlobalForm(fresh.effective)
      setStatus('Reset to team defaults shipped with this install.')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleSaveProject = async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const cleaned: AdminConfig = {}
      ;(Object.keys(config) as (keyof AdminConfig)[]).forEach(key => {
        const v = config[key]
        if (typeof v === 'string' && v.trim() === '') return
        ;(cleaned as Record<string, unknown>)[key] = v
      })
      await window.api.saveAdminConfig(cleaned)
      setStatus('Saved and pushed to git. Teammates will see this on next sync.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleCopyRepoUrl = async () => {
    setError(null)
    setStatus(null)
    const url = (config.mainRepoUrl || '').trim()
    if (!url) { setError('No Git URL to copy'); return }
    try {
      await navigator.clipboard.writeText(url)
      setStatus('Git URL copied to clipboard')
    } catch (err) {
      setError('Could not copy: ' + (err as Error).message)
    }
  }

  const handleCreateTag = async () => {
    setTaggingNow(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.api.createProgressTag(tagName)
      if (result.success) setStatus(`Tag "${tagName}" created and pushed`)
      else setError(result.error || 'Failed to create tag')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setTaggingNow(false)
    }
  }

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
        setStatus(`✓ Wrote ${r.relPath}${pdfNote}. Upload to share with the team.`)
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

  const handleScanLarge = async () => {
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

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const handleSyncCots = async () => {
    setSyncingCots(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.api.syncCots()
      if (result.success) setStatus(result.cloned ? 'COTS repo cloned into COTS/' : 'COTS folder updated.')
      else setError(result.error || 'COTS sync failed')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSyncingCots(false)
    }
  }

  // Parts Manager: bulk-loads the manifest + all per-part meta and
  // joins them into one row per file so the table can render and edit
  // without N IPC calls.
  const loadAllParts = useCallback(async () => {
    if (!hasProject) return
    setPartsLoading(true)
    try {
      const [manifest, allMeta] = await Promise.all([
        window.api.getPartsManifest() as Promise<PartsManifest | null>,
        window.api.getAllPartsMeta() as Promise<Record<string, PartMeta>>
      ])
      if (!manifest) { setAllParts([]); return }
      const rows: JoinedPart[] = Object.entries(manifest.entries).map(([p, e]) => ({
        path: p,
        partNumber: e.partNumber,
        type: e.type,
        description: e.description,
        topLevel: topLevelOf(p),
        meta: allMeta[p] || {}
      }))
      rows.sort((a, b) => {
        if (a.topLevel !== b.topLevel) return a.topLevel.localeCompare(b.topLevel)
        return a.partNumber.localeCompare(b.partNumber)
      })
      setAllParts(rows)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPartsLoading(false)
    }
  }, [hasProject])

  // Auto-load when switching into Parts or Approvals tabs so the user
  // doesn't have to click a refresh button to see anything
  useEffect(() => {
    if ((tab === 'parts' || tab === 'approvals') && hasProject && allParts.length === 0 && !partsLoading) {
      loadAllParts()
    }
  }, [tab, hasProject, allParts.length, partsLoading, loadAllParts])

  // Refresh the parts cache whenever the main process broadcasts a
  // file-change. Meta writes go through broadcastStatus() in ipc.ts so
  // approvals/parts table picks up DetailsPanel / SW add-in edits
  // without the mentor having to click Refresh. Only fires for the
  // tabs that actually render the cached data.
  useEffect(() => {
    if (!hasProject) return
    if (tab !== 'parts' && tab !== 'approvals') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.api.onFileChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { loadAllParts() }, 250)
    })
    return () => {
      if (timer) clearTimeout(timer)
      cleanup()
    }
  }, [tab, hasProject, loadAllParts])

  // Save a single editable cell. Updates the row in-place after success
  // so the table reflects the new value without a full reload.
  const updatePart = async (
    rowPath: string,
    update: (m: PartMeta) => Promise<void>,
    optimisticPatch: Partial<PartMeta>
  ) => {
    setRowSaving(rowPath)
    setError(null)
    try {
      await update({})
      setAllParts(prev => prev.map(r =>
        r.path === rowPath ? { ...r, meta: { ...r.meta, ...optimisticPatch } } : r
      ))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRowSaving(null)
    }
  }

  const handleSetReleaseState = (rowPath: string, state: ReleaseState) =>
    updatePart(rowPath, () => window.api.setReleaseState(rowPath, state), { release: { state } })

  const handleSetMethod = (rowPath: string, method: ManufacturingMethod | null) =>
    updatePart(rowPath, () => window.api.setManufacturingMethod(rowPath, method), { manufacturingMethod: method ?? undefined })

  const handleSetMaterial = (rowPath: string, material: string) =>
    updatePart(rowPath, () => window.api.setManufacturingMaterial(rowPath, material), { manufacturingMaterial: material })

  const handleSetMass = (rowPath: string, mass: number | null) =>
    updatePart(rowPath, () => window.api.setPartMass(rowPath, mass), { mass: mass ?? undefined })

  const handleSetCost = (rowPath: string, cost: number | null) =>
    updatePart(rowPath, () => window.api.setPartCost(rowPath, cost), { cost: cost ?? undefined })

  // Tools
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
      if (r.success) setStatus('✓ Re-applied .gitattributes filters to every tracked file. Next publish will pick up any changes.')
      else setError(r.error || 'Re-normalize failed')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRenormRunning(false)
    }
  }

  // Derived: parts filtered by search/subsystem/state
  const filteredParts = useMemo(() => {
    const q = partsFilter.trim().toLowerCase()
    return allParts.filter(p => {
      if (partsSubsystem !== 'all' && p.topLevel !== partsSubsystem) return false
      if (partsState !== 'all') {
        const s = p.meta.release?.state ?? 'draft'
        if (s !== partsState) return false
      }
      if (q) {
        const hay = `${p.partNumber} ${p.path} ${p.description ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [allParts, partsFilter, partsSubsystem, partsState])

  const subsystemOptions = useMemo(() => {
    const set = new Set<string>()
    allParts.forEach(p => set.add(p.topLevel))
    return Array.from(set).sort()
  }, [allParts])

  const inReviewParts = useMemo(() =>
    allParts.filter(p => (p.meta.release?.state ?? 'draft') === 'in-review'),
  [allParts])

  // ESC to close the full-screen page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Hidden 9-click sequence in the bottom-right corner. Once triggered,
  // the welcome screen permanently shows an Admin Panel button. Reset
  // the counter if the user pauses for more than 3s between clicks so
  // accidental drags don't half-fill it.
  // NB: must be declared before any conditional return (e.g. !loaded)
  // or React will complain that hook order changed between renders.
  const [cornerClicks, setCornerClicks] = useState(0)
  const [shortcutToast, setShortcutToast] = useState<string | null>(null)
  useEffect(() => {
    if (cornerClicks === 0) return
    if (cornerClicks >= 9) {
      localStorage.setItem('trentcad-admin-shortcut-unlocked', '1')
      // Notify any listening welcome-screen instance in the same window
      // (storage events only fire across windows, not within one).
      window.dispatchEvent(new CustomEvent('admin-shortcut-unlocked'))
      setShortcutToast('Admin shortcut unlocked — look for the button on the welcome screen.')
      setCornerClicks(0)
      const t = setTimeout(() => setShortcutToast(null), 4000)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setCornerClicks(0), 3000)
    return () => clearTimeout(t)
  }, [cornerClicks])

  if (!loaded) return null

  const overrideStatusLine = globalState && globalState.hasLocalOverride
    ? 'Showing your local overrides. These survive app updates until you Reset.'
    : 'Showing team defaults shipped with this install.'

  const tabs: { id: AdminTab; label: string; projectOnly?: boolean }[] = [
    { id: 'settings', label: 'Settings' },
    { id: 'parts', label: 'Parts Manager', projectOnly: true },
    { id: 'approvals', label: 'Approvals', projectOnly: true },
    { id: 'documents', label: 'Documents', projectOnly: true },
    { id: 'health', label: 'Repository Health', projectOnly: true },
    { id: 'tools', label: 'Tools', projectOnly: true }
  ]
  const visibleTabs = tabs.filter(t => !t.projectOnly || hasProject)

  return (
    <div className="admin-fullscreen">
      <div className="admin-topbar">
        <div className="admin-topbar-title">Admin {hasProject ? '' : '· Welcome screen'}</div>
        <div className="admin-topbar-actions">
          <button className="toolbar-btn" onClick={onClose}>Close (Esc)</button>
        </div>
      </div>
      {shortcutToast && <div className="admin-shortcut-toast">{shortcutToast}</div>}
      <div
        className="admin-corner-tap"
        onClick={() => setCornerClicks(c => c + 1)}
        aria-hidden="true"
      />
      <div className="admin-layout">
        <nav className="admin-sidebar">
          {visibleTabs.map(t => (
            <button
              key={t.id}
              className={`admin-sidebar-item${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="admin-content">

        {tab === 'parts' && hasProject && (
          <PartsTab
            loading={partsLoading}
            parts={filteredParts}
            allParts={allParts}
            filter={partsFilter}
            setFilter={setPartsFilter}
            subsystem={partsSubsystem}
            setSubsystem={setPartsSubsystem}
            subsystemOptions={subsystemOptions}
            state={partsState}
            setState={setPartsState}
            rowSaving={rowSaving}
            onRefresh={loadAllParts}
            onSetRelease={handleSetReleaseState}
            onSetMethod={handleSetMethod}
            onSetMaterial={handleSetMaterial}
            onSetMass={handleSetMass}
            onSetCost={handleSetCost}
          />
        )}

        {tab === 'approvals' && hasProject && (
          <ApprovalsTab
            parts={inReviewParts}
            rowSaving={rowSaving}
            onApprove={(p) => handleSetReleaseState(p, 'released')}
            onReject={(p) => handleSetReleaseState(p, 'draft')}
            onRefresh={loadAllParts}
          />
        )}

        {tab === 'tools' && hasProject && (
          <ToolsTab
            integrity={integrity}
            integrityRunning={integrityRunning}
            onIntegrityCheck={handleIntegrityCheck}
            renormRunning={renormRunning}
            onRenormalize={handleRenormalize}
          />
        )}

        {tab === 'settings' && (
          <>
            <p className="admin-warning">
              Team and GitHub Browse settings are saved on this computer only.
              {' '}{overrideStatusLine}
            </p>

            <div className="admin-section">
              <h3>Team</h3>
              <label>Team name</label>
              <input
                value={globalForm.teamName ?? ''}
                onChange={e => setGlobal('teamName', e.target.value)}
                placeholder={globalState?.defaults.teamName || 'FRC Team 2129'}
              />
              <label>Welcome message</label>
              <textarea
                value={globalForm.welcomeMessage ?? ''}
                onChange={e => setGlobal('welcomeMessage', e.target.value)}
                placeholder={globalState?.defaults.welcomeMessage || 'Optional message shown to teammates'}
                rows={2}
              />
            </div>

            <div className="admin-section">
              <h3>GitHub Browse</h3>
              <p className="admin-hint">
                When set, students see a "Browse Projects" button on the welcome
                screen listing repos in this organisation that match the prefix.
                New projects use the prefix automatically.
              </p>
              <label>GitHub organisation</label>
              <input
                value={globalForm.gitHubOrg ?? ''}
                onChange={e => setGlobal('gitHubOrg', e.target.value)}
                placeholder={globalState?.defaults.gitHubOrg || 'netarcx'}
              />
              <label>Project name prefix</label>
              <input
                value={globalForm.projectPrefix ?? ''}
                onChange={e => setGlobal('projectPrefix', e.target.value)}
                placeholder={globalState?.defaults.projectPrefix || 'trentcad-'}
              />
            </div>

            <div className="admin-section-actions">
              <button
                className="toolbar-btn"
                onClick={handleResetGlobal}
                disabled={saving || !globalState?.hasLocalOverride}
                title={globalState?.hasLocalOverride
                  ? 'Discard local overrides and use the team defaults shipped with this install'
                  : 'No local overrides to reset'}
              >
                Reset to team defaults
              </button>
              <button className="toolbar-btn primary" onClick={handleSaveGlobal} disabled={saving}>
                {saving ? 'Saving…' : 'Save (local)'}
              </button>
            </div>

            {hasProject && (
              <>
                <hr className="admin-divider" />

                <p className="admin-warning">
                  The settings below are committed and pushed to <em>this project's</em>
                  {' '}git repo on Save. Every teammate picks them up on their next Download.
                </p>

                <div className="admin-section">
                  <h3>Part Numbering</h3>
                  <label>Default part-number prefix</label>
                  <input
                    value={config.defaultPartPrefix ?? ''}
                    onChange={e => set('defaultPartPrefix', e.target.value)}
                    placeholder="e.g. 26-2129"
                  />
                  <p className="admin-hint">
                    Stays with this project. Used by the auto-numbering when creating
                    new parts and assemblies.
                  </p>
                </div>

                <div className="admin-section">
                  <h3>Main Repository</h3>
                  <label>Git remote URL</label>
                  <div className="inline-input-row">
                    <input
                      value={config.mainRepoUrl ?? ''}
                      onChange={e => set('mainRepoUrl', e.target.value)}
                      placeholder="https://github.com/org/main-project.git"
                    />
                    <button className="toolbar-btn" onClick={handleCopyRepoUrl}>Copy</button>
                  </div>
                  <p className="admin-hint">
                    Saving rewrites this project's `origin` remote to match.
                  </p>
                </div>

                <div className="admin-section">
                  <h3>Self-Hosted LFS Storage <span className="admin-hint-inline">(advanced)</span></h3>
                  <p className="admin-hint">
                    By default, large CAD files are stored in GitHub's LFS.
                    Set a URL here to redirect LFS storage to your own server
                    (rudolfs, giftless, Gitea, GitLab, etc.) — git push/pull
                    still go to GitHub, only the LFS object bytes change
                    hosts. Leave blank to use GitHub LFS. Auth (if your server
                    needs it) is handled by `.netrc` or git credential helpers,
                    not by TrentCAD.
                  </p>
                  <label>LFS server URL</label>
                  <input
                    value={config.lfsUrl ?? ''}
                    onChange={e => set('lfsUrl', e.target.value)}
                    placeholder="https://lfs.your-server.com/team/robot.git/info/lfs"
                  />
                  <p className="admin-hint">
                    Saving writes a <code>.lfsconfig</code> at the project root
                    and pushes it, so teammates auto-pick the redirect on their
                    next sync.
                  </p>
                </div>

                <div className="admin-section">
                  <h3>COTS Library</h3>
                  <p className="admin-hint">
                    Commercial Off-The-Shelf parts live in a separate Git repo and
                    are cloned into a <code>COTS/</code> subfolder. The folder is
                    gitignored so the two histories stay separate.
                  </p>
                  <label>COTS repo URL</label>
                  <input
                    value={config.cotsRepoUrl ?? ''}
                    onChange={e => set('cotsRepoUrl', e.target.value)}
                    placeholder="https://github.com/org/cots-library.git"
                  />
                  <label>COTS branch (optional)</label>
                  <input
                    value={config.cotsBranch ?? ''}
                    onChange={e => set('cotsBranch', e.target.value)}
                    placeholder="main"
                  />
                  <button
                    className="toolbar-btn"
                    onClick={handleSyncCots}
                    disabled={!config.cotsRepoUrl || syncingCots}
                  >
                    {syncingCots ? 'Downloading...' : 'Download COTS now'}
                  </button>
                </div>

                <div className="admin-section">
                  <h3>Weekly Progress Tag</h3>
                  <p className="admin-hint">
                    Annotated Git tag at the current commit, pushed. Use to mark
                    weekly snapshots so the team can browse the CAD state at any
                    past milestone.
                  </p>
                  <label>Tag name</label>
                  <div className="inline-input-row">
                    <input
                      value={tagName}
                      onChange={e => setTagName(e.target.value)}
                      placeholder="progress-2026-05-10"
                    />
                    <button
                      className="toolbar-btn primary"
                      onClick={handleCreateTag}
                      disabled={!tagName.trim() || taggingNow}
                    >
                      {taggingNow ? 'Tagging...' : 'Tag now'}
                    </button>
                  </div>
                </div>

                <div className="admin-section-actions">
                  <button className="toolbar-btn primary" onClick={handleSaveProject} disabled={saving}>
                    {saving ? 'Saving...' : 'Save project settings & Upload'}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'documents' && hasProject && (
          <div className="admin-section">
            <h3>Build & Manufacturing Documents</h3>
            <p className="admin-hint">
              Generate up-to-date documents from this project's part data —
              Bill of Materials, manufacturing cut list, project summary, and
              per-subsystem BOMs. Files write to a <code>Documents/</code>
              folder in the project root and ride along on your next publish.
            </p>
            <div className="doc-grid">
              {(['bom', 'manufacturing', 'summary', 'bom-by-subsystem'] as const).map(t => {
                const meta = ({
                  bom: {
                    title: 'Bill of Materials',
                    sub: 'Every released and in-progress part — one combined sheet',
                  },
                  manufacturing: {
                    title: 'Manufacturing Queue',
                    sub: 'Released + in-review parts grouped by method / material',
                  },
                  summary: {
                    title: 'Project Summary',
                    sub: 'Mass + cost rollup by subsystem and by shop method',
                  },
                  'bom-by-subsystem': {
                    title: 'BOMs by Subsystem',
                    sub: 'One BOM per top-level folder (Drivetrain, Intake, etc.)',
                  }
                } as const)[t]
                const doc = generated[t]
                return (
                  <div key={t} className="doc-card">
                    <div className="doc-card-title">{meta.title}</div>
                    <div className="doc-card-sub">{meta.sub}</div>
                    <div className="doc-card-actions">
                      <button
                        className="toolbar-btn primary"
                        disabled={generating !== null}
                        onClick={() => handleGenerate(t)}
                      >
                        {generating === t ? 'Generating…' : doc ? 'Regenerate' : 'Generate'}
                      </button>
                      {doc && (
                        <button
                          className="toolbar-btn"
                          onClick={() => handleOpenDoc(t)}
                          title={doc.filePath}
                        >
                          Open source
                        </button>
                      )}
                      {doc?.pdfFilePath && (
                        <button
                          className="toolbar-btn"
                          onClick={() => handleOpenPdf(t)}
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
          </div>
        )}

        {tab === 'health' && hasProject && (
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
                onClick={handleScanLarge}
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
          </div>
        )}

        {error && <div className="admin-error">{error}</div>}
        {status && <div className="admin-status">{status}</div>}

        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Sub-components for the new tabs. Kept in the same file to avoid
// component-file sprawl; they read state passed down from AdminPage.
// ---------------------------------------------------------------------

interface PartsTabProps {
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

function PartsTab(props: PartsTabProps) {
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

interface ApprovalsTabProps {
  parts: JoinedPart[]
  rowSaving: string | null
  onApprove: (path: string) => void
  onReject: (path: string) => void
  onRefresh: () => void
}

function ApprovalsTab({ parts, rowSaving, onApprove, onReject, onRefresh }: ApprovalsTabProps) {
  return (
    <div className="admin-section">
      <h3>Approvals — In-Review Parts</h3>
      <p className="admin-hint">
        Parts marked <em>in-review</em> are waiting for a mentor sign-off
        before they enter the manufacturing queue. Approve to mark
        <strong> released</strong>; reject to send back to <strong> draft</strong>.
      </p>
      <div className="admin-section-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="toolbar-btn" onClick={onRefresh}>Refresh</button>
        <span className="parts-count">{parts.length} awaiting review</span>
      </div>
      {parts.length === 0 ? (
        <div className="admin-status">✓ No parts waiting on a review right now.</div>
      ) : (
        <div className="approvals-list">
          {parts.map(p => {
            const filename = p.path.includes('/') ? p.path.slice(p.path.lastIndexOf('/') + 1) : p.path
            const isSaving = rowSaving === p.path
            return (
              <div key={p.path} className="approval-row">
                <div className="approval-main">
                  <div className="approval-pn">{p.partNumber}</div>
                  <div className="approval-meta">
                    <strong>{filename}</strong> · {p.topLevel}
                    {p.meta.manufacturingMethod && <> · {p.meta.manufacturingMethod}</>}
                    {p.meta.manufacturingMaterial && <> · {p.meta.manufacturingMaterial}</>}
                    {typeof p.meta.mass === 'number' && <> · {p.meta.mass.toFixed(2)} lb</>}
                  </div>
                  {p.description && <div className="approval-desc">{p.description}</div>}
                </div>
                <div className="approval-actions">
                  <button
                    className="toolbar-btn"
                    onClick={() => onReject(p.path)}
                    disabled={isSaving}
                  >
                    Send back to draft
                  </button>
                  <button
                    className="toolbar-btn primary"
                    onClick={() => onApprove(p.path)}
                    disabled={isSaving}
                  >
                    Approve & release
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ToolsTabProps {
  integrity: null | {
    duplicates?: Array<{ partNumber: string; paths: string[] }>
    orphanedDrawings?: Array<{ path: string; linkedTo: string }>
    tombstones?: string[]
    orphanedMeta?: string[]
  }
  integrityRunning: boolean
  onIntegrityCheck: () => void
  renormRunning: boolean
  onRenormalize: () => void
}

function ToolsTab(props: ToolsTabProps) {
  const { integrity, integrityRunning, onIntegrityCheck, renormRunning, onRenormalize } = props
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
          <button className="toolbar-btn primary" onClick={onIntegrityCheck} disabled={integrityRunning}>
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
          <button className="toolbar-btn primary" onClick={onRenormalize} disabled={renormRunning}>
            {renormRunning ? 'Re-normalizing…' : 'Re-normalize all files'}
          </button>
        </div>
      </div>
    </>
  )
}
