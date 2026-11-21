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

## ADR-023 — The Linux webview camera permission is granted in Rust

**Context.** On CachyOS (Arch) the app reported “camera permission was
denied” the moment tracking started, with no prompt ever shown. That was
not the user, the OS, PipeWire, or the `video` group: WebKitGTK denies
every `permission-request` that nobody answers (an unhandled
`WebKitUserMediaPermissionRequest` is denied by default), and
wry only connects that signal when the app installs a permission handler.
LightPen installed none, so `getUserMedia({ video: true })` rejected with
`NotAllowedError` on _every_ Linux build. The same class of bug was
already fixed on Android (`scripts/patch-android-permissions.mjs` grants
the WebView `PermissionRequest`); the desktop WebKitGTK equivalent was
missing. This is also why the old `camera.denied` copy was misleading on
Linux: it implied a browser/OS toggle the user could flip, and none
exists.

**Decision.** `src-tauri/src/lib.rs` registers
`Builder::on_permission_request` (Tauri ≥ 2.12, pinned as the floor in
`Cargo.toml` for the `tauri` crate only — `tauri-build` versions
independently at 2.7.x and has no 2.12; requiring `^2.12` from it broke
every platform build at dependency resolution) with a pure, unit-tested
decision function: `PermissionKind::Camera → Allow`, everything else →
`Default` (the webview's deny-by-default).

**Why granting without a second prompt is right here.** The webview loads
only this app's own bundle under a `'self'`-only CSP, and the frontend
only calls `getUserMedia` after the user presses “Allow camera” /
“Start camera” — that click, preceded by the rationale dialog, _is_ the
consent. The microphone is deliberately not granted (capture is always
`audio: false`). Platform prompts still apply on top: macOS TCC via
`NSCameraUsageDescription`, Android's runtime permission, and any
PipeWire/portal or `/dev/video*` access control on Linux.

**Consequences.** Remaining Linux failures are now genuine environment
problems, and the messages say so with distro-correct fixes: the
`no-capture` message names `pacman -S gst-plugins-good
gst-plugin-pipewire` (Arch/CachyOS) alongside the Debian names, the
`denied` message points at system settings / the `video` group, and the
`.deb`/`.rpm` bundles declare their GStreamer capture dependencies
instead of assuming a full desktop install already has them. The AppImage
keeps bundling the media framework (ADR in `RELEASING.md`). Text guards
in `src/core/tauriConfig.test.ts` fail if the handler, the camera-only
scope, the Tauri floor, or the package dependencies are ever dropped;
the decision itself is unit-tested in `lib.rs`.

## ADR-024 — One logo, generated once, and no self-view by default

**Context.** Three user-facing problems, one theme: the app assumed things about
the person using it. The Android APK from v0.1.4 would not install. The icon set
was generated ad hoc with no master source and the web UI had no icon at all. And
the camera panel always showed the live self-view on desktop: the collapse
control was `display: none` above 800px and its hiding rules lived inside the
mobile media query, so `collapsed = true` did nothing on a laptop. Seeing your
own face is not information you need while writing in the air — it is a mirror.

**Decision.**

1. **Signing is a build-mode choice, not a best-effort step.** With
   `ANDROID_KEY_BASE64` the job builds a release APK/AAB from the configured
   keystore; without it, it builds a _debug_ APK (`--debug --apk`) published as
   `..._android_universal_debug.apk`. It never builds a release variant that no
   keystore can sign — Gradle would emit an unsigned APK, and Android refuses
   to install unsigned packages ("App not installed as package appears to be
   invalid"). `apksigner verify --print-certs` runs before upload for every APK,
   and a release build signed with the `Android Debug` key is an error.
2. **One rasterisable master, every platform.** `src-tauri/icons/icon.svg` is the
   source; `src-tauri/icons/icon.png` (1024²) is its render, and
   `tauri icon` derives the full set — macOS `.icns`, Windows `.ico`, Windows
   Store tiles, Android mipmaps + adaptive icon, iOS `AppIcon`s. The same SVG is
   served as the web favicon (`public/favicon.svg`, linked from `index.html`), so
   browser tab, dock/taskbar and launcher show the same mark.
3. **The self-view is opt-in and never load-bearing.** `settings.showPreview`
   (default **false**) hides the `<video>`; the panel keeps the live FPS badge,
   the start/stop control, the camera picker, errors, hints and the privacy note.
   Tracking, gestures and the hand cursor are unaffected because the stream and
   the tracking loop never depend on whether the video is visible.

**Why default off.** The self-view is a debugging aid. A user holding a phone at
arm's length, or sitting at a laptop, gains nothing from a picture of themselves,
and on a phone it competes for screen with the PDF. Hiding it is the default;
showing it stays one click (panel toggle) or one setting away, and the persisted
setting means the choice survives a restart.

**Consequences.** The "is my camera on?" question is answered by the FPS badge in
the panel header, which is visible even when the preview is hidden, so hiding
your face cannot hide that you are being tracked. The debug APK is deliberately
labelled in its filename and the job summary warns that a later release-signed
build needs an uninstall first (Android refuses key changes). Text guards in
`src/core/tauriConfig.test.ts` fail if unsigned release builds, the
`apksigner` gate, the single-APK requirement, or the debug naming ever come back;
`src/core/settings.test.ts` and `src/ui/app.smoke.test.tsx` cover the preview
default and the toggle.

## ADR-025 — A hidden self-view must not hide the video from the decoder

**Context.** After v0.1.5 a Linux user reported: the camera opened (OS LED on),
but the panel stayed at **0 FPS** and no hand was ever detected. Their log shows
a working but unaccelerated WebKitGTK media stack (`WebKit wasn't able to find
the GL video sink dependencies`, `GstAppSrc has no property named
'automatic-eos'`) and nothing else — no JavaScript error, because nothing
surfaced one.

Two defects met there:

1. v0.1.5 made the self-view opt-in and hid it with
   `.camera-panel.collapsed .camera-video-wrap { display: none }`. WebKit's media
   pipeline does not decode frames for a `<video>` that is not rendered.
   `requestVideoFrameCallback` therefore never fires, and MediaPipe's
   `detectForVideo` throws `no video frame` — the camera is "on" while the
   tracker sees nothing. The same trap exists with `visibility: hidden`, the
   `hidden` attribute, `opacity: 0`, `clip-path: inset(50%)` and 1px boxes.
2. `runFrameLoop` scheduled the next frame only from inside the previous
   callback and never caught exceptions, so the first hiccup ended tracking
   permanently — and the UI reported that as a healthy "0 FPS".
   Separately, MediaPipe rejects a non-increasing timestamp, and the watchdog
   needed for (1) can legitimately produce two detections in the same
   millisecond.

**Decision.**

- The `<video>` element is **never** removed from rendering. When the self-view
  is off, `.camera-video-wrap--offscreen` moves it to `position: fixed; left:
-10000px` at 320×240 (`src/core/cameraDom.ts` + `index.css`, kept in sync by a
  unit test). The pane is invisible; the element is laid out, painted and
  decoded exactly like any other off-screen video.
- `runFrameLoop` catches caller exceptions, and arms a 1 s watchdog while
  waiting for a video frame: a stalled pipeline degrades to polling (so it can
  recover and FPS reflects reality) instead of freezing forever. Generation
  counters stop a late frame from double-ticking next to the watchdog.
- `detectHand` makes the timestamp strictly increasing per landmarker.
- A pure `diagnoseTracker`/`longHandAbsence` (`src/core/trackerHealth.ts`)
  names the failure — _no frames_, _detector error_, _no hand_ — and the panel
  shows the matching message plus a copyable diagnostic line. A failure that
  cannot be described cannot be fixed by a user, and "0 FPS" describes nothing.

**Consequences.** Hiding the self-view is now purely a CSS/visibility decision
and cannot affect capture, on any platform. A broken camera stack is visible in
the first second instead of being a silent zero. The cost is a 320×240 off-screen
element while tracking (negligible next to the detector) and one extra
`setTimeout` per frame in the loop. `src/platform/camera.test.ts` pins the
watchdog, the stale-callback and the throwing-callback behaviour;
`src/ui/app.smoke.test.tsx` asserts the collapsed panel keeps an attached,
non-`display:none` video inside `.camera-video-wrap--offscreen`.
