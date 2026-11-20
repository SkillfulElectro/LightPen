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
- [ ] **Save annotated PDF** produces a file that opens in Acrobat/Firefox/Preview, with ink in the right place.
- [ ] **Export page PNG** matches the visible page including ink.
- [ ] Tutorial runs end to end (skip, back, calibration box, all five sandbox exercises, cheat sheet).
- [ ] Native menu items (File/Edit/View/Help) trigger the right actions.
- [ ] Keyboard shortcuts work, `?` shows the reference, focus ring is visible on every control.
- [ ] Dark, light and system themes; no contrast failures (spot-check with a contrast checker).
- [ ] Camera: rationale appears before the OS prompt; denial message is actionable; unplugging the camera mid-session is handled.
- [ ] Hand tracking FPS shown; write / hover / erase / swipe / fist-pause all work with a real webcam.
- [ ] Silence the camera (cover it) → "low light" hint appears; move the hand out of frame → "out of frame" hint.
- [ ] Switching to another window stops the stream (camera LED off).
- [ ] Window size and position restore after restart.

## Android

- [ ] `npm run tauri android build` installs and launches.
- [ ] Camera permission dialog (WebView `PermissionRequest`) appears and is honoured.
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
