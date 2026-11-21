# Manual QA checklist

Automated gates cover logic, types, lint and the web smoke path. The items below
need a human, a real camera and real hardware. Copy this list into the release PR.

## Desktop (Windows / macOS / Linux)

- [ ] `npm run tauri dev` starts and shows the empty viewer.
- [ ] **Open PDF** opens a multi-page document; **drag & drop** works; **double-clicking a PDF in the file manager** opens it in LightPen.
- [ ] Page navigation, go-to-page, fit width, fit page, zoom in/out all behave; a 300-page PDF stays responsive.
- [ ] Opening a corrupt PDF and a password-protected PDF shows the friendly error, not a crash.
- [ ] Manual drawing: pen, colour, width, eraser, undo/redo, clear page. Touch/stylus works.
- [ ] Close and reopen the same PDF → annotations are restored from the sidecar.
- [ ] Two differently-named copies of the same PDF share ink; two **same-named**
      PDFs in different folders do not (ADR-020).
- [ ] **Save annotated PDF** produces a file that opens in Acrobat/Firefox/Preview, with ink in the right place.
- [ ] **Export page PNG** matches the visible page including ink.
- [ ] Tutorial runs end to end (skip, back, calibration box, all five sandbox exercises, cheat sheet).
- [ ] Native menu items (File/Edit/View/Help) trigger the right actions.
- [ ] Keyboard shortcuts work, `?` shows the reference, focus ring is visible on every control.
- [ ] Dark, light and system themes; no contrast failures (spot-check with a contrast checker).
- [ ] Camera: rationale appears before the OS prompt; denial message is actionable; unplugging the camera mid-session is handled.
- [ ] **Linux (incl. CachyOS/Arch)**: starting the camera shows no “permission denied” error and never did show a browser-style prompt (the app itself grants the webview request — ADR-023); with the user removed from the `video` group, the denial message names that fix; AppImage and `.deb` both track on a machine without pre-installed GStreamer capture plugins.
- [ ] **AppImage specifically**: the camera lists and tracks on a machine that has never had GStreamer plugins installed for this app. If it reports "no device" while `gst-inspect-1.0 v4l2src` works, the image was built without `bundleMediaFramework` or without the plugins on the build machine — see [`RELEASING.md`](RELEASING.md).
- [ ] Hand tracking FPS shown; write / hover / erase / swipe / fist-pause all work with a real webcam (air mode).
- [ ] Touch mode, same webcam: an extended pinched index draws, a **curled** index stops drawing (a lifted finger must not ink a connecting line), a quick pinch leaves no dot, two fingers turn pages and zoom, a still pinch pauses.
- [ ] The cheat sheet shows the vocabulary of the mode in use, and switching modes in Settings updates it immediately.
- [ ] Silence the camera (cover it) → "low light" hint appears; move the hand out of frame → "out of frame" hint.
- [ ] Switching to another window stops the stream (camera LED off).
- [ ] **Self-view hidden by default** on desktop (narrow and wide window) and on a phone: only the video is gone — the live FPS badge, Start/Stop, the camera picker, the hints and the privacy note stay. Tracking and the hand cursor are unaffected.
- [ ] The panel toggle and Settings → _Camera preview (self-view)_ stay in sync, and the choice survives a restart.
- [ ] **Android APK installs.** With `ANDROID_KEY_*` secrets: `LightPen_<v>_android_universal.apk` installs and `apksigner verify --print-certs` prints the release DN. Without them: `LightPen_<v>_android_universal_debug.apk` installs and is debug-signed. An _unsigned_ build must never appear in a release.
- [ ] **Icon looks right in the launcher, dock/taskbar, Start menu and the browser tab** (same mark everywhere): no white rim on Android adaptive icons, no cropped stroke at small sizes.
- [ ] Window size and position restore after restart.

## Android

- [ ] `npm run tauri android build` installs and launches.
- [ ] **Apply the Kotlin grant from [`MOBILE.md`](MOBILE.md) after `tauri android init`**, then verify the WebView `PermissionRequest` dialog appears and is honoured.
- [ ] Back gesture/button does not leave a dangling camera session.
- [ ] Layout is usable in portrait and landscape; the side panel stacks under the viewer.
- [ ] Touch drawing works; pinch-zoom on the viewer does not fight page gestures.

## iOS

- [ ] `npm run tauri ios build` installs on a device via TestFlight or Xcode.
- [ ] `NSCameraUsageDescription` string appears in the system prompt.
- [ ] Camera preview works in WKWebView; if the GPU delegate is unavailable the CPU fallback tracks correctly.
- [ ] Safe-area insets respected on notched devices.
- [ ] Files opened from the Files app / "Open in" appear in LightPen.

## Accessibility

- [ ] Full app usable with the keyboard only, including the tutorial and dialogs.
- [ ] Screen reader announces dialog titles, camera status and FPS changes politely.
- [ ] `prefers-reduced-motion` disables transitions.
- [ ] 200 % OS text scaling does not clip controls.

## Performance

- [ ] Record measured FPS and latency per device in `docs/PERFORMANCE.md`.
- [ ] Profiler shows no React re-renders during a held stroke (only canvas draws).
