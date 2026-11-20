/**
 * Configure a release keystore for the generated Android project.
 *
 * `release.yml` used to write `android-keystore.properties` into the repo root,
 * which nothing read. Per the Tauri docs the file must be
 * `src-tauri/gen/android/keystore.properties`, *and* the generated
 * `app/build.gradle.kts` needs a `release` signingConfig — otherwise Gradle
 * silently produces an unsigned release APK.
 *
 * This applies both edits to the generated project. Idempotent.
 *
 * Usage (in CI):
 *   APPLE_... no. Environment:
 *   ANDROID_KEYSTORE_PATH  absolute path to the .jks/.keystore
 *   ANDROID_KEY_ALIAS      key alias
 *   ANDROID_KEY_PASSWORD   key + store password
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '// LIGHTPEN_RELEASE_SIGNING';

/** Properties file contents Gradle reads from the project root. */
export function keystoreProperties({ storeFile, keyAlias, password }) {
  return [`storeFile=${storeFile}`, `keyAlias=${keyAlias}`, `password=${password}`, ''].join('\n');
}

/**
 * Add a `release` signingConfig and select it in the release buildType.
 * Returns `{ gradle, changed }`; unchanged when already patched.
 */
export function patchGradle(gradle) {
  if (gradle.includes(MARKER)) return { gradle, changed: false };

  let out = gradle;

  // `java.util.Properties` is already imported by the template, but
  // FileInputStream is not.
  if (!/^import java\.io\.FileInputStream$/m.test(out)) {
    out = out.replace(/^(import .*)$/m, 'import java.io.FileInputStream\n$1');
  }

  const signingConfig = `
    ${MARKER}
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            if (keystorePropertiesFile.exists()) {
                val keystoreProperties = Properties()
                FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("password")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("password")
            }
        }
    }
`;

  // Insert the signingConfigs block at the top of `android { ... }`.
  const androidStart = out.indexOf('android {');
  if (androidStart === -1) throw new Error('build.gradle.kts has no `android {` block');
  const insertAt = out.indexOf('\n', androidStart) + 1;
  out = `${out.slice(0, insertAt)}${signingConfig}${out.slice(insertAt)}`;

  // Point the release buildType at the new config.
  const releaseBlock = /getByName\("release"\)\s*\{/;
  const match = releaseBlock.exec(out);
  if (!match) throw new Error('build.gradle.kts has no release buildType');
  const afterBrace = match.index + match[0].length;
  out = `${out.slice(0, afterBrace)}\n            ${MARKER}\n            signingConfig = signingConfigs.getByName("release")${out.slice(afterBrace)}`;

  return { gradle: out, changed: true };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const genAndroid = join(root, 'src-tauri', 'gen', 'android');

  const storeFile = process.env.ANDROID_KEYSTORE_PATH;
  const keyAlias = process.env.ANDROID_KEY_ALIAS;
  const password = process.env.ANDROID_KEY_PASSWORD;

  if (!storeFile || !keyAlias || !password) {
    console.error(
      '[android-signing] ANDROID_KEYSTORE_PATH, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD are required.',
    );
    process.exit(1);
  }
  if (!existsSync(storeFile)) {
    console.error(`[android-signing] keystore not found at ${storeFile}`);
    process.exit(1);
  }

  const propsPath = join(genAndroid, 'keystore.properties');
  writeFileSync(propsPath, keystoreProperties({ storeFile, keyAlias, password }));
  console.log(`[android-signing] wrote ${propsPath}`);

  const gradlePath = join(genAndroid, 'app', 'build.gradle.kts');
  if (!existsSync(gradlePath)) {
    console.error(`[android-signing] missing ${gradlePath}`);
    process.exit(1);
  }
  const result = patchGradle(readFileSync(gradlePath, 'utf8'));
  if (result.changed) {
    writeFileSync(gradlePath, result.gradle);
    console.log(`[android-signing] patched ${gradlePath}`);
  } else {
    console.log(`[android-signing] ${gradlePath} already configured`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
