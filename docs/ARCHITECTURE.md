# Architecture

LightPen is a Tauri 2 desktop/mobile app. The webview runs the whole product
experience; Rust only provides the native shell.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Tauri 2 (Rust)                                  │
│  src-tauri/src/lib.rs   window · native menu · plugins (dialog/fs/opener)     │
│  capabilities/*.json    least-privilege permissions, CSP in tauri.conf.json   │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │ IPC (invoke) + plugin commands
┌───────────────────────────────┴──────────────────────────────────────────────┐
│                            WebView (React 18 + TS)                           │
│                                                                              │
│  src/ui/          Toolbar · PdfViewer · CameraPreview · Dialogs · Tutorial    │
│  src/store/       Zustand: settings, document, annotations, tracking, dialogs │
│                                                                              │
│  src/hooks/       usePdfDocument: pdf.js worker, render queue, page sizes    │
│  src/platform/    tauri.ts (fs/dialog + web fallback) · camera.ts · mediapipe │
│                                                                              │
│  src/core/ (pure, no DOM, 100% unit-tested)                                  │
│    oneEuro.ts      One Euro filter                                            │
│    gesture.ts      GestureClassifier (pinch hysteresis, swipe, fist timer)    │
│    coords.ts       camera → page mapping, mirroring, calibration, clamping    │
│    annotations.ts  AnnotationStore (undo/redo, hit-test, serialization)       │
│    settings.ts     sanitizeSettings (clamp + validate)                        │
│    pdfExport.ts    pdf-lib vector export                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Layers and the rules that keep them clean

| Layer      | May import                       | Must never                                   |
| ---------- | -------------------------------- | -------------------------------------------- |
| `core`     | nothing but other `core` modules | touch the DOM, `window`, React, Tauri        |
| `platform` | `core`, browser/Tauri APIs       | hold React state                             |
| `store`    | `core`, `platform`               | depend on UI components                      |
| `ui`       | everything above                 | contain business rules that belong in `core` |

Because `core` is pure, the interesting logic — filtering, gesture detection,
coordinate mapping, undo/redo, PDF building — is testable in jsdom or plain Node
without a camera or a browser. That is also why coverage is measured on
`src/core/**` only.

## Data flow: air writing

```
camera frame ──► MediaPipe HandLandmarker (WASM, GPU/CPU)
                      │ 21 landmarks (normalized)
                      ▼
              GestureClassifier            ← pinch hysteresis, swipe history, fist timer
                      │ kind, indexTip, palmCenter, swipe, pause
                      ▼
              One Euro filter (x, y)       ← jitter removal with low lag
                      │ smoothed fingertip
                      ▼
              cameraToPage(pageSize, calibration, mirror)
                      │ point in PDF coordinates
                      ▼
              AnnotationStore / activeStroke
                      │                     └──► ink canvas (imperative 2D drawing)
                      ▼
              autosave debounce (800 ms) ──► <name>.lightpen.json
```

### Why the ink canvas is separate from React

The tracking loop runs at 30–60 Hz. Putting the moving point into React state
would re-render the tree 30–60 times per second. Instead:

- `activeStroke`, `handCursor` and the current FPS live in refs / a small Zustand
  slice that only the camera panel subscribes to;
- ink is painted directly on a `<canvas>` layer stacked above the pdf.js page
  canvas (`page-canvas` → `ink-canvas` → `cursor-canvas`);
- React only re-renders when a stroke is _committed_ (`strokesVersion` bump),
  the page changes or the zoom changes.

### Coordinate spaces

| Space               | Origin                            | Used by                          |
| ------------------- | --------------------------------- | -------------------------------- |
| Camera (normalized) | top-left, 0..1, mirrored-friendly | MediaPipe output                 |
| PDF points          | bottom-left, page units           | annotation model, pdf-lib export |
| Canvas CSS pixels   | top-left, page × scale            | rendering, hit-testing on screen |

Strokes are stored **only** in PDF points, so zoom, page rotation and window size
never change the data. Screen positions are derived on the fly
(`pageToCanvas` / `canvasToPage`).

### Rendering pipeline (pdf.js)

`usePdfDocument` creates the document once per file and collects page sizes.
`usePageRenderer` keeps a single in-flight render task: starting a new render
cancels the previous one, so fast page flipping cannot queue up work. Only the
visible page is rendered (lazy) and the page proxy is cleaned up afterwards.

## State shape (Zustand)

| Slice                                              | Contents                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `settings`                                         | every tunable, sanitized on load and persisted to `localStorage`                             |
| `pdf`, `currentPage`, `zoom`, `fitMode`            | document + viewport                                                                          |
| `annotations`, `strokesVersion`, `canUndo/canRedo` | `AnnotationStore` instance (mutable, non-reactive) plus a version counter to trigger redraws |
| `tracking`                                         | `active`, `fps`, `handPresent`, `hint`                                                       |
| dialogs                                            | tutorial, permission rationale, settings, cheat sheet, shortcuts                             |
| hot refs                                           | `activeStroke`, `handCursor`                                                                 |

## Security posture

- **CSP** (`src-tauri/tauri.conf.json`): `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`
  (needed by MediaPipe WASM), no remote hosts in `connect-src`, `object-src 'none'`,
  `frame-ancestors 'none'`.
- **Capabilities**: `default.json` grants only window basics, dialog open/save,
  app-data-dir read/write and opening URLs; `desktop.json` adds menu/window
  commands, `mobile.json` adds the document-picker permissions.
- **No remote code or models**: WASM is copied from `node_modules` at install
  time (`scripts/copy-wasm.mjs`), the model is downloaded once by
  `scripts/fetch-model.mjs` and bundled.
- **Rust**: `#![forbid(unsafe_code)]`, `clippy -D warnings` in CI.
- **Input validation**: documents larger than 200 MB are rejected before loading,
  pdf.js parse errors are mapped to user-facing messages, and sidecar JSON is
  re-validated when restoring annotations.

## Platform notes

| Concern         | Desktop                                            | Android                                                                    | iOS                                    |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| Camera          | `getUserMedia` in WebKitGTK / WebView2 / WKWebView | WebView `PermissionRequest` (see `src-tauri/AndroidManifest.fragment.xml`) | WKWebView + `NSCameraUsageDescription` |
| File picking    | native dialog plugin                               | document picker via dialog plugin                                          | document picker via dialog plugin      |
| Sidecar storage | `$APPDATA` via fs plugin                           | app data dir                                                               | app documents dir                      |
| GPU delegate    | usually available                                  | usually available                                                          | available; CPU fallback automatic      |

See [`MOBILE.md`](MOBILE.md) for the Android WebView camera grant and the mobile
layout, and [`DECISIONS.md`](DECISIONS.md) for the trade-offs behind these choices.
