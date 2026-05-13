import { useState, useEffect, useMemo, useCallback } from 'react'
import type { PartsManifest, PartMeta, ReleaseState, ManufacturingMethod } from '@shared/types'
import { type JoinedPart, topLevelOf } from '../components/PartsManager'

interface UsePartsOptions {
  enabled: boolean
}

export default function useParts({ enabled }: UsePartsOptions) {
  const [loading, setLoading] = useState(false)
  const [allParts, setAllParts] = useState<JoinedPart[]>([])
  const [filter, setFilter] = useState('')
  const [subsystem, setSubsystem] = useState<string>('all')
  const [stateFilter, setStateFilter] = useState<ReleaseState | 'all'>('all')
  const [rowSaving, setRowSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      timer = setTimeout(() => { loadAllParts() }, 250)
    })
    return () => {
      if (timer) clearTimeout(timer)
      cleanup()
    }
  }, [enabled, loadAllParts])

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

  const setReleaseState = (path: string, state: ReleaseState) =>
    updatePart(path, () => window.api.setReleaseState(path, state), { release: { state } })

  const setMethod = (path: string, method: ManufacturingMethod | null) =>
    updatePart(path, () => window.api.setManufacturingMethod(path, method), { manufacturingMethod: method ?? undefined })

  const setMaterial = (path: string, material: string) =>
    updatePart(path, () => window.api.setManufacturingMaterial(path, material), { manufacturingMaterial: material })

  const setMass = (path: string, mass: number | null) =>
    updatePart(path, () => window.api.setPartMass(path, mass), { mass: mass ?? undefined })

  const setCost = (path: string, cost: number | null) =>
    updatePart(path, () => window.api.setPartCost(path, cost), { cost: cost ?? undefined })

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
    rowSaving,
    loadAllParts,
    setReleaseState,
    setMethod,
    setMaterial,
    setMass,
    setCost
  }
}
