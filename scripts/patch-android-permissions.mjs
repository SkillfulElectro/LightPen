/**
 * Wire the Android camera permission into the generated Android project.
 *
 * `tauri android init` writes `src-tauri/gen/android` (gitignored), so the
 * manifest entries and the WebView `PermissionRequest` handling cannot live
 * there. This applies them to the generated project, idempotently.
 *
 * Why it is needed: `getUserMedia()` in an Android WebView is refused unless the
 * embedding activity grants the `PermissionRequest`; declaring `CAMERA` in the
 * manifest is not enough.
 *
 * The generated `MainActivity.kt` is *edited*, not replaced: Tauri's template
 * gives it an `onCreate` that calls `enableEdgeToEdge()`, and overwriting the
 * file drops that (and any future template change). We insert our overrides
 * before the closing brace and mark the block so a re-run is a no-op.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '// LIGHTPEN_CAMERA_GRANT';

export function manifestEntries() {
  return [
    '<uses-permission android:name="android.permission.CAMERA" />',
    // Required for `onPermissionRequest` to reach the WebView client at all.
    '<uses-permission android:name="android.webkit.PermissionRequest" />',
    // Not required: tablets without a camera can still install and draw manually.
    '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  ];
}

/** Insert the permission lines after the manifest's root tag, without duplicating. */
export function patchManifest(xml) {
  const missing = manifestEntries().filter((line) => !xml.includes(line));
  if (missing.length === 0) return { xml, added: 0 };
  // Insert right after the opening <manifest ...> tag: valid for the merger, and
  // it keeps everything outside <application>.
  const patched = xml.replace(/(<manifest\b[^>]*>)/, `$1\n    ${missing.join('\n    ')}`);
  return { xml: patched, added: missing.length };
}

const CAMERA_MEMBERS = `
    ${MARKER}
    private val cameraRequestCode = 1001
    private var pendingRequest: PermissionRequest? = null

    override fun onWebViewCreate(webView: WebView) {
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // Grant video capture only; never audio.
                val wantsVideo = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                if (!wantsVideo) {
                    request.deny()
                    return
                }
                if (ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else {
                    pendingRequest = request
                    ActivityCompat.requestPermissions(
                        this@MainActivity, arrayOf(Manifest.permission.CAMERA), cameraRequestCode
                    )
                }
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == cameraRequestCode) {
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            pendingRequest?.let {
                if (granted) it.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else it.deny()
            }
            pendingRequest = null
        }
    }
`;

const IMPORTS = [
  'android.Manifest',
  'android.content.pm.PackageManager',
  'android.webkit.PermissionRequest',
  'android.webkit.WebChromeClient',
  'android.webkit.WebView',
  'androidx.core.app.ActivityCompat',
  'androidx.core.content.ContextCompat',
];

/**
 * Inject the grant into a generated MainActivity, keeping its existing body.
 * Returns the source unchanged when already patched.
 */
export function patchMainActivity(source) {
  if (source.includes(MARKER)) return { source, changed: false };

  const missing = IMPORTS.filter(
    (imp) => !new RegExp(`^import ${imp.replace(/\./g, '\\.')}$`, 'm').test(source),
  );
  let out = source;
  if (missing.length > 0) {
    const imports = missing.map((imp) => `import ${imp}`).join('\n');
    // Insert after the package line's following blank line, keeping the file tidy.
    const pkgEnd = out.indexOf('\n', out.indexOf('package ')) + 1;
    out = `${out.slice(0, pkgEnd)}\n${imports}\n${out.slice(pkgEnd)}`;
  }

  // Insert before the final closing brace of the class.
  const lastBrace = out.lastIndexOf('}');
  if (lastBrace === -1) throw new Error('MainActivity.kt has no closing brace');
  out = `${out.slice(0, lastBrace)}${CAMERA_MEMBERS}}\n`;
  return { source: out, changed: true };
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
      } else if (entry === 'MainActivity.kt') {
        return full;
      }
    }
  }
  return null;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const genAndroid = join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main');

  if (!existsSync(genAndroid)) {
    console.error(
      '[android-permissions] src-tauri/gen/android not found — run `npm run tauri android init` first.',
    );
    process.exit(1);
  }

  const manifestPath = join(genAndroid, 'AndroidManifest.xml');
  if (!existsSync(manifestPath)) {
    console.error(`[android-permissions] missing ${manifestPath}`);
    process.exit(1);
  }
  const manifest = patchManifest(readFileSync(manifestPath, 'utf8'));
  if (manifest.added > 0) {
    writeFileSync(manifestPath, manifest.xml);
    console.log(
      `[android-permissions] added ${manifest.added} manifest entr${manifest.added === 1 ? 'y' : 'ies'}`,
    );
  } else {
    console.log('[android-permissions] manifest already configured');
  }

  const activityPath = findMainActivity(join(genAndroid, 'java'));
  if (!activityPath) {
    console.error('[android-permissions] MainActivity.kt not found under gen/android/**/java');
    process.exit(1);
  }
  const activity = patchMainActivity(readFileSync(activityPath, 'utf8'));
  if (activity.changed) {
    writeFileSync(activityPath, activity.source);
    console.log(`[android-permissions] patched ${activityPath}`);
  } else {
    console.log(`[android-permissions] ${activityPath} already patched`);
  }
}

// Only run when executed directly, so the pure helpers stay importable by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
