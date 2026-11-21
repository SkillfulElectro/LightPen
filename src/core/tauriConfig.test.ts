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
  bundle: {
    targets: string[];
    active: boolean;
    linux: {
      appimage: { bundleMediaFramework: boolean };
      deb: { depends: string[] };
      rpm: { depends: string[] };
    };
  };
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

  it('ships the GStreamer capture plugins in the AppImage', () => {
    // Without this, Tauri's AppRun points GStreamer at an AppImage directory
    // that is never populated, WebKitGTK sees zero cameras and getUserMedia
    // fails with "Video capture was requested but no device was found amongst
    // 0 devices" — on the AppImage only, so a .deb/.rpm test would not catch it.
    expect(conf.bundle.linux.appimage.bundleMediaFramework).toBe(true);
  });

  it('references capability files that exist', () => {
    for (const name of conf.app.security.capabilities) {
      expect(() => read(`src-tauri/capabilities/${name}.json`)).not.toThrow();
    }
  });

  it('declares the GStreamer capture plugins as .deb/.rpm dependencies', () => {
    // .deb/.rpm use the *system* plugins (unlike the AppImage above), and
    // WebKitGTK finds no camera without v4l2/pipewire sources: on a minimal
    // install (e.g. CachyOS/Arch-style package selection, or a slim Debian)
    // nothing else pulls them in. Package names differ per family.
    expect(conf.bundle.linux.deb.depends).toContain('gstreamer1.0-plugins-good');
    expect(conf.bundle.linux.deb.depends).toContain('gstreamer1.0-pipewire');
    expect(conf.bundle.linux.rpm.depends).toContain('gstreamer1-plugins-good');
    expect(conf.bundle.linux.rpm.depends).toContain('pipewire-gstreamer');
  });
});

describe('Linux webview camera permission (src-tauri)', () => {
  // Regression guard for “camera permission is not granted” on CachyOS:
  // WebKitGTK denies every permission-request nobody answers, so without
  // the handler below getUserMedia rejected NotAllowedError on all Linux
  // builds — with no prompt the user could have granted. These are text
  // guards because this environment has no Rust toolchain; the behaviour
  // itself is unit-tested in lib.rs (`permission_response` tests).
  const libRs = () => read('src-tauri/src/lib.rs');

  it('answers the webview permission request', () => {
    expect(libRs()).toContain('.on_permission_request(');
    expect(libRs()).toContain('permission_response(kind)');
  });

  it('allows only the camera, never the microphone', () => {
    const code = libRs();
    expect(code).toContain('PermissionKind::Camera => PermissionResponse::Allow');
    // LightPen always captures with `audio: false`; granting the mic
    // would be privilege the app never uses.
    expect(code).not.toMatch(/PermissionKind::Microphone\s*=>\s*PermissionResponse::Allow/);
    expect(code).toContain('_ => PermissionResponse::Default');
  });

  it('pins Tauri >= 2.12, the first release with on_permission_request', () => {
    const cargo = read('src-tauri/Cargo.toml');
    const requirement = (crate: string) =>
      new RegExp(`^${crate}\\s*=\\s*\\{\\s*version\\s*=\\s*"([^"]+)"`, 'm').exec(cargo)?.[1];

    // Only the `tauri` crate gets the 2.12 floor: that is the crate whose
    // API grew `on_permission_request`.
    const tauri = requirement('tauri');
    expect(tauri, 'tauri version').toBeTruthy();
    const [tauriMajor = 0, tauriMinor = 0] = tauri!.split('.').map(Number);
    expect(
      tauriMajor * 1000 + tauriMinor,
      `tauri = "${tauri}" predates on_permission_request (needs >= 2.12)`,
    ).toBeGreaterThanOrEqual(2012);

    // `tauri-build` must NOT get the same floor — that is what broke every
    // platform build. The Tauri subcrates version independently (tauri
    // 2.12.x pairs with tauri-build 2.7.x; the `tauri` crate itself depends
    // on `tauri-build ^2.7.6`), no stable tauri-build 2.12 exists, and
    // `tauri-build = "^2.12"` fails dependency resolution on all platforms
    // before anything compiles. Only the shared major is required.
    const tauriBuild = requirement('tauri-build');
    expect(tauriBuild, 'tauri-build version').toBeTruthy();
    const [buildMajor = 0, buildMinor = 0] = tauriBuild!.split('.').map(Number);
    expect(buildMajor, `tauri-build = "${tauriBuild}" must stay on major 2`).toBe(2);
    expect(
      buildMajor * 1000 + buildMinor,
      `tauri-build = "${tauriBuild}" mirrors the tauri minor, which does not exist on crates.io`,
    ).toBeLessThan(2012);
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

describe('android release artifacts are always installable', () => {
  const release = () => read('.github/workflows/release.yml');
  /** The build-android job only; other jobs must not satisfy these assertions. */
  const androidJob = () => {
    const text = release();
    return text.slice(
      text.indexOf('  build-android:'),
      text.indexOf(
        '  # ------------------------------------------------------------------ ios ---',
      ),
    );
  };

  // v0.1.4 shipped an unsigned release APK: with no ANDROID_KEY_BASE64 the
  // signing step exited 0, `tauri android build` emitted an unsigned release
  // build, and Android refused to install it ("package appears to be invalid").
  it('never builds a release APK when no keystore is configured', () => {
    const job = androidJob();
    expect(job).toContain('ANDROID_BUILD_KIND=debug');
    // The release build must be behind the signed branch, debug otherwise.
    expect(job).toMatch(
      /if \[\[ "\$ANDROID_BUILD_KIND" == "release" \]\]; then\s+npm run tauri android build -- --apk --aab\s+else\s+npm run tauri android build -- --debug --apk/,
    );
  });

  it('labels the debug build as such instead of shipping it as a release', () => {
    const job = androidJob();
    expect(job).toContain('android_universal_debug.apk');
    // An unsigned-build claim must not survive anywhere in the job.
    expect(job).not.toMatch(/UNSIGNED \(debug-key\)/);
  });

  it('verifies the signature of every uploaded APK', () => {
    const job = androidJob();
    const verify = job.indexOf('apksigner');
    const upload = job.indexOf('gh release upload');
    expect(verify).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(verify);
    expect(job).toContain('verify --print-certs');
    expect(job).toContain('certificate DN');
  });

  it('fails when a release build is signed with the debug key', () => {
    expect(androidJob()).toContain('Android Debug');
  });

  it('requires exactly one APK instead of copying whatever it finds', () => {
    // The old step `find ... -exec cp` silently took any/several *.apk.
    expect(androidJob()).toContain('Expected exactly one APK');
    expect(androidJob()).not.toMatch(/-name "\*\.apk" -exec cp/);
  });

  it('accepts the debug-signed name in the verify allow-list', () => {
    expect(release()).toContain('android_universal(_debug)?');
  });
});

describe('release matrix and optional signing', () => {
  const release = () => read('.github/workflows/release.yml');

  /** Extract single-quoted literals in source order (no regex escaping games). */
  function singleQuoted(text: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== "'") continue;
      let j = i + 1;
      while (j < text.length && text[j] !== "'") j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i + 1, j));
      i = j;
    }
    return out;
  }

  /** Rows the desktop matrix expression yields for a given build_macos value. */
  function desktopRows(buildMacos: boolean): { name: string; os: string }[] {
    const text = release();
    const start = text.indexOf('include: >-');
    // Anchor on the FIRST `env:` AFTER the matrix (indexOf from 0 would hit the
    // workflow-level env block, which sits above this job).
    const end = text.indexOf('\n    env:', start);
    const block = text.slice(start, end);
    const rows = singleQuoted(block).filter((s) => s.startsWith('{"name"'));
    expect(rows).toHaveLength(3);
    // `format('[{0}{1}{2}]', a, cond && macos || '', b)`
    const joined = `[${rows[0]}${buildMacos ? rows[1] : ''}${rows[2]}]`;
    return JSON.parse(joined) as { name: string; os: string }[];
  }

  it('has a build_macos checkbox, off by default', () => {
    const text = release();
    expect(text).toMatch(
      /build_macos:\s*\n\s+description:.*\n\s+required: false\s*\n\s+default: false/,
    );
  });

  it('skips the macOS row when build_macos is unchecked', () => {
    const names = desktopRows(false).map((r) => r.name);
    expect(names).toEqual(['windows-x64', 'windows-arm64', 'linux-x64']);
    expect(desktopRows(false).some((r) => r.os.startsWith('macos'))).toBe(false);
  });

  it('includes macOS when build_macos is checked', () => {
    const rows = desktopRows(true);
    expect(rows.map((r) => r.name)).toContain('macos-universal');
    expect(rows.every((r) => r.name && r.os)).toBe(true);
  });

  it('never references a signing secret in the build step env', () => {
    // An unset secret is injected as an EMPTY STRING, so referencing it still
    // defines the variable; tauri then tries to import "" as a p12 certificate.
    const text = release();
    const build = text.slice(
      text.indexOf('name: Build the app'),
      text.indexOf('name: Normalise artifact names'),
    );
    expect(build).not.toMatch(/secrets\.(APPLE|WINDOWS)_/);
    expect(build).toContain('GITHUB_TOKEN');
  });

  it('exports optional secrets only when they are non-empty', () => {
    const text = release();
    const step = text.slice(
      text.indexOf('name: Prepare optional signing'),
      text.indexOf('name: Build the app'),
    );
    expect(step).toContain('export_optional');
    expect(step).toContain('if [[ -n "${2:-}" ]]');
    expect(step).toContain('APPLE_CERTIFICATE "$SECRET_APPLE_CERT"');
  });

  it('fails early when a certificate has no password', () => {
    const text = release();
    expect(text).toContain('APPLE_CERTIFICATE is set but APPLE_CERTIFICATE_PASSWORD is not');
    expect(text).toContain('WINDOWS_CERTIFICATE is set but WINDOWS_CERTIFICATE_PASSWORD is not');
  });
});

describe('release verification expectations', () => {
  const release = () => read('.github/workflows/release.yml');

  /** Platform prefixes the verify step will demand, given the inputs. */
  function expected(inputs: { macos: boolean; android: boolean; ios: boolean }): string[] {
    const text = release();
    const start = text.indexOf('expected=(');
    const block = text.slice(start, text.indexOf('missing=()', start));
    const list: string[] = [];
    for (const line of block.split('\n')) {
      const mandatory = /^\s*"(LightPen_\$\{VERSION\}_[a-z0-9_-]+)"\s*$/.exec(line);
      if (mandatory) {
        list.push(mandatory[1]!);
        continue;
      }
      const conditional =
        /\[\[ "\$BUILD_(\w+)" == "true" \]\] && expected\+=\("(LightPen_\$\{VERSION\}_[a-z0-9_-]+)"\)/.exec(
          line,
        );
      if (conditional) {
        const [, input, target] = conditional;
        const on =
          (input === 'MACOS' && inputs.macos) ||
          (input === 'ANDROID' && inputs.android) ||
          (input === 'IOS' && inputs.ios);
        if (on) list.push(target!);
      }
    }
    return list;
  }

  it('does not demand macOS when build_macos is off', () => {
    // This is the bug that failed a good release: the list hardcoded macOS.
    const names = expected({ macos: false, android: false, ios: false });
    expect(names.some((n) => n.includes('macos'))).toBe(false);
    expect(names).toEqual([
      'LightPen_${VERSION}_windows-x64',
      'LightPen_${VERSION}_windows-arm64',
      'LightPen_${VERSION}_linux-x64',
    ]);
  });

  it('demands macOS only when build_macos is on', () => {
    expect(expected({ macos: true, android: false, ios: false })).toContain(
      'LightPen_${VERSION}_macos-universal',
    );
  });

  it('gates android and iOS the same way', () => {
    const all = expected({ macos: true, android: true, ios: true });
    expect(all).toContain('LightPen_${VERSION}_android_universal');
    expect(all).toContain('LightPen_${VERSION}_ios_arm64');
    expect(all).toHaveLength(6);
  });

  it('passes every input the expectation list reads', () => {
    const text = release();
    const step = text.slice(
      text.indexOf('name: Collect release assets'),
      text.indexOf('expected=('),
    );
    for (const name of ['BUILD_MACOS', 'BUILD_ANDROID', 'BUILD_IOS']) {
      expect(step, `${name} must be in the verify step env`).toContain(`${name}:`);
    }
  });
});

describe('release artifact publishing', () => {
  it('does not let tauri-action upload alongside our renamed artifacts', () => {
    // With a releaseId the action uploads the default-named bundles too, so every
    // artifact appeared twice in the release.
    const text = read('.github/workflows/release.yml');
    const action = text.slice(
      text.indexOf('uses: tauri-apps/tauri-action@'),
      text.indexOf('name: Normalise artifact names'),
    );
    expect(action).not.toContain('releaseId:');
    expect(text).toContain('gh release upload');
  });

  it('does not give the desktop job a release id it could upload with', () => {
    const text = read('.github/workflows/release.yml');
    const job = text.slice(text.indexOf('  build-desktop:'), text.indexOf('  build-android:'));
    expect(job).not.toMatch(/^\s*RELEASE_ID:/m);
  });

  it('flags assets outside the published naming scheme', () => {
    // Stale drafts and default-named bundles are reported, so a duplicate upload
    // is visible instead of silently shipping twice.
    const text = read('.github/workflows/release.yml');
    expect(text).toContain('Unexpected release assets');
    expect(text).toMatch(/LightPen_\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+_/);
  });
});
