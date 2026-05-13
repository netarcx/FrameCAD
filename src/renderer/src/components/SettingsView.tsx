import { useState } from 'react'
import TeamSettings from './settings/TeamSettings'
import ProjectSettings from './settings/ProjectSettings'
import DocumentsPanel from './DocumentsPanel'
import MaintenanceTools from './MaintenanceTools'
import HealthScanner from './HealthScanner'
import ProfileSetup from './ProfileSetup'

type SettingsTab = 'team' | 'project' | 'documents' | 'maintenance' | 'profile' | 'about'

interface Props {
  hasProject: boolean
  appVersion: string
  gitName: string
  gitEmail: string
  onProfileUpdate: () => void
}

export default function SettingsView({ hasProject, appVersion, gitName, gitEmail, onProfileUpdate }: Props) {
  const [tab, setTab] = useState<SettingsTab>(hasProject ? 'project' : 'team')

  const tabs: { id: SettingsTab; label: string; projectOnly?: boolean }[] = [
    { id: 'project', label: 'Project', projectOnly: true },
    { id: 'team', label: 'Team' },
    { id: 'documents', label: 'Documents', projectOnly: true },
    { id: 'maintenance', label: 'Maintenance', projectOnly: true },
    { id: 'profile', label: 'Profile' },
    { id: 'about', label: 'About' }
  ]
  const visibleTabs = tabs.filter(t => !t.projectOnly || hasProject)

  return (
    <div className="settings-layout">
      <nav className="settings-sidebar">
        {visibleTabs.map(t => (
          <button
            key={t.id}
            className={`settings-sidebar-item${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {tab === 'team' && <TeamSettings />}

        {tab === 'project' && hasProject && <ProjectSettings />}

        {tab === 'documents' && hasProject && <DocumentsPanel />}

        {tab === 'maintenance' && hasProject && (
          <>
            <HealthScanner />
            <MaintenanceTools />
          </>
        )}

        {tab === 'profile' && (
          <div className="settings-profile-wrap">
            <ProfileSetup
              onComplete={onProfileUpdate}
              initialName={gitName}
              initialEmail={gitEmail}
              embedded
            />
          </div>
        )}

        {tab === 'about' && (
          <div className="admin-section">
            <h3>About TrentCAD</h3>
            <p>Version {appVersion || 'unknown'}</p>
            <p className="admin-hint">
              Press Ctrl+Shift+R to check for updates manually.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
