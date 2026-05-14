# Changelog

All notable changes to FrameCAD are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [SemVer](https://semver.org/) — though for a single-team app the
versions are mostly chronology markers.

## [1.0.0] — 2026-05-13

First stable release. The 0.x line was day-to-day driver use by FRC 2129
for one and a half build seasons; 1.0 is what shipped after the final
polish pass.

### Added
- **Per-part thumbnails** rendered from the OS shell preview (Windows SolidWorks
  thumbnail provider, macOS QuickLook). 24px in the file table, 200px in
  the details panel. Cached by mtime so a SolidWorks save refreshes the
  preview automatically.
- **Where Used** view in the part details panel listing every assembly
  the part belongs to, with one-click navigation.
- **Cascade in-review** — marking an `.sldasm` as in-review automatically
  sweeps every part under that folder subtree into the same state in
  one commit. Skips parts already marked `manufactured`.
- **Folder dirty badge** — folders show a count of modified/untracked
  files anywhere in their subtree, so collapsed folders can't hide
  pending changes.
- **Admin force-unlock** — new Locks tab in the admin panel lists every
  active check-out with an owner column and a Force Release button.
- **Bulk metadata editing** in the Parts Manager — multi-select rows
  and apply release / method / material to all of them in a single
  commit.
- **Non-blocking sync queue** — metadata edits land in a 1.2s debounced
  queue and flush as one commit. Cells stay editable while a sync is
  in flight.
- **OpenDyslexic UI font toggle** (`Ctrl+Shift+D`), persisted across
  launches.
- **Responsive layout** with three tiers — wide (≥1280px) keeps the
  full inline layout, medium (1024–1280px) turns the details panel
  into a slide-in overlay, compact (<1024px) collapses the left sidebar
  to icons-only. Minimum window size now 960×600 so 1366×768 laptops
  fit with the Windows taskbar visible.
- **`framecad://` deep-link protocol** — auto-generated project READMEs
  include a one-click `framecad://join?url=…` link that opens the
  desktop app straight into the Join Project flow.
- **Clickable logo** in the app header returns to the welcome screen
  / exits manufacturing view.
- **Auto-generated README** on project creation, committed to GitHub
  with the join link and a settings walkthrough.
- **Folder-tree auto-collapse on every load** so large projects don't
  open as a wall of files.
- **`Ctrl+Shift+R` update check** correctly reports "no published
  releases yet" instead of the raw electron-updater error.

### Changed
- Settings merged into the Admin panel — one PIN-gated place for all
  configuration. The sidebar Settings entry now opens the merged page.
- Recent-project paths normalized via `path.normalize` (uppercase
  Windows drive letter, trimmed trailing separators) so the same
  project doesn't appear twice with different slash styles.
- UI accent color changed from purple to engineering blueprint blue
  (`#60a5fa` dark / `#2563eb` light) — better contrast and a more
  obvious fit for a CAD workflow tool.
- Folder dirty badge contrast fixed (was yellow with white text — now
  uses the accent + bg-primary scheme, matching `.sidebar-badge`).
- File-tree typography: folder names bold, file extensions render at
  0.85em in secondary color.

### Fixed
- Manufacturing View no longer flashes through the regular project
  view (with sidebar) for the duration of `openProject` before the
  kiosk shell takes over.
- `git lfs lock` "Lock exists" error now resolves to either a silent
  no-op (we already own it) or a clean "Already checked out by <name>"
  message instead of raw LFS output. Also makes `checkIn` idempotent
  for files that aren't locked.
- File-tree auto-collapse no longer expires after 1.5s when no folders
  have appeared yet; it waits for the first non-empty file list.

### Internal
- `bulkUpdateMeta` IPC accepts a per-path patch map so the renderer
  edit queue and bulk-select Apply both flush as a single commit.
- New `useLayoutTier` hook + `data-layout-tier` attribute on `<html>`
  drives all CSS responsive rules.
- New `nativeImage.createThumbnailFromPath`-backed thumbnail cache in
  `src/main/thumbnails.ts` with mtime invalidation.
- Path canonicalization helper in `src/main/config.ts` migrates the
  recent-projects list on read.

## [0.8.5] — earlier
PDM correctness pass — meta changes fan out to every view.

## [0.7.x] — earlier
SolidWorks add-in, Manufacturing View, full-screen Admin, large-file
scanner, push rollback, self-hosted LFS.

## [0.6.x — 0.5.x] — earlier
Foundation: check-out / check-in, part numbering, REST API, Google
Drive sync.

For the full per-version history before 1.0, see
[`git log`](https://github.com/netarcx/FrameCAD/commits/main).
