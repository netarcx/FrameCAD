import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { ProjectConfig } from '@shared/types'

const CONFIG_FILE = 'trentcad-app.json'

interface AppConfig {
  recentProjects: ProjectConfig[]
  /**
   * Cached GitHub org + project prefix from the last project's admin.json.
   * Mirrored to userData so the welcome screen (where no project is open)
   * can still show the Browse Projects button.
   */
  cachedBrowseConfig?: {
    gitHubOrg?: string
    projectPrefix?: string
  }
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

async function readConfig(): Promise<AppConfig> {
  try {
    const data = await fs.readFile(getConfigPath(), 'utf-8')
    return JSON.parse(data)
  } catch {
    return { recentProjects: [] }
  }
}

async function writeConfig(config: AppConfig): Promise<void> {
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2))
}

export async function addRecentProject(project: ProjectConfig): Promise<void> {
  const config = await readConfig()
  const existing = config.recentProjects.find(p => p.path === project.path)
  const merged: ProjectConfig = { ...project, pinned: existing?.pinned ?? project.pinned }
  config.recentProjects = config.recentProjects.filter(p => p.path !== project.path)
  config.recentProjects.unshift(merged)
  // Cap unpinned entries at 10. Pinned entries are kept regardless so
  // the team's go-to projects don't age out.
  const pinned = config.recentProjects.filter(p => p.pinned)
  const unpinned = config.recentProjects.filter(p => !p.pinned).slice(0, 10)
  config.recentProjects = [...pinned, ...unpinned]
  await writeConfig(config)
}

export async function setProjectPinned(targetPath: string, pinned: boolean): Promise<void> {
  const config = await readConfig()
  const entry = config.recentProjects.find(p => p.path === targetPath)
  if (!entry) return
  entry.pinned = pinned || undefined
  await writeConfig(config)
}

export async function removeRecentProject(targetPath: string): Promise<void> {
  const config = await readConfig()
  config.recentProjects = config.recentProjects.filter(p => p.path !== targetPath)
  await writeConfig(config)
}

export async function getRecentProjects(): Promise<ProjectConfig[]> {
  const config = await readConfig()
  return config.recentProjects
}

export async function setCachedBrowseConfig(
  org?: string,
  prefix?: string
): Promise<void> {
  const config = await readConfig()
  config.cachedBrowseConfig = {
    gitHubOrg: org?.trim() || undefined,
    projectPrefix: prefix?.trim() || undefined
  }
  await writeConfig(config)
}

export async function getCachedBrowseConfig(): Promise<{ gitHubOrg?: string; projectPrefix?: string }> {
  const config = await readConfig()
  return config.cachedBrowseConfig || {}
}
