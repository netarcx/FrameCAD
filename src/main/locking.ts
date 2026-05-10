import type { LockInfo } from '@shared/types'
import { getGit } from './git'

export async function checkOut(filePath: string): Promise<void> {
  const g = getGit()
  await g.raw(['lfs', 'lock', filePath])
}

export async function checkIn(filePath: string): Promise<void> {
  const g = getGit()
  await g.raw(['lfs', 'unlock', filePath])
}

export async function getLocks(): Promise<LockInfo[]> {
  const g = getGit()
  try {
    const output = await g.raw(['lfs', 'locks', '--json'])
    const parsed = JSON.parse(output)

    if (!Array.isArray(parsed)) return []

    return parsed.map((lock: { path: string; owner: { name: string }; id: string }) => ({
      path: lock.path,
      owner: lock.owner?.name || 'unknown',
      id: lock.id
    }))
  } catch {
    try {
      const output = await g.raw(['lfs', 'locks'])
      const lines = output.trim().split('\n').filter(Boolean)
      return lines.map(line => {
        const parts = line.split('\t').map(s => s.trim())
        return {
          path: parts[0] || '',
          owner: parts[1] || 'unknown',
          id: parts[2]?.replace('ID:', '').trim() || ''
        }
      })
    } catch {
      return []
    }
  }
}

export async function verifyLocks(): Promise<{ ours: LockInfo[]; theirs: LockInfo[] }> {
  const g = getGit()
  try {
    const output = await g.raw(['lfs', 'locks', '--verify', '--json'])
    const parsed = JSON.parse(output)
    return {
      ours: (parsed.ours || []).map(mapLock),
      theirs: (parsed.theirs || []).map(mapLock)
    }
  } catch {
    return { ours: [], theirs: [] }
  }
}

function mapLock(lock: { path: string; owner: { name: string }; id: string }): LockInfo {
  return {
    path: lock.path,
    owner: lock.owner?.name || 'unknown',
    id: lock.id
  }
}
