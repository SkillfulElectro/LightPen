# Security policy

## Supported versions

LightPen is pre-1.0 until the first tagged release. Security fixes are applied to
the latest release only.

| Version                  | Supported |
| ------------------------ | --------- |
| latest `0.x` / `1.x` tag | ✅        |
| older tags               | ❌        |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- Use GitHub's _Report a vulnerability_ button on the **Security** tab
  (private advisory), or email the maintainer listed in `Cargo.toml` /
  `package.json`.
- Include a description, the affected version, your platform, and reproduction
  steps or a proof of concept.
- We aim to acknowledge within 72 hours and to ship a fix or mitigation within
  30 days for confirmed issues.

## What we consider in scope

- Camera or microphone being activated without visible indication or after
  “pause”/window hide.
- Any network transmission of camera frames, PDFs or annotations.
- Escaping the app data directory when writing annotation sidecars.
- Path traversal or arbitrary file writes through the file dialogs.
- Remote code execution, including through PDFs (pdf.js/DataView), model files or
  the WebView.
- CSP or capability bypasses in the Tauri configuration.
- Dependency vulnerabilities with a realistic exploit path.

## Out of scope

- Social engineering, physical access, or a compromised operating system.
- Denial of service by opening a deliberately enormous PDF (there is a 200 MB cap
  and errors are handled, but memory exhaustion is not treated as a vulnerability).
- Missing code-signing certificates on a self-built binary.
- Vulnerabilities in the user's OS WebView, reported upstream.

## Security design

| Control                                                     | Where                                              |
| ----------------------------------------------------------- | -------------------------------------------------- |
| Strict CSP, `'self'`-only, `wasm-unsafe-eval` for MediaPipe | `src-tauri/tauri.conf.json`                        |
| Least-privilege capabilities (window, dialog, app data dir) | `src-tauri/capabilities/*.json`                    |
| No remote code or models at runtime                         | `scripts/copy-wasm.mjs`, `scripts/fetch-model.mjs` |
| `#![forbid(unsafe_code)]`                                   | `src-tauri/src/lib.rs`                             |
| File size cap + typed PDF errors                            | `src/hooks/usePdfDocument.ts`                      |
| Settings/sidecar validation on load                         | `src/core/settings.ts`, `src/core/annotations.ts`  |
| No telemetry, no analytics                                  | —                                                  |
| `npm audit` + `cargo audit` in CI                           | `.github/workflows/ci.yml`                         |

## Privacy

Camera frames are processed inside the WebView (WASM) and are never written to
disk or sent anywhere. Tracking stops when you pause it or hide the window. The
app collects no analytics and contains no crash reporter.
