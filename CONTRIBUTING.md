# Contributing to LightPen

Thanks for helping! LightPen is a small app with a deliberately strict quality
bar: please read the two short sections below before opening a PR.

## Setup

```bash
node --version            # 20.x (see .nvmrc)
npm install               # runs postinstall: copies MediaPipe WASM into public/wasm
npm run fetch:model       # downloads the hand-tracking model (not in git)
npm run make:sample       # regenerates public/sample.pdf
npm run dev               # http://127.0.0.1:1420
npm run tauri dev         # full desktop app (needs Rust 1.82+, see rust-toolchain.toml)
```

The model is intentionally not committed. Without it the app still runs; the
camera panel explains what is missing.

## Ground rules

1. **Respect the layers.** Business rules go in `src/core` and must stay pure
   (no DOM, no React, no Tauri). Adapters go in `src/platform`, components in
   `src/ui`.
2. **Tests.** Every behaviour added to `core` needs a unit test; coverage must
   stay ≥ 80 %. User-visible flows get a Playwright test.
3. **Zero warnings.** `npm run lint` runs ESLint with `--max-warnings 0`.
   TypeScript is strict; avoid `any`, prefer `unknown` + narrowing.
4. **No new network calls at runtime.** No CDN scripts, fonts, models or
   telemetry. If something genuinely needs a remote origin, propose the CSP change
   in `docs/DECISIONS.md` first.
5. **Accessibility is not optional.** Interactive elements need accessible names,
   focus states, keyboard operability and sufficient contrast.
6. **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`,
   `perf:`, `build:`, `ci:`. Keep the subject in the imperative mood and under
   ~72 characters.
7. **No secrets.** Never commit keystores, certificates or `.env` files.

## Before you push

```bash
npm run check:versions
npm run format        # or npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --all
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all
```

All of these must pass; `ci.yml` runs the same set.

## Changing the version

Versions are single-sourced. Update `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json` together and run `npm run check:versions` — CI fails
on a mismatch.

## Reporting bugs

Use the issue template. For hand-tracking problems, include:

- operating system and device,
- camera resolution if you know it,
- measured FPS from the camera panel,
- whether the on-screen hint (too far / too close / low light) appeared.

Please do not attach PDFs you cannot share publicly; a minimal synthetic PDF is
enough to reproduce almost any rendering bug.

## Security

See [`SECURITY.md`](SECURITY.md). Camera and file-handling issues are considered
sensitive.
