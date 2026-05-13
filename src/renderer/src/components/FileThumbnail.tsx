import { useEffect, useState, type ReactNode } from 'react'

/**
 * Module-level cache mirroring the main-process thumbnail cache. Prevents
 * duplicate IPC calls when the same path appears in multiple FileRow
 * instances within a single React tree. Keyed by `<size>:<path>`.
 *
 * Each value is either `string` (data URL), `null` (resolved as no
 * thumbnail available), or `Promise<...>` (in flight — co-located so
 * concurrent renders await the same promise instead of firing N
 * duplicate IPCs).
 */
const rendererCache = new Map<string, string | null | Promise<string | null>>()

function fetchThumbnail(path: string, size: number): Promise<string | null> {
  const key = `${size}:${path}`
  const cached = rendererCache.get(key)
  if (cached !== undefined) {
    if (cached instanceof Promise) return cached
    return Promise.resolve(cached)
  }
  const promise = window.api.getThumbnail(path, size)
    .then(dataUrl => {
      rendererCache.set(key, dataUrl)
      return dataUrl
    })
    .catch(() => {
      rendererCache.set(key, null)
      return null
    })
  rendererCache.set(key, promise)
  return promise
}

interface Props {
  path: string
  size: number
  /** Rendered while the thumbnail is loading or unavailable. Should be
   *  the cheap letter-icon style placeholder so the file table stays
   *  stable while async thumbnails resolve. */
  fallback: ReactNode
  className?: string
  title?: string
}

export default function FileThumbnail({ path, size, fallback, className, title }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchThumbnail(path, size).then(url => {
      if (!cancelled) setDataUrl(url)
    })
    return () => { cancelled = true }
  }, [path, size])

  if (dataUrl) {
    return (
      <img
        className={className}
        src={dataUrl}
        alt=""
        width={size}
        height={size}
        title={title}
        draggable={false}
      />
    )
  }
  return <>{fallback}</>
}

/** Drop the renderer-side cache, e.g. when the project closes. */
export function clearRendererThumbnailCache(): void {
  rendererCache.clear()
}
