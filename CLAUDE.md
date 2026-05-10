# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is TrentCAD

A desktop CAD collaboration tool built for FRC Team 2129. Wraps Git LFS with a user-friendly UI so SolidWorks users can share files without learning Git. Uses check-out/check-in (lock-based) collaboration like GrabCAD Workbench. GitHub is the Git host.

## Build Commands

```bash
npm run dev        # Start Electron dev server with hot reload
npm run build      # Production build (outputs to out/)
npm run package    # Build + create installer (outputs to dist/)
```

## Architecture

**Electron app** with three processes:
- **Main process** (`src/main/`) — Git operations, file locking, file watching, IPC handlers
- **Preload** (`src/preload.ts`) — Bridges main ↔ renderer via `contextBridge`
- **Renderer** (`src/renderer/`) — React UI

**Key main process modules:**
- `git.ts` — All Git/LFS operations (create, clone, sync, publish, status, history). Uses `simple-git` npm package.
- `locking.ts` — Check-out/check-in via `git lfs lock`/`unlock`
- `parts.ts` — Part numbering system (`parts.json` manifest, auto-assign, create new part/assembly)
- `rest.ts` — Local REST API server on port 42129 for SolidWorks add-in communication
- `ipc.ts` — All `ipcMain.handle()` registrations + chokidar file watcher
- `config.ts` — App config (recent projects) persisted in Electron userData

**Renderer:**
- `hooks/useGit.ts` — Single hook managing all project state and IPC calls
- Components: `ProjectSetup` (create/join/open wizard), `ProjectBrowser` (full-width file table with Name/Part #/Status/Checked Out By columns), `Toolbar` (sync/publish/check-out/check-in/new part/new assembly), `ActivityFeed` (collapsible bottom panel), `DetailsPanel` (right sidebar for selected file info)

**SolidWorks add-in** (`solidworks-addin/`) — C# add-in (.NET Framework 4.8) that integrates with SolidWorks via COM. Communicates with TrentCAD's REST API to show part numbers, file status, and enable check-out/check-in/sync/publish from within SolidWorks.

**Shared types** in `src/shared/types.ts` — used by both main and renderer.

## Git-to-CAD Terminology

This project deliberately hides Git terminology. In code and UI:
- Repository → Project
- Clone → Join Project
- Pull → Sync
- Commit + Push → Publish
- git lfs lock → Check Out
- git lfs unlock → Check In
- git log → History

## UI Layout

The file browser is the central element (full-width table, not a sidebar tree). Right side has a details panel for the selected file. Activity feed is a collapsible panel at the bottom. Status bar at the very bottom shows counts of modified/locked files.

## Tech Stack

- Electron + React + TypeScript
- electron-vite (Vite-based build)
- simple-git (Git CLI wrapper)
- chokidar (file watching)
- electron-builder (packaging)
- @vitejs/plugin-react v4 (must stay v4 for electron-vite/vite 6 compat)

## Part Numbering (Phase 2)

- `parts.json` at project root, committed to Git so the whole team shares it
- Hierarchical format: `YY-2129-XX-YYY` (year-team-assembly-part), e.g., `26-2129-01-001`
- Folder structure determines hierarchy (folder = assembly group)
- Auto-assigns numbers to SolidWorks files (.sldprt, .sldasm, .slddrw)
- "New Part" / "New Assembly" buttons create files pre-named with part numbers
- Drawings share the number of the part/assembly with the same base filename
- Deleted file entries stay as tombstones so numbers are never reused

## REST API (Phase 3)

- HTTP server on `127.0.0.1:42129` (localhost only), starts when a project is open
- Endpoints: `/api/health`, `/api/status`, `/api/file?path=`, `/api/checkout`, `/api/checkin`, `/api/sync`, `/api/publish`, `/api/locks`, `/api/parts`
- Write operations are serialized via a mutex to prevent concurrent git commands
- Port configurable via `TRENTCAD_API_PORT` environment variable

## SolidWorks Add-in (Phase 3)

- Located in `solidworks-addin/` — separate C# project, not part of the Electron build
- .NET Framework 4.8, COM-registered, targets SolidWorks interop assemblies
- Task pane shows: part number, file status, lock state for the active document
- Buttons: Check Out, Check In, Sync, Publish
- Auto-refreshes on document switch via `ActiveDocChangeNotify`
- Health polling every 5 seconds to detect TrentCAD connection
- Build with Visual Studio on Windows: open `solidworks-addin/TrentCAD.SolidWorksAddin.sln`

## Google Drive Sync (Phase 4)

- One-way mirror: Git → Drive. Automatically syncs all project files to Google Drive after each publish.
- OAuth2 authentication via loopback redirect (opens browser for Google sign-in)
- Credentials: set `TRENTCAD_GOOGLE_CLIENT_ID` / `TRENTCAD_GOOGLE_CLIENT_SECRET` env vars, or create `drive-config.json` in Electron userData with `{ "clientId": "...", "clientSecret": "..." }`
- Create OAuth credentials at https://console.cloud.google.com/apis/credentials (Desktop app type, with `drive.file` scope)
- Tokens stored in `drive-tokens.json` in Electron userData, auto-refreshed
- Creates a `TrentCAD - {projectName}` folder in Drive, mirrors full directory structure
- UI: "Connect Drive" / "Drive Connected" badge in the app header

## Dev Notes

- On Linux, run with `ELECTRON_DISABLE_SANDBOX=1` (already set in the dev script)
- `simple-git`'s `.add()` only accepts file paths — use `.raw(['add', '-A'])` for staging all
- Lock state takes priority over modified state in `getStatus()` so lock indicators always show
- `parts.json` is excluded from the chokidar watcher to prevent infinite loops
