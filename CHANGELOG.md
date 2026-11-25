# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.9] - 2026-11-24

### Fixed

- **PDF writing crashes & OOM prevention.** Serialized `pdf.js` page rendering
  (awaiting cancellation before reusing the canvas to prevent concurrent
  `render()` crashes), capped HiDPI canvas backing-store pixel budgets at high
  zoom, separated committed ink from the live stroke canvas to eliminate
  O(N^2) redraws while drawing, added finite-number firewalls across coordinate
  transforms, One-Euro smoothing, annotations, and PDF export, wrapped pointer
  capture and exports defensively, and added a workspace ErrorBoundary.
- **Low FPS tracking pipeline.** Added a hybrid CPU + GPU compute backend
  (high-performance WebGL2 GPU delegate paired with multi-core CPU
  preprocessing, single-hand fast path, 640x480@60fps capture, and smooth
  adaptive resolution scaling via `InferenceLoadBalancer`), eliminated per-frame
  DOM reflows during writing and idle 60Hz cursor loops, and deduplicated store
  updates.

### Changed

- **Redesigned UI & dedicated Dark Mode.** Replaced raw emoji controls with
  crisp vector SVG icons, modernized the studio toolbar with ink swatches and
  live width preview, added a one-click Dark/Light mode toggle in the toolbar
  (and `D` keyboard shortcut) with synced native `color-scheme`, refreshed
  empty states and modal dialogs, and added a Compute Backend selector in
  Settings.

## [0.1.8] - 2026-11-24

### Fixed

- **Hand-tracking reliability on real webcams.** Gesture detection now
  matches natural human hand geometry: pinching thumb + index no longer
  requires a rigidly straight index finger (a real pinch bends the index at
  the PIP joint), open-palm detection no longer depends on thumb extension,
  and hover tolerates slightly foreshortened pointing. Open-palm page
  swipes are detected by scanning a 450 ms window instead of comparing
  against the oldest history sample, so swiping after holding the hand
  still works. Two-finger zoom accumulates spread against a stable anchor
  instead of demanding a large single-frame jump at 30 FPS, and tap /
  long-press tolerances accommodate mid-air hand tremor.
- **Silent WebGL video-texture failures (Linux/WebKitGTK, Android
  WebViews).** `detectForVideo` on a `<video>` element can silently upload
  black frames without throwing; the detector now probes 2D-canvas and
  ImageData readback automatically, starts on CPU + canvas readback on
  Linux WebKitGTK, and falls back from GPU to CPU after sustained empty
  frames. The bundled model is pre-fetched and validated once (rejecting
  HTML fallbacks), and a rejected initialization promise is never cached,
  so retrying the camera works cleanly.
- **Dominant-hand selection.** MediaPipe handedness is now interpreted with
  selfie-mirror awareness, and selection falls back to the largest visible
  hand instead of dropping tracking when the other hand is raised.
- **Tutorial camera stage.** The tutorial and calibration views now draw
  from CameraPreview's single `<video>` element onto a canvas instead of
  attaching the same stream to a second `<video>`, avoiding decoder
  starvation and keeping the hand skeleton pixel-aligned. Air gestures no
  longer trigger page turns, zoom, or taps on tutorial controls while
  practicing, stale gestures from a previous step are ignored, and the
  fist-hold pause shows a progress bar.

### Added

- `GestureResult.holdProgress` (0..1) for fist-hold pause feedback, and a
  tracker status channel (`starting` / `loading-model` / `running` /
  `error` with FPS) so the tutorial can show camera and model loading
  states and retry cleanly.

### Fixed

- **Camera opened but tracking stayed at 0 FPS and never saw a hand (0.1.5,
  Linux/WebKitGTK).** Two bugs compounded. (1) With the self-view hidden —
  the default — the `<video>` was `display: none`, and WebKitGTK stops
  decoding frames for a video element that is not rendered;
  `requestVideoFrameCallback` never fired and MediaPipe's
  `detectForVideo` threw `no video frame`. The preview is now moved fully
  off-screen at a real size instead, so the pane is invisible while the
  stream keeps decoding. (2) A single exception from the detector killed
  the frame loop silently, which is why the panel showed "0 FPS" and
  nothing else. The loop now survives a bad frame, polls with a watchdog
  when no frames arrive for a second, and keeps MediaPipe timestamps
  strictly increasing (a repeat timestamp throws). When something is
  wrong the panel says which of _no frames_, _detector error_ or _no hand
  found_ it is, with a one-line diagnostic (resolution, `readyState`, FPS,
  user agent) to paste into a bug report.
- **Android release APK would not install** ("App not installed as package
  appears to be invalid"). Without the `ANDROID_KEY_*` secrets the signing
  step was skipped, yet the build step still produced a _release_ APK, and
  Gradle leaves that unsigned — which Android refuses to install. The job
  now builds a release APK/AAB only when a keystore is configured, and
  otherwise a debug-signed APK named
  `LightPen_<version>_android_universal_debug.apk`. Every APK is checked
  with `apksigner verify --print-certs` before upload, so an unsigned
  artifact can no longer reach a release (ADR-024).

- **All platform builds failing at Cargo dependency resolution**
  (`failed to select a version for the requirement tauri-build = "^2.12"`).
  The Tauri subcrates version independently — `tauri` 2.12.x pairs with
  `tauri-build` 2.7.x and no stable `tauri-build` 2.12 exists — so the
  2.12 floor introduced with the camera fix now applies to the `tauri`
  crate only, and `tauri-build` is back to `"2"`. Guarded in
  `src/core/tauriConfig.test.ts` against mirroring the minor again.
- **Camera “permission not granted” on Linux (reported on CachyOS/Arch).**
  WebKitGTK denies every webview permission request the app does not
  answer, and LightPen never answered it, so `getUserMedia` always
  rejected with `NotAllowedError` and no prompt ever appeared. The Tauri
  shell now grants the camera — and only the camera — via
  `Builder::on_permission_request` (Tauri ≥ 2.12 floor pinned in
  `Cargo.toml`; ADR-023). Also fixed for Linux users: the `.deb`/`.rpm`
  bundles now declare the GStreamer capture plugins they need, and the
  camera error messages give distro-correct instructions (Arch/CachyOS:
  `sudo pacman -S gst-plugins-good gst-plugin-pipewire`, plus the
  `video`-group check) instead of Debian-only package names.
  _Linux users on an older build must update/rebuild — no setting in the
  old app can grant this permission._

### Added

- `src/core/cameraDom.ts` and `src/core/trackerHealth.ts`: the
  offscreen-video contract and the tracking diagnosis are pure, unit-tested
  modules, and `src/core/cameraDom.test.ts` fails if `index.css` and the
  TypeScript declarations ever disagree.
- **Logo for every platform.** A single master (`src-tauri/icons/icon.svg`,
  rendered to `icon.png`) generates the macOS `.icns`, Windows `.ico` and
  Store tiles, Android mipmaps + adaptive icon and iOS `AppIcon`s with
  `tauri icon`; the same mark is served as the web favicon
  (`public/favicon.svg`) — the UI had no favicon at all before.
- **The camera self-view is now optional** (`settings.showPreview`, default
  off), on desktop as well as mobile. The panel toggle and the new
  Settings → _Camera preview_ choice hide only the video: hand tracking,
  gestures, hints and the live FPS badge keep working, so nothing tells you
  less about whether the camera is on.
- Cross-platform GitHub Actions release pipeline (`release.yml`): tag validation,
  desktop matrix (Windows x64/arm64, macOS universal, Linux x64), Android and iOS
  jobs, `SHA256SUMS.txt`, job summaries, secret-driven signing.
- `ci.yml`: lint, typecheck, format check, unit tests with coverage, Playwright
  e2e, Rust fmt/clippy/tests, `npm audit`, `cargo audit`, actionlint.
- Documentation: `ARCHITECTURE.md`, `RELEASING.md`, `DECISIONS.md`,
  `PERFORMANCE.md`, `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`, `SECURITY.md`.

## [0.1.0] - 2026-11-20

First working version.

### Added

- **PDF viewer** — open from picker / drag & drop, page navigation, go-to-page,
  zoom (fit width, fit page, manual), lazy single-task page rendering, clear
  errors for corrupt, encrypted and oversized documents.
- **Hand tracking** — MediaPipe Tasks Vision `HandLandmarker` with bundled WASM
  and local model, GPU delegate with automatic CPU fallback, hand skeleton
  picture-in-picture overlay, measured FPS, adaptive detection rate.
- **Gestures** — pinch to write (hand-size normalised with hysteresis), hover
  cursor, open-palm / two-finger erase, open-palm swipe for page turns with
  cooldown, fist-hold pause. All thresholds configurable.
- **Signal processing** — One Euro filter for jitter-free ink, normalised
  calibration rectangle, mirroring, clamping to the writable area.
- **Annotations** — vector strokes per page in PDF coordinate space, pen colour
  and width, eraser, unlimited undo/redo, clear page, autosaved sidecar
  (`<name>.lightpen.json`) restored on reopen.
- **Export** — annotated PDF with vector ink (pdf-lib), PNG export of the current
  page.
- **Manual fallback** — mouse, touch and stylus drawing with the same tools.
- **Tutorial** — first-run walkthrough with camera rationale, placement tips,
  calibration, a practice sandbox with five guided exercises, and a gesture cheat
  sheet from the toolbar.
- **Settings** — pinch sensitivity, smoothing, dominant hand, camera choice,
  mirroring, theme (light/dark/system), language, per-gesture toggles, reset.
- **Accessibility** — ARIA labels on all controls, keyboard shortcuts with a
  reference table, reduced-motion support, WCAG 2.2 AA contrast in both themes.
- **Privacy** — on-device processing only, camera stops on pause/hide, visible
  live indicator, no telemetry, strict CSP, least-privilege Tauri capabilities.

[Unreleased]: https://github.com/SkillfulElectro/LightPen/compare/v0.1.9...HEAD
[0.1.9]: https://github.com/SkillfulElectro/LightPen/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/SkillfulElectro/LightPen/releases/tag/v0.1.8
[0.1.0]: https://github.com/SkillfulElectro/LightPen/releases/tag/v0.1.0
