# Final report

Status of the LightPen build against the brief (§9 Definition of Done), plus an
honest split between what was verified and what could not be executed in the
development environment.

## 1. Verified in this environment

| Gate                    | Command                                                      | Result                                                                            |
| ----------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Version single-sourcing | `npm run check:versions`                                     | ✅ all three files at `0.1.0`                                                     |
| Formatting              | `npx prettier --check .`                                     | ✅ clean                                                                          |
| Lint (zero warnings)    | `npx eslint . --max-warnings 0`                              | ✅ clean                                                                          |
| TypeScript strict       | `npx tsc --noEmit`                                           | ✅ clean                                                                          |
| Unit tests              | `npx vitest run`                                             | ✅ 176 tests in 20 files                                                          |
| Core coverage           | `npx vitest run --coverage`                                  | ✅ 99.2 % statements, 95.5 % branches, 96.8 % functions (threshold 80 %)          |
| Web production build    | `npm run build`                                              | ✅ pdf.js/MediaPipe split into their own chunks                                   |
| Workflow syntax         | `actionlint` (WASM) on `ci.yml` + `release.yml`              | ✅ both OK                                                                        |
| Workflow inputs         | `src/core/ciEnv.test.ts`                                     | ✅ every Rust toolchain step passes a version matching `rust-toolchain.toml`      |
| Annotated PDF export    | exported sample rendered with pypdfium2, parsed with pypdf   | ✅ ink present, correctly placed, stroked (not filled)                            |
| Rotated-page mapping    | matrices compared with pdf.js `getViewport` for 0/90/180/270 | ✅ exact to 5 decimals; exports rendered correctly                                |
| App renders in jsdom    | `src/ui/app.smoke.test.tsx`, `src/ui/a11y.test.tsx`          | ✅ toolbar, viewer, dialogs, tutorial sandbox, keyboard shortcuts, focus handling |

Three real defects were found and fixed by these checks rather than by reading code:

1. **Export placement** — pdf-lib's `drawSvgPath` flips y itself, so paths needed
   `y = pageHeight`; without it ink appeared at `pageHeight − py`. Passing a fill
   colour also made pdf-lib emit `B` (fill + stroke), turning handwriting into a
   filled polygon.
2. **Infinite render loop** — a Zustand selector returned a fresh page-size object
   on every store read (`Maximum update depth exceeded`).
3. **Cross-document ink leak** — sidecars were keyed by file name, so
   `report.pdf` in two folders shared annotations; now keyed by content
   (ADR-020). The fix also exposed a starvation bug: continuous drawing kept
   restarting the 800 ms autosave debounce, so a crash could lose a whole
   session's ink. The writer now has a hard 5 s deadline.

## 2. Not verified (environment limits)

| Item                                           | Why                                                                                       | Where documented                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `npm run tauri dev` / `tauri build`            | no Rust toolchain; `static.rust-lang.org` unreachable                                     | RELEASING.md → Unverified                  |
| `cargo fmt` / `clippy` / `test`                | same                                                                                      | RELEASING.md                               |
| Playwright e2e (`npm run test:e2e`)            | browser binary (`cdn.playwright.dev`) blocked; tests are written and CI installs Chromium | RELEASING.md                               |
| Hand tracking with a real webcam, measured FPS | no camera device in the sandbox                                                           | PERFORMANCE.md (targets, not measurements) |
| Android / iOS builds                           | no SDK/NDK/Xcode                                                                          | RELEASING.md                               |
| A live run of `release.yml`                    | workflow_dispatch needs the GitHub repo + runners; validated with actionlint only         | RELEASING.md                               |
| Code signing / notarisation                    | no certificates                                                                           | RELEASING.md secret table                  |

## 3. Definition of Done checklist

| Item                                                                                   | Status                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev` / `npm run tauri dev` works, opens a PDF, manual drawing                 | `npm run dev` verified (build + jsdom + e2e suite written); `tauri dev` unverified (no Rust) |
| Hand tracking draws with the §3.3 gestures; FPS/latency documented                     | Pipeline implemented and unit-tested; real-camera verification + numbers unverified          |
| Tutorial works end to end incl. practice sandbox                                       | Verified in jsdom (steps, sandbox, gesture-driven completion); real-device run is a QA item  |
| Annotated PDF export opens in a third-party viewer                                     | ✅ verified with independent renderer + parser                                               |
| All quality gates pass locally and in `ci.yml`                                         | ✅ locally; CI workflow defined (not executed here)                                          |
| `release.yml` passes actionlint, takes a tag, builds/uploads all artifacts + checksums | ✅ actionlint; uploads unverified until first real run                                       |
| README, ARCHITECTURE, RELEASING, CONTRIBUTING, SECURITY, CHANGELOG, LICENSE            | ✅ all present (plus DECISIONS, PERFORMANCE, TUTORIAL, QA-CHECKLIST, THIRD_PARTY_NOTICES)    |
| Final report                                                                           | this file                                                                                    |

## 4. Open issues / suggested next steps

1. **First Tauri build**: expect to fix small compile issues in `src-tauri/`
   (`build_menu` signatures, plugin versions) — nothing there was compiled.
2. **Model asset**: `public/models/hand_landmarker.task` is intentionally not
   committed. `npm run fetch:model` downloads it; if that host is blocked in your
   network, place the file manually (see RELEASING.md → Model download).
3. **Release dry run**: run `release.yml` with `draft=true`,
   `build_android=false`, `build_ios=false` first, then add signing secrets.
4. ~~**Sidecar identity**: annotations are keyed by file name only, so two PDFs
   with the same name in different folders share a sidecar.~~ **Fixed** — sidecars
   are now keyed by document content (ADR-020, `src/core/docIdentity.ts`). Note
   that pre-existing name-keyed sidecars are not migrated; see the ADR.
5. **Camera resolution on mobile**: `facingMode: 'user'` with a 1280×720 ideal is
   used for the default device; verify the front camera produces a usable frame
   on low-end Android devices and adjust `adaptiveSkip` if needed.
6. **Updater**: not configured (`createUpdaterArtifacts: false`); the signing
   secrets are already wired for when it is enabled.
7. **Commit `src-tauri/Cargo.lock`.** Without it every clean build re-resolves
   the dependency graph, so a fresh transitive crate can break a release that
   previously built (that is exactly how the `cssparser-macros 0.7.1` /
   `edition2024` failure happened). `.cargo/config.toml` now mitigates it with
   `incompatible-rust-versions = "fallback"` (ADR-021), but a lockfile is the
   real fix. Generate it on a networked machine with
   `cargo generate-lockfile --manifest-path src-tauri/Cargo.toml`, commit it, and
   change CI's dependency job and `release.yml` to build with `--locked`.
