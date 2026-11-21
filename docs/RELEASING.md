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
   - `build_macos` (default `false`) — macOS is opt-in. It is the only desktop
     target that needs an Apple Developer certificate, and an unsigned `.dmg` is
     blocked by Gatekeeper. Leave it off unless you have the Apple secrets.
   - `build_android` / `build_ios` (default `true`) — turn off when the signing
     secrets are not configured yet.

   Every signing secret is optional: the `Prepare optional signing` step exports
   a variable only when the secret holds a real value. An unset repository secret
   arrives as an **empty string**, and a defined-but-empty `APPLE_CERTIFICATE`
   makes tauri try to import `""` as a p12, which is the
   `SecKeychainItemImport: Unable to decode the provided data` failure.

3. The workflow:

   | Job             | What it does                                                                                                                                                                                                                                                                                             |
   | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `prepare`       | validates the tag, checks version sync, creates the release if missing, exports `release_id` / `upload_url`                                                                                                                                                                                              |
   | `build-desktop` | matrix: `windows-latest` (x64 + arm64), `macos-latest` (universal, only when `build_macos`), `ubuntu-22.04`; `tauri-apps/tauri-action` builds (it is given no `releaseId`, so it does not upload), bundles are renamed to `LightPen_<version>_<platform>.<ext>` and uploaded once by `gh release upload` |
   | `build-android` | JDK 17 + Android SDK/NDK + four Rust Android targets, `tauri android build --apk --aab` (or `--debug --apk` without keystore secrets), `apksigner verify` gate, `gh release upload --clobber`                                                                                                            |
   | `build-ios`     | `macos-latest`, optional keychain import, `tauri ios build`, uploads `.ipa` / `.app.tar.gz`                                                                                                                                                                                                              |
   | `verify`        | lists release assets, fails if an artifact expected **for the selected platforms** is missing, generates and uploads `SHA256SUMS.txt`, writes a summary table                                                                                                                                            |
   | `publish`       | un-drafts the release when `draft=false` and verification passed                                                                                                                                                                                                                                         |

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
LightPen_<version>_android_universal.apk / .aab      (release keystore configured)
LightPen_<version>_android_universal_debug.apk       (no keystore: debug-signed test build)
LightPen_<version>_ios_arm64.ipa
SHA256SUMS.txt
```

These are the only names a release should contain. If you also see
`LightPen_<version>_amd64.AppImage`, `LightPen-<version>-1.x86_64.rpm`,
`LightPen_<version>_x64-setup.exe` or similar, something else is uploading the
bundles under Tauri's default names — `tauri-action` does that whenever it is
given a `releaseId`. The `verify` job prints a `::warning::` listing any asset
that does not match the scheme above, so a duplicate or stale upload is visible
in the run summary instead of quietly shipping twice.

## The AppImage must bundle GStreamer

WebKitGTK captures video through GStreamer, and the AppImage's `AppRun` points
GStreamer at the image's own plugin directory — not the host's. With Tauri's
default `bundle.linux.appimage.bundleMediaFramework: false` that directory is
never created, so the bundled WebKit finds **zero cameras** and `getUserMedia`
fails with "no device was found amongst 0 devices", even on a machine where the
camera works in every other app. Tauri only passes `--plugin gstreamer` to
linuxdeploy when that option is true (`linuxdeploy.rs`), and only that plugin
populates the directory.

Two consequences, both enforced by CI:

- `src-tauri/tauri.conf.json` sets `bundleMediaFramework: true`
  (`src/core/tauriConfig.test.ts` fails if it is ever turned back off).
- The linuxdeploy plugin copies **every** plugin from the _build machine_, so
  the build job must install the capture plugins or the image ships an empty
  directory anyway: `gstreamer1.0-plugins-base gstreamer1.0-plugins-good
gstreamer1.0-pipewire gstreamer1.0-libav`. The release workflow then checks,
  after the build, that `libgstvideo4linux2.so` and `libgstpipewire.so` are both
  on the runner _and_ inside the produced AppImage.

`.deb` and `.rpm` are not affected by the AppImage path problem: they use the
system plugins — which is why `tauri.conf.json` now declares them
(`gstreamer1.0-plugins-good` + `gstreamer1.0-pipewire` for `.deb`,
`gstreamer1-plugins-good` + `pipewire-gstreamer` for `.rpm`) instead of
assuming a full desktop install already ships them. Users still on
an older AppImage can work around a missing media framework with
`GST_PLUGIN_PATH=/usr/lib/gstreamer-1.0:/usr/lib64/gstreamer-1.0 ./LightPen_*.AppImage`.

## Linux camera permission (WebKitGTK) — incl. CachyOS/Arch

Permission is separate from the plugins above, and it is granted by the
app, not by a system prompt: WebKitGTK denies every permission request
nobody answers, so `src-tauri/src/lib.rs` answers it with
`Builder::on_permission_request` (camera only; see ADR-023). That API
needs Tauri ≥ 2.12 — `src-tauri/Cargo.toml` pins `2.12` as the floor for
the `tauri` crate only (`tauri-build` stays on `"2"`: it versions
independently at 2.7.x, and a `^2.12` requirement on it is unsatisfiable
and fails every platform build at dependency resolution), and
`src/core/tauriConfig.test.ts` fails if the
handler, its camera-only scope, the floor, or the dependencies above are
dropped. Builds older than this fix cannot be repaired by any user
setting: the user must install a fixed build.

Tauri has no `pacman` bundle target, so on CachyOS/Arch the supported
install is the **AppImage** (it bundles WebKit's media framework), or a
source build. For a source build / `npm run tauri dev` on Arch:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gst-plugins-good gst-plugin-pipewire
# The camera device node also needs read access; group membership only
# takes effect at the next login, so log out/in (or reboot) afterwards:
sudo usermod -aG video "$USER"
groups   # must list `video` in the *current* session before retesting
```

Quick triage when a Linux user still reports no camera after the fix:
`ls -l /dev/video*`, `groups`, and whether the camera works in another
app (e.g. a browser). “Permission denied” after the fix is a genuine
system refusal (device node, portal, another app holding the camera);
“no device / no capture” is the GStreamer stack above.

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
npm audit --audit-level=high
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

- **`cargo audit` failed before auditing anything.** The step installed
  `cargo-audit@^0.21`, _downgrading_ the 0.23 the runner image already ships, and
  0.21's advisory parser cannot read CVSS 4.0: it aborted with `unsupported CVSS
version: 4.0` while loading `RUSTSEC-2026-0211` from the database. Nothing is
  pinned now — the bundled tool is used, with `cargo install` only as a
  fallback — and `src/core/ciEnv.test.ts` fails if a version pin comes back.

- **clippy had never actually run** (fmt failed first). Its first run found two
  `-D warnings` errors in `lib.rs`: an unused `event` parameter on
  `app.run(...)`, whose body only exists inside
  `#[cfg(any(target_os = "macos", target_os = "ios"))]`, and a redundant
  `.menu(|app| build_menu(app))` closure. Both fixed.

- **The `actionlint` CI job only ever passed locally by accident.** Local checks
  used the WASM build of actionlint, which cannot spawn `shellcheck`; CI's native
  binary runs it on every `run:` block at _all_ severities. Five warnings were
  therefore invisible locally (unquoted `find` loop, a `[[ "${{ matrix.os }}" ==
macos-* ]]` pattern that can never match once actionlint substitutes the
  expression with underscores, an unquoted command substitution, and an
  `ls | grep`). All five are fixed and the check is now reproduced locally with
  shellcheck directly.

- **`release.yml` end-to-end run.** Every CI job is green, `actionlint` included,
  and the first real run did build and upload the unsigned Windows and Linux
  bundles — but it never reached a green `verify`, so macOS/iOS signing and the
  un-drafting `publish` job remain unproven. Start with a `draft=true` run with
  `build_macos=false`, `build_android=false`, `build_ios=false`.

  The runs so far failed at the points below, all now fixed and guarded by
  `src/core/tauriConfig.test.ts` / `src/core/ciEnv.test.ts`:

  - **`bundle > targets` was schema-invalid.** It listed `apk`, which is not a
    Tauri 2 bundle type (Android is built by `tauri android build`), so
    `tauri build` refused to start on _every_ platform. `src/core/tauriConfig.test.ts`
    now rejects unknown targets and unknown `tauri-action` inputs; the config
    validates against Tauri's published schema.
  - **Every artifact was uploaded twice.** `tauri-action` was given a
    `releaseId`, so it uploaded the bundles under their default names
    (`LightPen_0.1.0_amd64.AppImage`, `LightPen_0.1.0_x64-setup.exe`, …) and the
    workflow then uploaded renamed copies too. The action now only builds; the
    renamed set is published once by `gh release upload`.
  - **`verify` demanded a macOS artifact even with `build_macos` off.** Its
    expectation list hardcoded `LightPen_<version>_macos-universal`, so a correct
    Linux/Windows release failed at the last step. Every optional platform is now
    gated on the same input that decides whether it is built.
  - **The macOS leg failed with `SecKeychainItemImport: Unable to decode the
provided data`.** Not a bad certificate: no certificate. The build step
    forwarded `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` (plus the Windows
    pair) unconditionally, and an unset secret becomes an empty _string_, so the
    variables were "set" and tauri tried to base64-decode `""` into a `.p12`.
    Signing variables are now exported only when non-empty.
  - **The macOS job passed `--target` twice** (once in `matrix.args`, once as the
    action argument), which clap rejects. `matrix.args` is now empty and the test
    above enforces a single `--target`.

  - **`lib.rs` used `get_webview_window` without importing `tauri::Manager`**
    (E0599). Fixed, and `deny(warnings)` in release mode was downgraded to
    `warn(warnings)` so a future deprecation inside a dependency macro cannot
    fail a release build.
  - **The iOS job exported half a signing setup.** It always set
    `APPLE_API_KEY_ID`/`APPLE_API_ISSUER`/`APPLE_API_KEY_PATH` while signing was
    off; the CLI treats a _partial_ credential set as an error
    ("APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH must be provided for
    code signing"). All four are now gated on one `HAS_IOS_SIGNING` flag that
    requires the certificate _and_ the API key, and `--no-sign` is passed after
    `--` so npm does not swallow it.
  - **`Install Android NDK` failed with "Broken pipe".** `yes | sdkmanager ... >
/dev/null` plus `pipefail` reports SIGPIPE from `yes` once sdkmanager exits.
    `setup-android` already accepts the licences, so the pipe is gone; the step
    also verifies the NDK directory exists and exports `NDK_HOME` **and**
    `ANDROID_NDK_HOME`.
  - **v0.1.4 shipped an APK nobody could install.** `ANDROID_KEY_BASE64` was
    unset, so the signing step exited 0 with a warning, and the build step still
    produced a _release_ APK — which Gradle leaves unsigned when no signingConfig
    exists. Android rejects unsigned packages ("App not installed as package
    appears to be invalid"). The job now builds `--debug --apk` (always signed by
    Gradle, published as `..._android_universal_debug.apk`) when no keystore is
    configured, and gates the upload on `apksigner verify --print-certs`
    (including a "release build must not be debug-signed" check).
  - **Android signing config was written to a file nothing read**
    (`android-keystore.properties` in the repo root). It now goes to
    `src-tauri/gen/android/keystore.properties` _and_ injects a `release`
    signingConfig into the generated Gradle build — without the Gradle half,
    Gradle emits an unsigned release APK.
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
