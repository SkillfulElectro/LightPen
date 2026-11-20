# Architectural decisions

Short records of the decisions that shape LightPen, with the reasoning and the
alternatives that were considered. The stack itself is fixed by the project
brief (§2); these notes explain the design inside it.

---

## ADR-001 — Tauri 2 for every platform

**Decision.** One Tauri 2 shell for Windows, macOS, Linux, Android and iOS.

**Why.** One codebase, small binaries, native file dialogs, and the webview is
enough for PDF rendering and WASM hand tracking.

**Consequences.** Platform differences live in the webview: WKWebView on Apple,
WebView2 on Windows, WebKitGTK on Linux, Android System WebView on Android.
Camera and WASM behaviour must be verified per platform (see
[`RELEASING.md`](RELEASING.md) → Unverified).

## ADR-002 — Three layers: `core`, `platform`, `ui`

**Decision.** All rules live in `src/core` as pure TypeScript with no DOM access.

**Why.** Gesture classification, smoothing, coordinate mapping, undo/redo and PDF
building are the parts that break silently; keeping them pure makes them fully
testable with synthetic landmarks and PDFs, and lets CI enforce 80% coverage
without a camera.

**Consequences.** Anything that needs `window`, `navigator` or Tauri goes into
`src/platform` behind an interface.

## ADR-003 — Strokes in PDF coordinates

**Decision.** A stroke is a list of points in PDF points with a bottom-left
origin, plus page index, colour, width and timestamp.

**Why.** Zooming, fitting, resizing the window or rotating a device must never
alter the data. Export is then a straight copy into pdf-lib.

**Consequences.** Two conversions exist (`pageToCanvas` / `canvasToPage`); the
export flips the y axis because pdf-lib's `drawSvgPath` uses a top-left origin.

## ADR-004 — Gestures from 21 landmarks, hand-size normalised

**Decision.** Pinch is `distance(thumbTip, indexTip) / distance(wrist, middleMcp)`
with hysteresis (enter < 0.32, exit > 0.45).

**Why.** Absolute pixel distances depend on camera resolution and distance to the
lens; normalising by an in-hand length makes one threshold work everywhere.
Hysteresis stops the pen flickering on/off at the boundary — the most visible
failure mode of naive pinch detection.

**Consequences.** A visible “fist” state is also derived (all four fingers
curled) and used for the pause gesture.

## ADR-005 — One Euro filter for smoothing

**Decision.** Filter x and y with a One Euro filter (Casiez, Roussel & Vogel 2012)
instead of a fixed low-pass or a moving average.

**Why.** Fixed smoothing trades jitter for lag; One Euro raises the cutoff with
speed, so slow writing is smooth and fast strokes stay responsive. `minCutoff`
and `beta` are exposed in Settings.

**Consequences.** The filter is stateful per tracking session; it is reset when
tracking restarts.

## ADR-006 — Calibration as a normalised rectangle

**Decision.** The user drags a rectangle in the camera frame that maps to the
whole page; mirroring is applied first, then the rectangle, then clamping.

**Why.** Not everyone writes in the full camera view — you usually hold your hand
in a comfortable region. A rectangle is the simplest calibration a non-technical
user can do correctly, and it also fixes left/right mirror-image confusion.

## ADR-007 — Ink on its own canvas, never in React state

**Decision.** The in-progress stroke and the hand cursor live in refs / small
non-reactive state and are painted imperatively on `ink-canvas` / `cursor-canvas`.

**Why.** Re-rendering React at 30–60 Hz drops frames. React only re-renders when a
stroke is committed, the page changes or zoom changes.

## ADR-008 — Autosave to a sidecar file, debounced

**Decision.** Annotations are serialised to `<name>.lightpen.json` in the app data
directory 800 ms after the last change; the browser build falls back to
`localStorage`.

**Why.** Non-destructive by default: the original PDF file is never modified. A
crash or a closed window still restores the work.

**Consequences.** Sidecars are keyed by file name; two PDFs with the same name in
different folders share annotations. Acceptable for v1, and documented.

## ADR-009 — Export through pdf-lib vector paths

**Decision.** `page.drawSvgPath()` with the stroke polyline, y-flipped.

**Why.** Vector output stays sharp at any zoom and keeps file size small
compared to rasterising the ink. The result is a normal PDF that opens in any
viewer.

**Limitation.** `borderWidth`/`color` strokes are drawn as filled-and-stroked
paths, so a single-point stroke gets a 0.01 pt nudge to remain visible.

## ADR-010 — MediaPipe WASM and model bundled locally

**Decision.** WASM is copied from `node_modules` by `scripts/copy-wasm.mjs`
(postinstall); the model is downloaded once by `scripts/fetch-model.mjs` into
`public/models/` and excluded from git.

**Why.** The brief forbids runtime CDN loading. Bundling also keeps the app
working offline and guarantees the CSP can stay `'self'`-only.

**Consequences.** The repository does not contain the model; a build without
`npm run fetch:model` shows a clear “model missing” message and manual drawing
still works. CI always fetches it before packaging.

## ADR-011 — Host-side platform adapters with web fallbacks

**Decision.** `src/platform/tauri.ts` checks `__TAURI_INTERNALS__` and degrades to
`<input type="file">`, `<a download>` and `localStorage`.

**Why.** `npm run dev` gives a fast feedback loop and lets Playwright e2e tests run
the real UI without Rust.

## ADR-012 — Page swipe needs a palm, not a pinch

**Decision.** Swipe is detected only with an open palm, horizontal travel > 0.22
of the frame within 350 ms, and a 1.5 s cooldown.

**Why.** Rejecting pinched hands avoids changing page in the middle of a stroke;
the cooldown makes a single deliberate swipe produce exactly one page turn.

## ADR-013 — Strict CSP with `wasm-unsafe-eval` only

**Decision.** `script-src 'self' 'wasm-unsafe-eval'`, no remote origins anywhere,
`object-src 'none'`, `frame-ancestors 'none'`.

**Why.** MediaPipe needs to compile WASM; nothing else needs dynamic code. Keeping
`connect-src` at `'self'` (plus the Tauri IPC origin) means an accidental network
call in the frontend would be blocked by the browser itself.

**Consequences.** If a future feature needs a remote API it must be added to the
CSP _and_ justified in this file.

## ADR-014 — Camera lifecycle tied to visibility and pause

**Decision.** The stream is stopped when tracking is paused, when the pause
gesture fires and when the document becomes hidden.

**Why.** Privacy and battery: a camera light that stays on after “pause” would
break the promise made in the UI.

## ADR-015 — Vitest coverage measured on `src/core` only

**Decision.** The 80% threshold applies to `src/core/**`; UI and platform code is
covered by Playwright and manual checks.

**Why.** UI coverage numbers are easy to inflate and give false confidence; the
logic that can break silently is all in `core`.
