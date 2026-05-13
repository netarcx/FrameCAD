# Build your own TrentCAD

TrentCAD was written for FRC Team 2129, but the team-specific bits live
in a handful of build-time environment variables. Forking and shipping
your own team's distribution takes maybe an hour.

This doc covers what you'll need to change. The result is an installer
that auto-fills your team's defaults on every machine it lands on, plus
a place for auto-bug-reports to flow that isn't upstream's tracker.

## Quickstart

1. Fork [netarcx/TrentCAD](https://github.com/netarcx/TrentCAD) on
   GitHub.
2. In your fork's settings, add the four Actions secrets below.
3. Edit two lines of `electron-builder.yml` to point auto-update at
   your fork.
4. Push to `main` — CI builds a Windows / Linux installer with your
   team's defaults baked in.

That's it. The rest of this doc explains each step.

## Required: build-time secrets

Set these as **repository secrets** under
`Settings → Secrets and variables → Actions` in your fork. CI passes
them to the Vite build as `process.env.*`, and they're inlined as
string literals in the compiled bundle.

| Secret | Example | What it does |
|---|---|---|
| `TRENTCAD_DEFAULT_GITHUB_ORG` | `frc1234` | Default GitHub org the welcome screen "Browse Projects" wizard searches. |
| `TRENTCAD_DEFAULT_PROJECT_PREFIX` | `1234` or `26-1234` | Default part-number prefix. If you supply just the team segment, TrentCAD prepends the current 2-digit year on every new project. |
| `TRENTCAD_DEFAULT_TEAM_NAME` | `FRC Team 1234 — Acme` | Shown in the welcome subtitle and on every auto-generated project README. |
| `TRENTCAD_DEFAULT_WELCOME_MESSAGE` | `Cut metal, not corners.` | Optional banner copy under the welcome subtitle. |
| `TRENTCAD_DEFAULT_ISSUE_REPO` | `frc1234/TrentCAD` | Where the in-app **Report to GitHub** button files auto-reports. Falls back to `netarcx/TrentCAD` if unset, which floods upstream — set this. |

The Admin panel lets every install override any of these per-machine,
but the build-time defaults are what new installs see before anyone
touches the Admin page.

## Required: redirect auto-update

The Windows / Linux builds auto-update from GitHub Releases. Out of
the box, that's `netarcx/TrentCAD/releases` — your fork needs its own
release feed.

Edit `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: YOUR-GITHUB-USERNAME
  repo: YOUR-FORK-REPO-NAME
  releaseType: release
```

After this change every push to `main` in your fork builds an installer
and uploads it as a release under your fork. Existing installs of
**your** fork will start auto-updating from there; they won't get
upstream's releases.

## Optional: app identity

If you want students to see your team's name in the title bar, taskbar,
and Add/Remove Programs list, change `electron-builder.yml`:

```yaml
appId: com.yourteam.trentcad   # was com.trentcad.app
productName: YourTeamCAD       # was TrentCAD
```

Note that changing `appId` and `productName` means your build installs
**alongside** an existing TrentCAD install instead of upgrading it.
That's usually what you want for a fork.

## Optional: branding

For a fuller rebrand:

| File | What it controls |
|---|---|
| `build/icon.png` | Installer + window icon (1024×1024 PNG) |
| `src/renderer/src/assets/logo.png` | In-app logo (top-left + welcome screen) |
| `solidworks-addin/TrentCAD.SolidWorksAddin/logo.png` | SW add-in pane icon |
| `solidworks-addin/TrentCAD.SolidWorksAddin/taskpane-icon.bmp` | SW task-pane tab icon (16×18 BMP) |
| `README.md` / `CHANGELOG.md` | Project-level docs |

A handful of strings still reference "TrentCAD" in code comments and
the OnboardingTour — those are cosmetic and you can grep-replace at
leisure. Nothing functional reads them.

## Things upstream owns

- The `trentcad://` URL scheme. If you fork and want your own scheme
  (`yourteamcad://join?url=…`) you'll need to update
  `electron-builder.yml` `protocols:` plus `src/main/index.ts`
  `setAsDefaultProtocolClient` / `parseTrentCADUrl`.
- The on-disk REST API port `42129`. Change `TRENTCAD_API_PORT` env or
  the `DEFAULT_PORT` constant in `src/main/rest.ts` if you want to
  avoid colliding with someone running an upstream TrentCAD on the
  same machine.

## Test locally before pushing

```bash
TRENTCAD_DEFAULT_GITHUB_ORG=frc1234 \
TRENTCAD_DEFAULT_PROJECT_PREFIX=1234 \
TRENTCAD_DEFAULT_TEAM_NAME="FRC Team 1234" \
TRENTCAD_DEFAULT_ISSUE_REPO=frc1234/TrentCAD \
  npm run dev
```

The welcome screen subtitle and the wizard placeholders should reflect
your values immediately.

## Questions?

If your team is rolling out a fork and hits a wall, open an issue on
upstream and we'll take a look. Especially interested in feedback that
exposes more team-specific assumptions still hiding in the code.
