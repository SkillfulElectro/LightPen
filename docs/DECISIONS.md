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

The Settings slider shows a 0–100 % _sensitivity_ and is mapped onto the
threshold by `sensitivityToPinchThreshold` / `pinchThresholdToSensitivity`
(pure, unit-tested, round-trip exact). The release threshold is always derived
with `releaseThresholdFor(enter)`, so no combination of slider positions can
produce a threshold pair without hysteresis.

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

**Consequences.** Originally sidecars were keyed by file name, so two PDFs with
the same name in different folders shared annotations. Superseded by ADR-020.

## ADR-009 — Export through pdf-lib vector paths

**Decision.** `page.drawSvgPath()` with the stroke polyline, y-flipped.

**Why.** Vector output stays sharp at any zoom and keeps file size small
compared to rasterising the ink. The result is a normal PDF that opens in any
viewer.

**Two pitfalls that were found by rendering the export in an independent viewer
(pypdfium2) and are now covered by tests:**

1. `drawSvgPath` flips the y axis itself (`scale(1, -1)`), so the path must be
   expressed top-down **and** the draw call must anchor at `y = pageHeight`.
   Without the anchor the ink lands at `pageHeight - py`.
2. Passing `color` (a fill colour) makes pdf-lib emit `B` (fill **and** stroke),
   which closes the polyline and turns handwriting into a polygon. Only
   `borderColor` + `borderWidth` are passed, so the operator is `S` (stroke).

## ADR-016 — Rotation handled through the pdf.js viewport matrix

**Decision.** Every PDF ↔ canvas conversion goes through
`pageViewportMatrix(page, rotation, scale)` + `pdfToViewport` / `viewportToPdf`
in `src/core/coords.ts`. The matrices are unit-tested against the exact values
pdf.js produces for rotations 0/90/180/270.

**Why.** Naively using `scaleW = canvasWidth / pageWidth` silently breaks on
rotated pages: the displayed width is the page _height_ for 90°/270°, so ink is
drawn in the wrong place and, worse, points are clamped to the wrong axis.
Reading the geometry on demand (`getPageGeometry`) also keeps large documents
opening fast — page sizes are no longer parsed up front.

**Consequences.** The overlay canvas, the hand cursor, hit-testing and the
stored strokes all share one matrix, so a rotated page behaves exactly like an
unrotated one.

## ADR-017 — "Open with" is size-capped, dialog is not

**Decision.** Files handed over by the OS (double-click, Finder, CLI argument)
are read in Rust with a 32 MB cap and a `.pdf` extension check; the file dialog
path is not capped (it streams through the fs plugin and pdf.js validates it,
with a 200 MB overall limit).

**Why.** Reading an arbitrary path from a shell argument is the riskiest input the
app has. The cap keeps a malicious or accidental huge file from exhausting memory
before pdf.js can report a clean error, while normal documents open fine through
the dialog.

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

## ADR-019 — pdf.js is injected into the hook, not imported directly by tests

**Decision.** `usePdfDocument` keeps importing the bundler build in production but
exposes `setPdfJsApi` / `resolveApi`. The Vitest setup injects
`pdfjs-dist/legacy/build/pdf.mjs`, which runs in Node without a module worker.

**Why.** The bundler build spawns a "fake worker" that resolves
`pdf.worker.min.mjs` through an import the Node/jsdom loader cannot resolve, which
made every component test that touches a PDF fail. The legacy build parses real
PDFs under jsdom, so tests now exercise the genuine load/render path (page count,
page size, navigation, zoom) against `public/sample.pdf` instead of a mock.

## ADR-020 — Sidecars keyed by document content, not file name

**Decision.** A sidecar is named `<name>.<content-key>.lightpen.json`, where the
content key is `size-fnv1a(bytes)` over the PDF. The web build stores the same
pair in `lightpen:sidecar:<name>@<key>`.

**Why.** ADR-008's file-name key meant `report.pdf` from two folders silently
shared ink — a data-corruption bug, not just an inconvenience. Hashing the bytes
makes the same file resolve to the same sidecar wherever it is opened, and two
different files never collide even with an identical name. Hashing costs one
linear pass over bytes that are already in memory (single-digit milliseconds for
a 10 MB document).

**Consequences.** The readable prefix is kept so the app data folder stays
browsable; the key alone would be opaque. Annotations from builds before this
change are not migrated, because a name-keyed sidecar cannot be attributed to one
of several same-named documents — the safe default is to start that document
clean rather than attach someone else's strokes.

## ADR-021 — Rust toolchain floor tracks Tauri's MSRV; resolver uses `fallback`

**Decision.** `rust-toolchain.toml` pins Rust **1.90.0**, `src-tauri/Cargo.toml`
declares `rust-version = "1.90"`, both workflows read the same value from one
`RUST_TOOLCHAIN` env var, and `.cargo/config.toml` sets
`resolver.incompatible-rust-versions = "fallback"`.

**Why.** The pin was 1.82.0 (August 2024). Two things followed from that:

- `tauri` / `tauri-build` are unversioned (`"2"`, `"2"`), so a clean build takes
  the newest 2.x — currently 2.12.x, whose own MSRV is **1.90**. Even with a
  perfect dependency resolution, 1.82 could never compile it.
- `src-tauri/Cargo.lock` is not committed, so every clean build re-resolves the
  whole graph to current releases. A release run picked `cssparser-macros 0.7.1`,
  whose manifest uses `edition2024`; cargo 1.82 cannot even _parse_ it and fails
  before compiling anything.

1.90 covers both: it parses edition 2024 manifests and satisfies Tauri's MSRV.
`fallback` makes the resolver prefer crate versions whose `rust-version` fits
ours, so a future re-resolution degrades to older crates instead of exploding.

**Consequences.** Committing a `Cargo.lock` would be the strictly better fix for
reproducibility, but it cannot be generated in this environment (no Rust
toolchain, `static.rust-lang.org` and `index.crates.io` are unreachable), and a
hand-written lockfile would be worse than none. `src/core/tauriConfig.test.ts`
fails if the toolchain pin is ever older than the declared MSRV, if the MSRV is
below 1.85, or if the resolver setting is dropped. Tracked as an open issue in
`docs/FINAL-REPORT.md`.

## ADR-022 — Touch mode is a second vocabulary, not a tweak to the first

**Context.** Air mode's grammar is "pose picks the tool": pinch writes, open palm
erases, palm swipe turns pages, fist pauses. It works, but it has to be learned,
and the user who asked for this said plainly: _"I want its gestures and how they
work be like how I would use touch in my smartphone."_ A phone does not have a
trick for erasing — the eraser is a tool you pick, and then you drag.

**Decision.** `settings.gestureMode` selects between two classifiers, both fed
the same landmarks: the existing `GestureClassifier` (`air`, unchanged and still
the default) and `TouchGestureClassifier` (`touch`). Touch mode maps one hand
onto the phone grammar — pinched index = finger down, move = drag, quick
close-and-release = tap, two fingers = scroll and pinch-zoom, still hold = long
press. Air mode's switches disappear from Settings while touch mode is active,
but their stored values are kept.

**Why "lifted" is a pose.** A camera cannot observe contact, only shape. The
honest equivalent of lifting a finger is curling the index back towards the
palm: without it, moving your hand between strokes would draw a connecting line
across the page. This is the one place the metaphor has to be explained rather
than assumed, hence the explicit cheat-sheet line.

**Why erasing stays a tool.** Making "open palm over a stroke" erase in touch
mode would mean a tap could mean _draw_ or _delete_ depending on a pose the user
is not thinking about. Tools are visible and reversible; that matters more than
saving one click.

**Consequences.** Gesture behaviour is now per-mode testable
(`src/core/touchGestures.test.ts` pins the vocabulary itself: a lifted finger
never inks, a tap never leaves a dot, two fingers never draw). The two-finger
pose that air mode uses for erasing is taken by scrolling in touch mode — which
is why the mode is a choice and air mode is still the default: switching the
default would silently change the meaning of a gesture for existing users.
