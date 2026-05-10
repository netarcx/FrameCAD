# TrentCAD

A desktop CAD collaboration tool built for FRC Team 2129 (Ultraviolet). TrentCAD wraps Git and Git LFS behind a user-friendly interface so SolidWorks users can share CAD files without learning Git. It uses a check-out/check-in (lock-based) workflow similar to GrabCAD Workbench, with GitHub as the hosting backend.

## Features

### File Collaboration
- **Create / Join / Open** projects with a guided wizard — no Git commands required
- **Sync** pulls the latest changes from the team (equivalent to `git pull --rebase`)
- **Publish** stages all changes, commits with a message, and pushes (equivalent to `git add -A && git commit && git push`)
- **Check Out / Check In** locks and unlocks files via Git LFS, preventing conflicting edits on binary CAD files
- **Real-time file watching** with chokidar — the file browser updates automatically as you save in SolidWorks

### Part Numbering System
- Hierarchical part numbers in the format `YY-2129-XX-YYY` (year-team-assembly-part)
- `parts.json` manifest committed to Git so the whole team shares a single source of truth
- Auto-assigns numbers to SolidWorks files (`.sldprt`, `.sldasm`, `.slddrw`)
- Folder structure determines assembly hierarchy — each folder gets a 2-digit assembly number
- "New Part" and "New Assembly" buttons create files pre-named with their part number, so SolidWorks assembly references are never broken by renaming
- Drawings automatically share the part number of the part/assembly with the same base filename
- Deleted file entries remain as tombstones so part numbers are never reused

### SolidWorks Add-in
- C# COM add-in that integrates directly into SolidWorks as a Task Pane
- Displays the active document's part number, file status, and lock state
- Check Out, Check In, Sync, and Publish buttons available without leaving SolidWorks
- Auto-refreshes when switching between documents
- Communicates with TrentCAD's local REST API (no direct Git operations)

### Google Drive Sync
- One-way mirror from Git to Google Drive — automatically syncs all project files after each Publish
- OAuth2 authentication via browser-based Google sign-in
- Creates a `TrentCAD - {ProjectName}` folder in Drive and mirrors the full directory structure
- Connect/disconnect from the app header with a single click

### REST API
- Local HTTP server on `127.0.0.1:42129` for add-in and external tool communication
- Endpoints for health checks, file status, locks, check-out/check-in, sync, publish, and parts manifest
- Write operations are serialized via a mutex to prevent concurrent Git commands
- CORS-enabled for flexibility; localhost-only for security

## Screenshots

The UI uses a [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) color theme with:
- A **project setup wizard** (Create / Join / Open) as the landing screen
- A **full-width file browser table** as the central element with columns for Name, Part #, Status, and Checked Out By
- A **toolbar** with Sync, Publish, Check Out, Check In, New Part, and New Assembly buttons
- A **details panel** on the right showing selected file info (part number, description, status, lock state)
- A **collapsible activity feed** at the bottom showing commit history
- A **status bar** showing counts of modified, new, checked-out, and locked files

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Git](https://git-scm.com/) with [Git LFS](https://git-lfs.com/) installed
- A GitHub account and repository for team collaboration

## Getting Started

### Installation

```bash
git clone https://github.com/frc2129/TrentCAD.git
cd TrentCAD
npm install
```

### Development

```bash
npm run dev
```

This starts the Electron app with hot reload via electron-vite. On Linux, `ELECTRON_DISABLE_SANDBOX=1` is set automatically in the dev script.

### Production Build

```bash
npm run build       # Build to out/
npm run package     # Build + create installer to dist/
```

The packager produces a Windows NSIS installer (`trentcad-{version}-setup.exe`) and a Linux AppImage.

### Creating a Project

1. Launch TrentCAD and click **Create Project**
2. Enter a project name (e.g., `2026-Robot`), choose a location, and optionally paste a GitHub repository URL
3. TrentCAD initializes a Git repo with LFS tracking for all common CAD file types, creates the initial `parts.json` manifest, and pushes to the remote if provided

### Joining an Existing Project

1. Click **Join Project**
2. Paste the GitHub URL and choose where to save it
3. TrentCAD clones the repository with LFS support

## Architecture

```
src/
  main/              # Electron main process
    index.ts          # App entry point, window creation
    ipc.ts            # IPC handlers + chokidar file watcher
    git.ts            # All Git/LFS operations (simple-git)
    locking.ts        # Check-out/check-in via git lfs lock/unlock
    parts.ts          # Part numbering engine + manifest management
    rest.ts           # Local REST API server
    drive.ts          # Google Drive OAuth + sync
    config.ts         # App config (recent projects) in Electron userData
  preload.ts          # contextBridge — exposes IPC API to renderer
  shared/
    types.ts          # TypeScript types shared across all processes
  renderer/
    src/
      App.tsx         # Root component — routing between setup and main UI
      hooks/
        useGit.ts     # Single hook managing all project state + IPC calls
      components/
        ProjectSetup.tsx    # Create/Join/Open wizard
        ProjectBrowser.tsx  # Full-width file table
        Toolbar.tsx         # Action buttons + New Part/Assembly modals
        ActivityFeed.tsx    # Collapsible commit history
        DetailsPanel.tsx    # Selected file info sidebar
      styles/
        global.css          # All styles (Catppuccin Mocha theme)

solidworks-addin/     # C# SolidWorks add-in (separate project)
  TrentCAD.SolidWorksAddin/
    SwAddin.cs              # COM entry point, Task Pane creation
    TaskPaneControl.cs      # WinForms UI with status display + buttons
    TrentCadApiClient.cs    # HTTP client for TrentCAD REST API
    PublishMessageDialog.cs # Commit message input dialog
    Models/
      FileStatus.cs         # File status DTO
      ApiResponses.cs       # API response DTOs
```

### Process Communication

```
SolidWorks Add-in  ──HTTP──>  REST API (rest.ts)
                                    │
                                    v
Renderer (React)  ──IPC──>  Main Process (ipc.ts)
                                    │
                                    ├──> git.ts (simple-git)
                                    ├──> locking.ts (git lfs lock/unlock)
                                    ├──> parts.ts (manifest)
                                    └──> drive.ts (Google Drive API)
```

## Git-to-CAD Terminology

TrentCAD deliberately hides Git terminology to be approachable for CAD users:

| Git Term | TrentCAD Term |
|----------|---------------|
| Repository | Project |
| Clone | Join Project |
| Pull | Sync |
| Commit + Push | Publish |
| `git lfs lock` | Check Out |
| `git lfs unlock` | Check In |
| `git log` | History |

## Part Numbering

Parts follow a hierarchical numbering scheme:

```
YY-2129-XX-YYY
 │   │    │   └── Part number (3 digits, per-assembly counter)
 │   │    └────── Assembly number (2 digits, from folder hierarchy)
 │   └─────────── Team number
 └─────────────── Year (last 2 digits, set at project creation)
```

Examples (for a project created in 2026):
- `26-2129-001` — a part in the project root (no assembly)
- `26-2129-01` — the first assembly (folder)
- `26-2129-01-001` — the first part inside that assembly
- `26-2129-01-02-001` — a part nested inside a sub-assembly

Drawings (`.slddrw`) automatically share the number of the part/assembly with the same base filename in the same folder.

## REST API Reference

All endpoints are served on `http://127.0.0.1:42129` (configurable via `TRENTCAD_API_PORT` env var). The server starts automatically when a project is opened.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server status + current project info |
| `GET` | `/api/status` | Full file tree with status and part numbers |
| `GET` | `/api/file?path=<relative>` | Single file status |
| `GET` | `/api/locks` | All current LFS locks |
| `GET` | `/api/parts` | Full parts manifest |
| `POST` | `/api/checkout` | Lock a file `{"path": "..."}` |
| `POST` | `/api/checkin` | Unlock a file `{"path": "..."}` |
| `POST` | `/api/sync` | Pull latest changes |
| `POST` | `/api/publish` | Commit + push `{"message": "..."}` |

Write operations (`checkout`, `checkin`, `sync`, `publish`) are serialized — only one runs at a time.

## SolidWorks Add-in Setup

### Option 1: Download from GitHub (easiest)

The add-in is built automatically by GitHub Actions on every push to `solidworks-addin/`.

1. Go to **Actions** > **Build SolidWorks Add-in** > click the latest run > download the **TrentCAD-SolidWorksAddin** artifact
2. Extract the zip to a permanent folder (e.g., `C:\TrentCAD-Addin\`)
3. Open a Command Prompt **as Administrator** and run:
   ```batch
   %windir%\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe /codebase "C:\TrentCAD-Addin\TrentCAD.SolidWorksAddin.dll"
   ```
4. Restart SolidWorks — the TrentCAD pane appears in the Task Pane

### Option 2: Build locally

Requires [.NET SDK](https://dotnet.microsoft.com/download) and [.NET Framework 4.8 Developer Pack](https://dotnet.microsoft.com/download/dotnet-framework/net48). No Visual Studio needed.

```batch
cd solidworks-addin

build.bat               # Build only
build.bat /register     # Build + register (run as Administrator)
build.bat /unregister   # Unregister the add-in (run as Administrator)
```

### Usage

The add-in requires TrentCAD (the Electron app) to be running with a project open — it communicates via the REST API on port 42129. The connection indicator in the pane shows green when connected.

## Google Drive Setup

Drive sync is optional. To enable it:

1. Create OAuth 2.0 credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Application type: **Desktop app**
   - Enable the **Google Drive API**
   - Add the `drive.file` scope
2. Provide credentials via one of:
   - Environment variables: `TRENTCAD_GOOGLE_CLIENT_ID` and `TRENTCAD_GOOGLE_CLIENT_SECRET`
   - A `drive-config.json` file in the Electron userData directory:
     ```json
     {
       "clientId": "your-client-id.apps.googleusercontent.com",
       "clientSecret": "your-client-secret"
     }
     ```
3. In TrentCAD, click **Connect Drive** in the app header — this opens a browser window for Google sign-in
4. After connecting, all project files are automatically mirrored to a `TrentCAD - {ProjectName}` folder in Google Drive after each Publish

Tokens are stored in `drive-tokens.json` in the Electron userData directory and auto-refresh.

## Tech Stack

- **[Electron](https://www.electronjs.org/)** — cross-platform desktop app
- **[React](https://react.dev/)** 19 — renderer UI
- **[TypeScript](https://www.typescriptlang.org/)** — type safety across all processes
- **[electron-vite](https://electron-vite.org/)** — Vite-based build tooling for Electron
- **[simple-git](https://github.com/steveukx/git-js)** — Git CLI wrapper for Node.js
- **[chokidar](https://github.com/paulmillr/chokidar)** — cross-platform file watching
- **[googleapis](https://github.com/googleapis/google-api-nodejs-client)** — Google Drive API client
- **[electron-builder](https://www.electron.build/)** — packaging and installers

## LFS-Tracked File Types

TrentCAD automatically configures Git LFS tracking for these file types when creating a project:

| Category | Extensions |
|----------|------------|
| SolidWorks | `.sldprt`, `.sldasm`, `.slddrw` |
| STEP | `.step`, `.stp` |
| STL | `.stl` |
| IGES | `.iges`, `.igs` |
| 3DXML | `.3dxml` |
| Documents | `.pdf` |
| Images | `.png`, `.jpg`, `.jpeg`, `.bmp` |

## License

This project is developed for FRC Team 2129 (Ultraviolet).
