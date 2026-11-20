# Performance

## Targets

| Metric                                | Target                             | How it is measured                                                        |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| Hand-tracking loop                    | **≥ 30 FPS** on mid-range hardware | FPS counter in the camera panel (measured in `runFrameLoop`, 1 s windows) |
| Frame budget for the tracking loop    | ≤ 33 ms                            | `detectForVideo` + classifier + filter + canvas draws                     |
| Input latency (hand → ink)            | ≤ 100 ms perceptible               | One Euro `minCutoff 1.2`, `beta 0.02` plus one camera frame               |
| PDF page render (A4 @ 100 %)          | < 250 ms                           | pdf.js render task, cancel-on-supersede                                   |
| Time to interactive (web build, cold) | < 2 s on a laptop                  | Vite build size below                                                     |

## What the implementation does

- **Detection is off the React render path.** The loop writes into refs and
  draws on canvases; React re-renders only when a stroke is committed.
- **`requestVideoFrameCallback` when available**, `requestAnimationFrame`
  otherwise, so detection never runs more often than a frame arrives.
- **Adaptive quality**: if measured FPS drops below 20, detection runs every
  second frame (`adaptiveSkip = 2`) instead of every frame; it returns to full
  rate automatically when the FPS recovers.
- **GPU delegate with CPU fallback.** The GPU delegate keeps inference well
  inside the frame budget on most hardware; the CPU path is used automatically
  where WebGL2 compute is unavailable.
- **Single render task per viewer.** Starting a new page render cancels the
  previous one, so fast page flipping cannot build a queue. Only the visible page
  is rendered; page proxies are cleaned up after rendering.
- **Device pixel ratio capped at 2**, so 4K/high-DPI screens do not quadruple
  fill cost.
- **Canvas layers**: page (pdf.js) → ink → cursor. Only the ink/cursor layers are
  redrawn during drawing; the pdf.js canvas is redrawn only when the page or zoom
  changes.
- **Bundled assets** (WASM + model) mean no network stall on first track.
  `manualChunks` splits pdf.js and MediaPipe out of the app chunk so the shell
  paints before they are needed.
- **Debounced autosave** (800 ms after the last edit) keeps serialisation out of
  the drawing path.

## Measured results

Measured in this development environment: **web build only** (Vite production
build, bundle sizes below). The FPS numbers are **targets, not measurements** —
the sandbox has no camera and no supported GPU path.

```
dist/assets/index.css                 5.6 kB │ gzip:   1.7 kB
dist/assets/index.js                679.3 kB │ gzip: 257.9 kB
dist/assets/pdfjs.js                358.5 kB │ gzip: 105.7 kB
dist/assets/mediapipe.js            125.1 kB │ gzip:  38.0 kB
dist/assets/pdf.worker.min.mjs    1,375.8 kB │ (loaded in a worker)
```

The camera pipeline, gesture detection, filtering and page rendering were
exercised in the browser build only with synthetic landmarks and mouse input.

### Reproducing the measurement on real hardware

1. `npm run tauri dev` on the target machine, open the sample PDF.
2. Start the camera; the panel shows a live FPS value (1 s windows).
3. Fill in the table below and open a PR:

| Device / OS        | Camera | Avg FPS | Notes |
| ------------------ | ------ | ------- | ----- |
| _your device here_ |        |         |       |

## Known performance limits

- The MediaPipe WASM bundle and the pdf.js worker dominate load time; both are
  lazily used but are shipped with the app.
- Very large PDFs (hundreds of pages, heavy vector graphics) render one page at a
  time; page thumbnails are not generated in v1, so jumping to a far page waits
  for that page's render.
- Classifier and filter work are negligible (microseconds) compared to inference.
