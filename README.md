# Endorsement

If you find this app valuable, consider giving it a star.

# Google Takeout Repair Tool

Desktop utility for repairing and organizing Google Takeout photo/video exports.

It runs fully local on your machine using Electron.

# Installation

Download the release asset that matches your operating system from the GitHub Releases page.

- macOS Apple Silicon: use `Google Takeout Repair Tool-1.0.0-arm64.dmg`
- macOS Intel: use `Google Takeout Repair Tool-1.0.0.dmg`
- Windows 64-bit: use `Google Takeout Repair Tool Setup 1.0.0.exe`
- Linux 64-bit: use `Google Takeout Repair Tool-1.0.0.AppImage`

If you build the installers locally, open the `release` folder in the project root and choose the same file names listed above.

Checksums for the release artifacts are provided in `release/SHA256SUMS.txt` and can be used to verify downloads.


# Installation caveats

- macOS: because the app is currently distributed without Apple notarization, Gatekeeper may block the first launch. If that happens, open System Settings > Privacy & Security, scroll to the security section near the bottom, and allow the blocked app to run. Then launch it again.
- macOS: Apple Silicon users should prefer the `-arm64.dmg` build. The plain `.dmg` build is for Intel Macs and may require Rosetta on Apple Silicon.
- Windows: SmartScreen may warn that the app is from an unrecognized publisher because the installer is not code-signed with a trusted commercial certificate yet. If you trust the release, choose More info and then Run anyway.
- Linux: the AppImage may not start until it has executable permission. If needed, run `chmod +x "Google Takeout Repair Tool-1.0.0.AppImage"` and launch it again.
- Linux: some distributions need FUSE/AppImage support packages installed before AppImages will open.

## What It Does

This app has two tabs:

- Repair: restore metadata and copy media into a clean output structure.
- Organise: reorganize an already exported folder in place (post-processing).

## Core Features

- Local-first desktop app (no cloud upload).
- Repair workflow with separate source and output folders.
- Organise workflow for flattening folder levels.
- Real-time progress updates and live logs.
- Run reports with warnings and problem files.
- Light and dark themes.
- Tab lock while a job is active, with warning toast when switching tabs.

## Repair Tab Features

- Restore metadata from Google sidecar JSON files.
  - Writes date/time, title, description, and available GPS metadata.
  - Mirrors compatible metadata to multiple tag families.
  - Syncs filesystem modified time from trusted sidecar timestamp when available.
  - Restores `.MOV` extension for QuickTime-branded files.
- Create year-month subfolders (YYYY/MM).
- Create year subfolders only (YYYY).
- Mutual exclusivity between folder modes:
  - Selecting year-only disables year-month.
  - Selecting year-month disables year-only.
- Duplicate-safe file naming using collision resolution.
- Sidecar cleanup summary after processing.

## Organise Tab Features

- Flatten months into years.
- Flatten years into root.
- Remove empty folders.
- In-place moves with collision-safe destination names.
- Separate progress channel and dedicated organise report dialog.

## How To Run

### Prerequisites

- Node.js LTS
- npm

### Install

```bash
npm install
```

### Start Development App

```bash
npm run dev
```

### Build Production App

```bash
npm run build
```

### Run Tests

```bash
npm run test
```

## Packaging

Configured installer targets:

- macOS: DMG
- Windows: NSIS
- Linux: AppImage

Build installers for the current host:

```bash
npm run dist
```

Output folder:

- release

## Scripts

- npm run dev: run renderer and Electron in development mode.
- npm run build: build renderer and Electron bundles.
- npm run dist: package installers via electron-builder.
- npm run test: run unit/integration tests with Vitest.
- npm run lint: run ESLint.
- npm run benchmark: run synthetic processing benchmark.

## Project Structure

- electron/main.ts: app lifecycle and IPC handlers.
- electron/preload.ts: secure renderer bridge.
- electron/processor.ts: repair and post-process logic.
- src/App.tsx: primary renderer UI (tabs, actions, progress, logs).
- src/components/ProcessReportDialog.tsx: repair report dialog.
- src/components/OrganiseReportDialog.tsx: organise report dialog.
- src/types/electronApi.ts: shared renderer-side API types.

## Safety Notes

- Repair writes into a destination folder you choose.
- Organise works in place on the selected folder.
- Keep a backup of original Takeout exports before large runs.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
