# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/SkillfulElectro/LightPen/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SkillfulElectro/LightPen/releases/tag/v0.1.0
