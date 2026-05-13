import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { BulkMetaPatch, PartsManifest, PartMeta, ReleaseState, ManufacturingMethod } from '@shared/types'
import { type JoinedPart, topLevelOf } from '../components/PartsManager'

interface UsePartsOptions {
  enabled: boolean
}

// Idle time after the last edit before we flush queued edits to git.
// Picked to feel snappy for a user click-stream but long enough to fold
// a small bulk-tab into one commit.
const FLUSH_DEBOUNCE_MS = 1200

export default function useParts({ enabled }: UsePartsOptions) {
  const [loading, setLoading] = useState(false)
  const [allParts, setAllParts] = useState<JoinedPart[]>([])
  const [filter, setFilter] = useState('')
  const [subsystem, setSubsystem] = useState<string>('all')
  const [stateFilter, setStateFilter] = useState<ReleaseState | 'all'>('all')
  const [error, setError] = useState<string | null>(null)

  // Edit queue + flush state. Edits land in `pendingRef` immediately and
  // are mirrored to `pendingCount` for the UI. A debounce timer flushes
  // the queue via bulkUpdateMeta; while a flush is in-flight, new edits
  // accumulate in a fresh queue and trigger another flush after debounce.
  const pendingRef = useRef<Map<string, BulkMetaPatch>>(new Map())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [flushing, setFlushing] = useState(false)

  const loadAllParts = useCallback(async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled && !loading) {
      loadAllParts()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.api.onFileChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        // If we have unsaved local edits, skip the reload — otherwise the
        // file-change event from our own commit would clobber them.
        if (pendingRef.current.size > 0 || flushing) return
        loadAllParts()
      }, 250)
    })
    return () => {
      if (timer) clearTimeout(timer)
      cleanup()
    }
  }, [enabled, loadAllParts, flushing])

  const flushNow = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    if (pendingRef.current.size === 0) return
    const batch = Object.fromEntries(pendingRef.current)
    pendingRef.current = new Map()
    setPendingCount(0)
    setFlushing(true)
    setError(null)
    try {
      await window.api.bulkUpdateMeta(batch)
    } catch (err) {
      setError((err as Error).message)
      // Reload to revert optimistic state on hard failure
      loadAllParts()
    } finally {
      setFlushing(false)
    }
  }, [loadAllParts])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      flushNow()
    }, FLUSH_DEBOUNCE_MS)
  }, [flushNow])

  // Flush on unmount so navigating away doesn't drop edits.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      if (pendingRef.current.size > 0) {
        const batch = Object.fromEntries(pendingRef.current)
        pendingRef.current = new Map()
        // Fire-and-forget; the hook is going away so we can't surface errors.
        window.api.bulkUpdateMeta(batch).catch(() => {})
      }
    }
  }, [])

  const queueEdit = useCallback((path: string, patch: BulkMetaPatch, optimisticPatch: Partial<PartMeta>) => {
    const existing = pendingRef.current.get(path) || {}
    pendingRef.current.set(path, { ...existing, ...patch })
    setPendingCount(pendingRef.current.size)
    setAllParts(prev => prev.map(r =>
      r.path === path ? { ...r, meta: { ...r.meta, ...optimisticPatch } } : r
    ))
    scheduleFlush()
  }, [scheduleFlush])

  const setReleaseState = useCallback((path: string, state: ReleaseState) => {
    queueEdit(path, { release: state }, { release: { state } })
  }, [queueEdit])

  const setMethod = useCallback((path: string, method: ManufacturingMethod | null) => {
    queueEdit(path, { manufacturingMethod: method }, { manufacturingMethod: method ?? undefined })
  }, [queueEdit])

  const setMaterial = useCallback((path: string, material: string) => {
    queueEdit(path, { manufacturingMaterial: material }, { manufacturingMaterial: material })
  }, [queueEdit])

  // Mass/cost are per-part numerical fields not in the bulk path. Keep
  // them on the single-call path so existing callers (DetailsPanel etc.)
  // and per-cell editing both still work, just without blocking the UI.
  const setMass = useCallback(async (path: string, mass: number | null) => {
    setAllParts(prev => prev.map(r =>
      r.path === path ? { ...r, meta: { ...r.meta, mass: mass ?? undefined } } : r
    ))
    try {
      await window.api.setPartMass(path, mass)
    } catch (err) {
      setError((err as Error).message)
      loadAllParts()
    }
  }, [loadAllParts])

  const setCost = useCallback(async (path: string, cost: number | null) => {
    setAllParts(prev => prev.map(r =>
      r.path === path ? { ...r, meta: { ...r.meta, cost: cost ?? undefined } } : r
    ))
    try {
      await window.api.setPartCost(path, cost)
    } catch (err) {
      setError((err as Error).message)
      loadAllParts()
    }
  }, [loadAllParts])

  // Bulk-select Apply path: same queue, but flush immediately so the
  // user sees the commit happen right after they clicked the button.
  const bulkApply = useCallback(async (paths: string[], patch: BulkMetaPatch) => {
    if (paths.length === 0 || Object.keys(patch).length === 0) return
    const optimisticPatch: Partial<PartMeta> = {}
    if (patch.release !== undefined) optimisticPatch.release = { state: patch.release }
    if (patch.manufacturingMethod !== undefined) {
      optimisticPatch.manufacturingMethod = patch.manufacturingMethod ?? undefined
    }
    if (patch.manufacturingMaterial !== undefined) {
      optimisticPatch.manufacturingMaterial = (patch.manufacturingMaterial ?? '').trim() || undefined
    }
    for (const p of paths) {
      const existing = pendingRef.current.get(p) || {}
      pendingRef.current.set(p, { ...existing, ...patch })
    }
    setPendingCount(pendingRef.current.size)
    setAllParts(prev => prev.map(r =>
      paths.includes(r.path) ? { ...r, meta: { ...r.meta, ...optimisticPatch } } : r
    ))
    await flushNow()
  }, [flushNow])

  const filteredParts = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return allParts.filter(p => {
      if (subsystem !== 'all' && p.topLevel !== subsystem) return false
      if (stateFilter !== 'all') {
        const s = p.meta.release?.state ?? 'draft'
        if (s !== stateFilter) return false
      }
      if (q) {
        const hay = `${p.partNumber} ${p.path} ${p.description ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [allParts, filter, subsystem, stateFilter])

  const subsystemOptions = useMemo(() => {
    const set = new Set<string>()
    allParts.forEach(p => set.add(p.topLevel))
    return Array.from(set).sort()
  }, [allParts])

  const inReviewParts = useMemo(() =>
    allParts.filter(p => (p.meta.release?.state ?? 'draft') === 'in-review'),
  [allParts])

  return {
    allParts,
    filteredParts,
    inReviewParts,
    loading,
    error,
    subsystemOptions,
    filter, setFilter,
    subsystem, setSubsystem,
    stateFilter, setStateFilter,
    pendingCount,
    flushing,
    flushNow,
    loadAllParts,
    setReleaseState,
    setMethod,
    setMaterial,
    setMass,
    setCost,
    bulkApply
  }
}
