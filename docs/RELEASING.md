# Releasing

Releases are **manual and tag-driven**. Nothing is published on push.

1. **Bump the version** in one place and mirror it everywhere:

   ```bash
   # package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
   npm version 1.2.0 --no-git-tag-version
   # then edit src-tauri/Cargo.toml and src-tauri/tauri.conf.json by hand
   npm run check:versions      # must print "All versions in sync"
   ```

   Update `CHANGELOG.md` (Keep a Changelog) and commit.

2. **Run the workflow**: _Actions → release → Run workflow_
   - `release_tag` — e.g. `v1.2.0`. Validated against
     `^v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$` and must equal the
     `package.json` version. Both checks fail fast.
   - `prerelease` (default `false`)
   - `draft` (default `true`) — with `false` the release is published only after
     verification succeeds.
   - `build_android` / `build_ios` (default `true`) — turn off when the signing
     secrets are not configured yet.

3. The workflow:

   | Job             | What it does                                                                                                                                                                                                       |
   | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `prepare`       | validates the tag, checks version sync, creates the release if missing, exports `release_id` / `upload_url`                                                                                                        |
   | `build-desktop` | matrix: `windows-latest` (x64 + arm64), `macos-latest` (universal), `ubuntu-22.04`; `tauri-apps/tauri-action` uploads to the existing release, then artifacts are renamed to `LightPen_<version>_<platform>.<ext>` |
   | `build-android` | JDK 17 + Android SDK/NDK + four Rust Android targets, `tauri android build --apk --aab`, `gh release upload --clobber`                                                                                             |
   | `build-ios`     | `macos-latest`, optional keychain import, `tauri ios build`, uploads `.ipa` / `.app.tar.gz`                                                                                                                        |
   | `verify`        | lists release assets, fails if an expected artifact is missing, generates and uploads `SHA256SUMS.txt`, writes a summary table                                                                                     |
   | `publish`       | un-drafts the release when `draft=false` and verification passed                                                                                                                                                   |

   Every job has `timeout-minutes`, actions are pinned by full commit SHA with a
   version comment, caches cover npm / cargo / gradle (via
   `Swatinem/rust-cache` and the Android Gradle caches), and `concurrency`
   is keyed per tag with `cancel-in-progress: false`.

## Artifact names

```
LightPen_<version>_windows-x64.msi
LightPen_<version>_windows-x64.exe
LightPen_<version>_windows-arm64.msi / .exe
LightPen_<version>_macos-universal.dmg
LightPen_<version>_macos-universal.app.tar.gz
LightPen_<version>_linux-x64.deb / .rpm / .AppImage
LightPen_<version>_android_universal.apk / .aab
LightPen_<version>_ios_arm64.ipa
SHA256SUMS.txt
```

## Secrets

All signing is **optional and secret-driven**. If a secret is missing the build
still completes, produces an unsigned artifact, prints a `::warning::` and says so
in the job summary — it never fails silently and never fails because of it.

| Secret                               | Used by    | Purpose                                                              |
| ------------------------------------ | ---------- | -------------------------------------------------------------------- |
| `GITHUB_TOKEN`                       | all jobs   | built in; used to create/upload releases (`contents: write`)         |
| `TAURI_SIGNING_PRIVATE_KEY`          | desktop    | updater signature key (only needed if updater artifacts are enabled) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | desktop    | password for the updater key                                         |
| `APPLE_CERTIFICATE`                  | macOS, iOS | base64 of the `.p12` Developer ID / distribution certificate         |
| `APPLE_CERTIFICATE_PASSWORD`         | macOS, iOS | password of that `.p12`                                              |
| `APPLE_SIGNING_IDENTITY`             | macOS      | e.g. `Developer ID Application: You (TEAMID)`                        |
| `APPLE_ID`                           | macOS      | Apple ID for notarisation                                            |
| `APPLE_PASSWORD`                     | macOS      | app-specific password for notarisation                               |
| `APPLE_TEAM_ID`                      | macOS, iOS | 10-character team identifier                                         |
| `APPLE_API_ISSUER`                   | iOS        | App Store Connect API issuer id                                      |
| `APPLE_API_KEY_ID`                   | iOS        | App Store Connect API key id                                         |
| `APPLE_API_KEY`                      | iOS        | Contents of `AuthKey_XXXX.p8`                                        |
| `KEYCHAIN_PASSWORD`                  | iOS        | password for the temporary keychain                                  |
| `WINDOWS_CERTIFICATE`                | Windows    | base64 `.pfx` code-signing certificate                               |
| `WINDOWS_CERTIFICATE_PASSWORD`       | Windows    | password for that `.pfx`                                             |
| `ANDROID_KEY_BASE64`                 | Android    | base64 of the release keystore                                       |
| `ANDROID_KEY_ALIAS`                  | Android    | key alias                                                            |
| `ANDROID_KEY_PASSWORD`               | Android    | key password                                                         |
| `ANDROID_KEYSTORE_PASSWORD`          | Android    | keystore password                                                    |

> Never commit keystores, `.p12`, `.pfx` or `.p8` files. `.gitignore` already
> excludes `*.keystore`, `*.jks`, `*.p12`, `*.pfx`, `*.p8`, `.env*`.

## Model download

The hand landmarker model is **not** committed (≈ 7.4 MB). Every workflow runs
`npm run fetch:model`, which downloads `hand_landmarker.task` into
`public/models/` before building, so the shipped app has the model bundled and
needs no network at runtime.

If Google's model host is unreachable from your network, download the file
manually and place it at `public/models/hand_landmarker.task`, or point
`LIGHTPEN_MODEL_URL` at a mirror. The app shows a clear message if the model is
absent.

## Verifying locally

```bash
npm run lint && npm run typecheck && npm run test:coverage
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all
npx actionlint .github/workflows/*.yml
```

---

## Unverified

Honest status of things that could **not** be executed in the environment this
project was developed in. Treat these as “written and reviewed” rather than
“proven”:

- **`release.yml` end-to-end run.** The workflow passes `actionlint` and its
  logic was reviewed, but it has never completed a run on GitHub Actions.
  Windows/macOS/Android/iOS builds, `tauri-action` uploads, `gh release` calls
  and artefact renaming are unproven. The first run should be a `draft=true` dry
  run with `build_android=false`, `build_ios=false`.

  The first real run then failed at two points, both now fixed and guarded:

  - **`bundle > targets` was schema-invalid.** It listed `apk`, which is not a
    Tauri 2 bundle type (Android is built by `tauri android build`), so
    `tauri build` refused to start on _every_ platform. `src/core/tauriConfig.test.ts`
    now rejects unknown targets and unknown `tauri-action` inputs; the config
    validates against Tauri's published schema.
  - **The macOS job passed `--target` twice** (once in `matrix.args`, once as the
    action argument), which clap rejects. `matrix.args` is now empty and the test
    above enforces a single `--target`.

  - **The pinned Rust 1.82 could not build the current dependency graph.** A
    clean build re-resolves `tauri = "2"` to 2.12.x (MSRV **1.90**) and picked
    `cssparser-macros 0.7.1`, which needs `edition2024` — cargo 1.82 cannot parse
    that manifest. The pin is now **1.90.0** everywhere and
    `.cargo/config.toml` sets `resolver.incompatible-rust-versions = "fallback"`
    (ADR-021). Committing `Cargo.lock` remains the better long-term fix; see
    `docs/FINAL-REPORT.md` → open issues.

  An earlier Windows run failed at the toolchain step: `toolchain` is a
  **required** input of `dtolnay/rust-toolchain`, and pinning the action to a
  commit SHA drops the `@stable` ref that used to supply it implicitly. Every
  step now passes `toolchain: ${{ env.RUST_TOOLCHAIN }}`, and
  `src/core/ciEnv.test.ts` fails the build if a workflow step omits it, if that
  value drifts from `rust-toolchain.toml`, if a PowerShell step reads an `env:`
  value as a bare `$NAME`, or if `cargo audit` runs before `Cargo.lock` exists.
  These are workflow-level bug classes that `actionlint` does not model.

- **All Rust compilation, `cargo fmt`, `cargo clippy`, `cargo test`.** No Rust
  toolchain was available and `static.rust-lang.org` was unreachable, so
  `src-tauri/` was never compiled. Expect to fix trivial compile issues on the
  first `npm run tauri dev`.
- **`npm run tauri dev` / `npm run tauri build`** — never executed (needs Rust +
  GTK/WebKitGTK). `npm run dev` (web) and `npm run build` do work.
- **Playwright e2e** — the tests are written against the real UI, but the browser
  binary could not be downloaded in the development sandbox, so they were not
  executed here. CI installs Chromium and runs them.
- **Rotated pages**: the viewer now maps coordinates through matrices that
  match pdf.js for 0/90/180/270 (asserted against `getViewport` in jsdom), and
  exported rotation PDFs were rendered and inspected with an independent
  renderer (pypdfium2). Still worth a real-device check with a scanned,
  rotated document.
- **Annotated-PDF export** was verified end to end outside the browser: the
  export output was parsed with pypdf and rendered with pypdfium2, showing the
  vector ink at the intended page position as an open stroked polyline. Opening
  the same file in Acrobat/Firefox/Preview is still a manual QA item.
- **Hand tracking with a real webcam** — no camera in the development sandbox.
  Gesture classification, filtering, coordinate mapping and the ink pipeline are
  unit-tested with synthetic landmarks, but the FPS numbers in
  [`PERFORMANCE.md`](PERFORMANCE.md) are targets, not measurements.
- **Android and iOS builds** — require Android SDK/NDK/JDK 17 and Xcode; neither
  was available. `tauri android init` / `tauri ios init` are run inside the
  workflow. The Android WebView camera grant (Kotlin snippet in
  [`MOBILE.md`](MOBILE.md)) must be applied after `android init` and is itself
  unverified.
- **MediaPipe GPU delegate on Safari/WKWebView** — falls back to the CPU delegate
  automatically; the fallback path is coded but untested on real iOS hardware.
- **Code signing / notarisation** — the secret-driven steps are written but have
  not been exercised with real certificates.
