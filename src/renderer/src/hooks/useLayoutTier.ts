import { useState, useEffect } from 'react'

export type LayoutTier = 'wide' | 'medium' | 'compact'

/**
 * Returns the current responsive layout tier based on window width.
 *
 *   wide   ≥1280 — full layout (sidebar + content + DetailsPanel)
 *   medium 1024–1279 — sidebar visible, DetailsPanel becomes an overlay
 *   compact <1024 — sidebar collapses to icons-only, DetailsPanel overlay
 *
 * The width breakpoints are relative to the renderer's `innerWidth`,
 * not the screen. Electron BrowserWindow can be resized to any size
 * above the main-process minWidth so we want layout to track the window
 * exactly. Updates on every `resize` event (no debounce — React + flex
 * layout reflow cheap enough that throttling is unnecessary here).
 */
export default function useLayoutTier(): LayoutTier {
  const [tier, setTier] = useState<LayoutTier>(() => computeTier(window.innerWidth))
  useEffect(() => {
    const onResize = () => setTier(computeTier(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return tier
}

function computeTier(width: number): LayoutTier {
  if (width >= 1280) return 'wide'
  if (width >= 1024) return 'medium'
  return 'compact'
}
