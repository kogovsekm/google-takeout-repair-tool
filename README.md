# Google Takeout Repair Tool (Electron + React + TypeScript)

An independent desktop repair utility for Google Takeout exports, focused on these three features:

- Write metadata from Google Takeout sidecar JSON into media files.
- Create year and month subfolders to avoid naming conflicts.
- Restore MOV extensions for QuickTime-branded files as part of metadata restoration.

The app processes files in place inside your selected folder.

## Included Features

- Folder picker for your Google Photos Takeout extraction.
- UX-friendly warnings for:
  - no folder selected
  - incorrect folder selected (for example, no media files found)
  - missing desktop bridge
- Real-time progress bar and live log panel.
- Split-pane workflow with source/destination selectors on the left and repair options on the right.
- Duplicate-safe renaming during moves and extension restoration.
- JSON sidecar cleanup after processing.

## Tech Stack

- Electron
- React
- TypeScript
- Tailwind CSS
- exiftool-vendored (bundled metadata engine, no global exiftool required)

## Processing Behavior

- Write metadata:
  - Reads sidecar JSON next to media files.
  - Writes capture date/time, title, description, and available GPS metadata to media.
  - Mirrors compatible metadata across EXIF, XMP, IPTC, and QuickTime-friendly tags where possible.
  - Syncs the file modified time from the trusted Takeout sidecar capture timestamp.
  - Restores `.MOV` extensions for QuickTime-branded files.
  - Skips date restoration and file-time sync when no trusted sidecar timestamp is available.
- Create year-month subfolders:
  - Uses sidecar taken time when available.
  - Falls back to file modification time.
  - Moves media into YEAR/MONTH structure.
- Duplicate handling:
  - If target filename already exists, app appends a random integer suffix.
- JSON cleanup:
  - Removes discovered .json sidecars at the end.

## Upfront Notes

- The app modifies and moves files in your selected folder.
- Start with a backup copy of your Takeout data for first runs.
- The app currently focuses only on the three requested features.

## Thorough TODO: Start, Run, Build, Package

### 1. Install prerequisites

Option A (recommended on macOS with Homebrew):

```bash
brew install node
```

Option B:
- Install Node.js LTS from the official installer.

Check versions:

```bash
node -v
npm -v
```

### 2. Install project dependencies

From project root:

```bash
npm install
```

### 3. Run in development mode

This starts both Vite (renderer) and Electron (desktop shell):

```bash
npm run dev
```

### 4. Use the app

1. Click Select Google Takeout Folder.
2. Keep Restore metadata checked (default).
3. Toggle Create year-month subfolders as needed.
4. Click Start Processing.
5. Watch progress and logs.

### 5. Build production artifacts

Compile renderer and Electron process:

```bash
npm run build
```

### 6. Create installable desktop bundles

Generate installers for your current OS target:

```bash
npm run dist
```

Output is created in:

- release

### 7. Cross-platform packaging notes

- macOS: DMG target configured.
- Windows: NSIS installer target configured.
- Linux: AppImage target configured.

For real cross-OS distribution, build on each OS (or use a CI matrix) because native signing/notarization and platform dependencies differ.

### 8. Optional signing and release hardening

Before public release, add platform-specific signing:

- Apple Developer signing + notarization for macOS.
- Code signing certificate for Windows.
- Optional signing for Linux packages.

### 9. Troubleshooting quick checks

- If app opens in browser only, use npm run dev (not vite alone).
- If folder is rejected, verify it contains media files.
- If metadata is sparse, check whether sidecar JSON files exist next to media.
- If a file has no trusted Takeout capture timestamp, the app will preserve its existing media date fields and filesystem time instead of guessing.

## Scripts

- npm run dev: Run renderer + Electron with live reload.
- npm run build: Build renderer and Electron output.
- npm run dist: Build and package app installers.
- npm run lint: Run ESLint.
- npm run benchmark: Run standalone stress benchmark with default 30000 synthetic images.

## Benchmark Usage

Use the benchmark separately from tests to simulate realistic processing (read sidecar metadata, copy files, and write into year/month folders).

- Default run (30000 images):

```bash
npm run benchmark
```

- Custom image count with explicit safe flag:

```bash
npm run benchmark -- --images=30000
```

Rules:

- Only `--images=<number>` is accepted for custom values.
- Minimum allowed value is 10000.
- Invalid values print a warning and stop.
- The benchmark uses temporary folders and removes them at the end, so no benchmark artifacts remain in your project folders.

## Project Layout

- electron/main.ts: Desktop window and IPC wiring.
- electron/preload.ts: Safe renderer bridge API.
- electron/processor.ts: File scanning, metadata writing, MOV restoration, folder grouping, JSON cleanup.
- src/App.tsx: Tailwind UI and UX flow.
- src/types/electronApi.ts: Renderer-side IPC types.

## License

Set your preferred license for this new project as needed.
