/**
 * Wire the camera permission into the generated Android project.
 *
 * `tauri android init` writes `src-tauri/gen/android` (gitignored), so the
 * manifest permissions and the WebView `PermissionRequest` handling cannot be
 * committed there. They live in committed templates instead and this script
 * applies them after `init`, idempotently, so `release.yml` is reproducible.
 *
 * Why it is needed: `getUserMedia()` in an Android WebView is refused unless the
 * embedding app grants the `PermissionRequest`. Declaring `CAMERA` in the
 * manifest is not enough. Without this, camera tracking silently degrades to
 * manual drawing on Android.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const genAndroid = join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main');

function fail(message) {
  console.error(`[android-permissions] ${message}`);
  process.exit(1);
}

if (!existsSync(genAndroid)) {
  fail('src-tauri/gen/android not found — run `npm run tauri android init` first.');
}

// ---------------------------------------------------------------- manifest ----
const manifestPath = join(genAndroid, 'AndroidManifest.xml');
if (!existsSync(manifestPath)) fail(`missing ${manifestPath}`);

let manifest = readFileSync(manifestPath, 'utf8');
const permissions = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  // Required for `onPermissionRequest` to fire at all on some WebView builds.
  '<uses-permission android:name="android.webkit.PermissionRequest" />',
];
const feature = '<uses-feature android:name="android.hardware.camera" android:required="false" />';

let added = 0;
for (const line of [...permissions, feature]) {
  if (manifest.includes(line)) continue;
  manifest = manifest.replace(/<application\b/, `    ${line}\n    <application`);
  added += 1;
}
if (added > 0) {
  writeFileSync(manifestPath, manifest);
  console.log(`[android-permissions] added ${added} manifest entr${added === 1 ? 'y' : 'ies'}`);
} else {
  console.log('[android-permissions] manifest already configured');
}

// ------------------------------------------------------------- MainActivity ---
// The package/class is generated from the bundle identifier, so discover it
// instead of hard-coding a path that breaks if `identifier` ever changes.
const kotlinRoot = join(genAndroid, 'java');
const activity = findMainActivity(kotlinRoot);
if (!activity) fail(`MainActivity.kt not found under ${kotlinRoot}`);

const template = readFileSync(join(root, 'src-tauri', 'android', 'MainActivity.kt.tmpl'), 'utf8');
const source = template.replaceAll('__PACKAGE__', activity.packageName);
if (readFileSync(activity.path, 'utf8') === source) {
  console.log(`[android-permissions] ${activity.path} already up to date`);
} else {
  // Record the pristine generated file once, so a human can diff what we changed.
  writeFileSync(activity.path, source);
  console.log(`[android-permissions] wrote ${activity.path}`);
}

function findMainActivity(dir) {
  if (!existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry !== 'MainActivity.kt') continue;
      const text = readFileSync(full, 'utf8');
      const packageName = /^package\s+([\w.]+)/m.exec(text)?.[1];
      if (!packageName) return null;
      return { path: full, packageName };
    }
  }
  return null;
}
