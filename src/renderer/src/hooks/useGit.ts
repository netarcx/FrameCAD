import { useState, useCallback, useEffect, useRef } from 'react'
import type { FileEntry, HistoryEntry, ProjectConfig, LockInfo } from '@shared/types'

export function useGit() {
  const [project, setProject] = useState<ProjectConfig | null>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [locks, setLocks] = useState<LockInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    cleanupRef.current = window.api.onFileChange((newFiles) => {
      setFiles(newFiles)
    })
    const errorCleanup = window.api.onError((err) => {
      setError(err)
    })
    return () => {
      cleanupRef.current?.()
      errorCleanup()
    }
  }, [])

  async function fetchAll(): Promise<void> {
    const [newFiles, newHistory, newLocks] = await Promise.all([
      window.api.getStatus(),
      window.api.getHistory(),
      window.api.getLocks()
    ])
    setFiles(newFiles)
    setHistory(newHistory)
    setLocks(newLocks)
  }

  const refresh = useCallback(async () => {
    if (!project) return
    try {
      await fetchAll()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [project])

  const createProject = useCallback(async (name: string, path: string, remote: string) => {
    setIsLoading(true)
    setError(null)
    try {
      await window.api.createProject(name, path, remote)
      const config = await window.api.getProjectConfig()
      setProject(config)
      await fetchAll()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const joinProject = useCallback(async (url: string, path: string) => {
    setIsLoading(true)
    setError(null)
    try {
      await window.api.joinProject(url, path)
      const config = await window.api.getProjectConfig()
      setProject(config)
      await fetchAll()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const openProject = useCallback(async (path: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const config = await window.api.openProject(path)
      setProject(config)
      await fetchAll()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const sync = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.api.sync()
      if (!result.success) {
        setError(result.error || 'Sync failed')
      }
      await fetchAll()
      return result
    } catch (err) {
      setError((err as Error).message)
      return { success: false, filesUpdated: 0, error: (err as Error).message }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const publish = useCallback(async (message: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.api.publish(message)
      if (!result.success) {
        setError(result.error || 'Publish failed')
      }
      await fetchAll()
      return result
    } catch (err) {
      setError((err as Error).message)
      return { success: false, error: (err as Error).message }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const checkOut = useCallback(async (filePath: string) => {
    setError(null)
    try {
      await window.api.checkOut(filePath)
      await fetchAll()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const checkIn = useCallback(async (filePath: string) => {
    setError(null)
    try {
      await window.api.checkIn(filePath)
      await fetchAll()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  return {
    project,
    files,
    history,
    locks,
    isLoading,
    error,
    selectedFile,
    setSelectedFile,
    createProject,
    joinProject,
    openProject,
    sync,
    publish,
    checkOut,
    checkIn,
    refresh,
    dismissError
  }
}
