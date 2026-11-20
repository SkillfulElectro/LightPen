/**
 * Guard `tauri.conf.json` against schema-invalid values.
 *
 * This exists because a release run died with
 *
 *   error on `bundle > targets`: ["msi", ..., "apk"] is not valid under any of
 *   the schemas listed in the 'anyOf' keyword
 *
 * `apk` is not a bundle target in Tauri 2 — Android is built with
 * `tauri android build` — and nothing in the repo would have caught it before a
 * real 90-minute build. Rather than re-implement the whole config schema here
 * (which would drift), this checks the parts we actually got wrong, using the
 * enums from `@tauri-apps/cli`'s own schema when it is available.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
  bundle: { targets: string[]; active: boolean };
  build: { frontendDist: string };
  app: { security: { capabilities: string[] } };
};

/** Bundle types Tauri 2 can produce on *some* platform. */
const BUNDLE_TYPES = [
  'deb',
  'rpm',
  'appimage',
  'pacman',
  'msi',
  'nsis',
  'app',
  'dmg',
  'updater',
] as const;

describe('tauri.conf.json', () => {
  it('lists only real bundle targets', () => {
    expect(Array.isArray(conf.bundle.targets)).toBe(true);
    for (const target of conf.bundle.targets) {
      expect(BUNDLE_TYPES, `"${target}" is not a Tauri 2 bundle target`).toContain(
        target.toLowerCase(),
      );
    }
  });

  it('does not ask for a mobile bundle from `tauri build`', () => {
    // Mobile artifacts come from `tauri android build` / `tauri ios build`;
    // listing apk/aab/ipa here fails config validation on every desktop OS.
    for (const mobile of ['apk', 'aab', 'ipa']) {
      expect(conf.bundle.targets.map((t) => t.toLowerCase())).not.toContain(mobile);
    }
  });

  it('covers every desktop platform it claims to ship', () => {
    const targets = conf.bundle.targets.map((t) => t.toLowerCase());
    expect(targets).toContain('deb');
    expect(targets).toContain('appimage');
    expect(targets).toContain('nsis');
    expect(targets).toContain('dmg');
  });

  it('keeps the frontend dist the bundler expects', () => {
    expect(conf.build.frontendDist).toBe('../dist');
    expect(conf.bundle.active).toBe(true);
  });

  it('references capability files that exist', () => {
    for (const name of conf.app.security.capabilities) {
      expect(() => read(`src-tauri/capabilities/${name}.json`)).not.toThrow();
    }
  });
});

describe('tauri-action inputs', () => {
  // Passing an input the action does not declare only produces a warning, which
  // is how `includeDebug: false` (a tauri-action v0 input) survived until the
  // first real run.
  const VALID = new Set([
    'releaseId',
    'tagName',
    'releaseName',
    'releaseBody',
    'releaseDraft',
    'prerelease',
    'releaseCommitish',
    'projectPath',
    'uploadUpdaterJson',
    'updaterJsonPreferNsis',
    'tauriScript',
    'args',
    'retryAttempts',
    'owner',
    'repo',
    'githubBaseUrl',
    'releaseAssetNamePattern',
    'uploadPlainBinary',
    'uploadWorkflowArtifacts',
    'workflowArtifactNamePattern',
    'uploadUpdaterSignatures',
    'generateReleaseNotes',
    'mobile',
  ]);

  it('only passes declared inputs', () => {
    const text = read('.github/workflows/release.yml');
    const start = text.indexOf('uses: tauri-apps/tauri-action@');
    expect(start).toBeGreaterThan(-1);
    const after = text.slice(start);
    const withBlock = after.slice(after.indexOf('with:') + 5, after.indexOf('- name:'));
    const keys = [...withBlock.matchAll(/^ {10}([A-Za-z][\w]*):/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(VALID, `unknown tauri-action input "${key}"`).toContain(key);
  });

  it('passes exactly one --target per desktop job', () => {
    const matrix = read('.github/workflows/release.yml').split('build-desktop')[1] ?? '';
    expect(matrix).toContain('--target ${{ matrix.target }}');
    // A second --target (e.g. inside matrix.args) makes clap reject the build.
    const argsRows = [...matrix.matchAll(/args: '([^']*)'/g)].map((m) => m[1]!);
    for (const args of argsRows) expect(args).not.toContain('--target');
  });
});

describe('Rust toolchain policy', () => {
  const readToolchain = () =>
    /channel\s*=\s*"([^"]+)"/.exec(read('rust-toolchain.toml'))?.[1] ?? '';
  const readMsrv = () =>
    /rust-version\s*=\s*"([^"]+)"/.exec(read('src-tauri/Cargo.toml'))?.[1] ?? '';
  const major = (v: string) => Number(v.split('.')[0]);
  const minor = (v: string) => Number(v.split('.')[1] ?? 0);

  it('pins a toolchain at least as new as the crate MSRV', () => {
    const toolchain = readToolchain();
    const msrv = readMsrv();
    expect(toolchain).toMatch(/^\d+\.\d+\.\d+$/);
    expect(msrv).toMatch(/^\d+\.\d+$/);
    // A release run failed because dependencies needed edition 2024 while the
    // pinned toolchain was 1.82: the pin must never lag the declared MSRV.
    expect(
      major(toolchain) * 1000 + minor(toolchain),
      `rust-toolchain.toml (${toolchain}) is older than Cargo.toml rust-version (${msrv})`,
    ).toBeGreaterThanOrEqual(major(msrv) * 1000 + minor(msrv));
  });

  it('declares an MSRV that can parse edition 2024 dependencies', () => {
    // Not cosmetic: with an older MSRV, a fresh resolution can pick a crate
    // whose manifest uses edition2024 and cargo refuses before compiling.
    const msrv = readMsrv();
    expect(major(msrv) * 1000 + minor(msrv)).toBeGreaterThanOrEqual(1085);
  });

  it('enables rust-version-aware dependency resolution', () => {
    const config = read('.cargo/config.toml');
    expect(config).toContain('[resolver]');
    expect(config).toContain('incompatible-rust-versions = "fallback"');
  });
});

describe('release workflow secret handling', () => {
  const release = () => read('.github/workflows/release.yml');

  it('never pipes into sdkmanager under pipefail', () => {
    // `yes | sdkmanager ... > /dev/null` reports SIGPIPE from `yes` and fails the
    // step; setup-android already accepts the licences.
    // Comments explain the old bug, so only compare executable lines.
    const code = release()
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/yes\s*\|\s*sdkmanager/);
    expect(code).toContain('sdkmanager --install');
  });

  it('exports both NDK_HOME and ANDROID_NDK_HOME', () => {
    const text = release();
    expect(text).toContain('NDK_HOME=$NDK_DIR');
    expect(text).toContain('ANDROID_NDK_HOME=$NDK_DIR');
  });

  it('gates every iOS signing variable on the same flag', () => {
    // A partial credential set is a hard CLI error, so they are all-or-nothing.
    const text = release();
    const ios = text.slice(text.indexOf('build-ios'), text.indexOf('build-ios') + 12000);
    for (const name of [
      'APPLE_TEAM_ID',
      'APPLE_API_ISSUER',
      'APPLE_API_KEY_ID',
      'APPLE_API_KEY_PATH',
    ]) {
      expect(ios, `${name} must be gated on HAS_IOS_SIGNING`).toMatch(
        new RegExp(`${name}: \\$\\{\\{ env\\.HAS_IOS_SIGNING == 'true'`),
      );
    }
  });

  it('requires the certificate and the API key before enabling signing', () => {
    const text = release();
    const flag = /HAS_IOS_SIGNING: \$\{\{(.*?)\}\}\s*$/m.exec(text)?.[1] ?? '';
    expect(flag).toContain('APPLE_CERTIFICATE');
    expect(flag).toContain('APPLE_API_KEY');
  });

  it('passes --no-sign after `--` so npm does not eat it', () => {
    expect(release()).toContain('npm run tauri -- ios build --no-sign');
  });

  it('configures Android signing only after android init', () => {
    const text = release();
    const init = text.indexOf('tauri android init');
    const signing = text.indexOf('npm run android:signing');
    expect(init).toBeGreaterThan(-1);
    expect(signing).toBeGreaterThan(init);
  });
});
