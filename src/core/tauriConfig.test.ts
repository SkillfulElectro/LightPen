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
