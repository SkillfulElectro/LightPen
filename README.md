# LightPen

**Write on PDFs in the air.** Open a PDF, turn on your camera, and draw on the page by pinching your fingers in front of the lens. Everything — PDF rendering, hand tracking and annotation — happens on your device.

[![CI](https://github.com/SkillfulElectro/LightPen/actions/workflows/ci.yml/badge.svg)](https://github.com/SkillfulElectro/LightPen/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<!-- Screenshots placeholder — drop real captures in docs/screenshots/ -->

| Air writing              | Manual tools             | Tutorial                 |
| ------------------------ | ------------------------ | ------------------------ |
| _screenshot placeholder_ | _screenshot placeholder_ | _screenshot placeholder_ |

---

## Features

- **PDF viewer** — open from the file picker, drag & drop (desktop) or "open with"; page navigation, zoom (fit width / fit page / pinch), lazy per-page rendering that copes with large documents, clear errors for corrupt or password-protected files.
- **Hand tracking** — MediaPipe `HandLandmarker` (WASM + GPU delegate) with the model **bundled with the app**: no CDN, no network calls at runtime.
- **Gestures** — pinch to write, point to hover, open palm / two fingers to erase, open-palm swipe to change page, fist-hold to pause. All thresholds tunable.
- **One Euro smoothing** + calibration so the ink follows your fingertip without jitter.
- **Annotations** — vector strokes stored in PDF coordinate space per page, unlimited undo/redo, pen colour & width, eraser, clear page.
- **Autosave** — annotations are written to `<document>.lightpen.json` in the app data directory and restored when you reopen the file.
- **Export** — “Save annotated PDF” (vector ink embedded with pdf-lib) and “Export page PNG”.
- **Works without a camera** — mouse, touch and stylus drawing with the same tools.
- **Tutorial** — first-run walkthrough with a practice sandbox, plus a gesture cheat sheet.
- **Offline, private, accessible** — no telemetry, WCAG 2.2 AA colours, full keyboard control, reduced-motion support, light/dark/system themes, i18n-ready.

## Gesture guide

| Gesture                       | Action                                            |
| ----------------------------- | ------------------------------------------------- |
| 📌 Pinch thumb + index        | Pen down — draw. Ink follows the index fingertip. |
| ☝️ Index extended, no pinch   | Hover — move the cursor without drawing.          |
| 🖐️ Open palm (or two fingers) | Erase strokes under the palm centre.              |
| 👋 Open-palm horizontal swipe | Next / previous page (1.5 s cooldown).            |
| ✊ Fist held ~1 s             | Pause tracking (camera stops).                    |

## Privacy

- The camera is only active while tracking is on, with a visible preview and FPS indicator.
- Video frames are processed in the WebView/WASM sandbox and **never leave the device**. The app declares no network permissions for the frontend and the CSP forbids remote loads.
- The stream is stopped when the app window is hidden or tracking is paused.
- Annotation sidecars stay in the local app data directory.

## Install

Pre-built bundles are published on the [releases page](https://github.com/SkillfulElectro/LightPen/releases):

| Platform | Files                                                                |
| -------- | -------------------------------------------------------------------- |
| Windows  | `LightPen_<version>_windows-x64.msi`, `.exe` (NSIS), `windows-arm64` |
| macOS    | `LightPen_<version>_macos-universal.dmg`, `.app.tar.gz`              |
| Linux    | `LightPen_<version>_linux-x64.deb`, `.rpm`, `.AppImage`              |
| Android  | `LightPen_<version>_android_universal.apk` / `.aab`                  |
| iOS      | `LightPen_<version>_ios_arm64.ipa`                                   |

Verify downloads with `SHA256SUMS.txt` attached to every release:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Development

Requirements: **Node.js 20+** (see `.nvmrc`), **Rust 1.90** (see `rust-toolchain.toml`), and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install            # also copies MediaPipe WASM into public/wasm
npm run fetch:model    # downloads hand_landmarker.task into public/models
npm run make:sample    # regenerates the built-in practice PDF

npm run dev            # browser dev server (http://127.0.0.1:1420) — no Tauri needed
npm run tauri dev      # full desktop app
```

> The hand-tracking model is **not committed** to the repository. `npm run fetch:model` downloads it once; without it the app still runs and manual drawing works, but the camera panel shows a clear “model missing” message.

### Quality gates

```bash
npm run lint          # ESLint, zero warnings
npm run typecheck     # TypeScript strict
npm run format:check  # Prettier
npm run test:coverage # Vitest + v8, >= 80% on src/core
npm run test:e2e      # Playwright against the web build
npm run check:versions
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all
```

### Build

```bash
npm run tauri build            # native bundles for the current OS
npm run tauri android build    # Android (needs Android SDK/NDK + JDK 17)
npm run tauri ios build        # iOS (needs Xcode)
```

Releases are cut manually: run the **release** workflow, give it a tag such as `v1.0.0`, and it builds and uploads every platform plus checksums to that tag. See [`docs/RELEASING.md`](docs/RELEASING.md).

## Project layout

```
src/core/        pure logic: gestures, filters, coordinates, annotations, export (no DOM)
src/platform/    adapters: Tauri fs/dialogs, camera, MediaPipe
src/ui/          React components
src/store/       Zustand state
src/hooks/       pdf.js loading & rendering
src-tauri/       Rust shell: window, menus, capabilities, CSP
e2e/             Playwright smoke tests
docs/            architecture, releasing, decisions, third-party notices
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the diagram and data flow.

| Doc                                                | What is in it                                            |
| -------------------------------------------------- | -------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)     | layers, data flow, coordinate spaces, rendering pipeline |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)           | ADRs behind every non-obvious choice                     |
| [`docs/RELEASING.md`](docs/RELEASING.md)           | release workflow, secret names, what is **unverified**   |
| [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)       | targets, techniques, how to measure on your hardware     |
| [`docs/TUTORIAL.md`](docs/TUTORIAL.md)             | non-technical user guide                                 |
| [`docs/QA-CHECKLIST.md`](docs/QA-CHECKLIST.md)     | manual device/build checklist                            |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | dependency and model licences                            |

## Status

`0.1.0` — every feature in the brief is implemented and the automated gates
(types, lint, format, 190 unit tests, 99 % statements / 95 % branches on
`src/core`, actionlint on both workflows, web production build) pass locally.
Annotated-PDF export was additionally validated outside the browser by parsing
and rendering the output with pypdf and pypdfium2. Things that could not be executed
in the development environment — Rust compilation, `tauri dev`, Playwright e2e,
real-webcam tracking, Android/iOS builds and a live run of `release.yml` — are
listed explicitly under **Unverified** in [`docs/RELEASING.md`](docs/RELEASING.md).

## License

MIT — see [LICENSE](LICENSE). Third-party licences, including the MediaPipe model terms, are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
