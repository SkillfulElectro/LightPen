# Mobile notes (Android / iOS)

Both platforms run the same webview bundle as desktop. The differences that
matter are permissions, layout and lifecycle — all handled in the web app except
the Android camera grant below.

## Android

### Camera permission in a WebView (must be done natively)

`getUserMedia()` inside an Android WebView does **not** get the camera just
because `android.permission.CAMERA` is declared. The embedding app has to approve
the WebView's `PermissionRequest`; without that, `getUserMedia` rejects and the
app shows its normal "camera not supported / permission denied" recovery UI
(manual drawing still works).

Both halves are applied automatically after `npm run tauri android init`:

```bash
npm run android:permissions
```

`src-tauri/gen/android` is generated and gitignored, so the logic lives in
`scripts/patch-android-permissions.mjs` (unit-tested in
`src/core/androidPatch.test.ts`). It adds `CAMERA`,
`android.webkit.PermissionRequest` and a non-required camera `uses-feature`
(tablets without a camera still install and can draw manually), then **edits**
the generated `MainActivity` to approve the WebView request:

```kotlin
// inserted before the class's closing brace, keeping Tauri's onCreate
override fun onWebViewCreate(webView: WebView) {
    webView.webChromeClient = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            if (!request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                request.deny()
                return
            }
            // grant after the runtime CAMERA permission is held; see the script
        }
    }
}
```

> It edits rather than replaces the file on purpose: the Tauri template's
> `onCreate` calls `enableEdgeToEdge()`, which a wholesale replacement silently
> dropped.

### Release signing

`npm run android:signing` writes `src-tauri/gen/android/keystore.properties` and
adds a `release` signingConfig to the generated `app/build.gradle.kts`. The second
part is required — with only the properties file, Gradle still produces an
unsigned release APK. `release.yml` runs it after `android init` when the keystore
secrets are present.

**Android only installs signed APKs.** v0.1.4 shipped an unsigned release APK
because `ANDROID_KEY_BASE64` was unset: the signing step exited 0 and the next
step still built a _release_ variant, and Gradle signs nothing without a
signingConfig. Installing it gives the famously unhelpful _"App not installed as
package appears to be invalid"_. The build job now has two mutually exclusive
paths, and never both:

| Secrets                               | Build                                                            | Artifact                                      |
| ------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| `ANDROID_KEY_BASE64` + alias/password | `tauri android build -- --apk --aab` (release, release-signed)   | `LightPen_<v>_android_universal.apk` + `.aab` |
| none                                  | `tauri android build -- --debug --apk` (debug, Gradle debug key) | `LightPen_<v>_android_universal_debug.apk`    |

Before uploading, `apksigner verify --print-certs` must pass for every APK, the
certificate DN must exist, and a release build signed with the `Android Debug`
key fails the job. So "installable" is enforced, not assumed — the debug APK
exists exactly so that a release without secrets still yields something a user
can install and test.

The original snippet, for reference:

```kotlin
package app.lightpen.desktop

import android.Manifest
import android.content.pm.PackageManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
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
}
```

> Status: **unverified.** The snippet follows the standard Android WebView
> pattern and is applied by a script that is tested for idempotence, but it was
> not compiled or run (no Android SDK/NDK in the development environment). Run
> the Android items in `docs/QA-CHECKLIST.md` after the first real build;
> `docs/RELEASING.md` lists this under Unverified as well.

### Layout

Below 800 px the camera preview becomes a floating, collapsible
picture-in-picture over the page so the user can see the hand and the document at
the same time. Toolbar touch targets are enlarged to 40 px.

### Lifecycle

The app stops the camera stream when the page becomes hidden
(`document.visibilitychange`), which covers sending the app to the background and
pausing tracking.

## iOS

- `NSCameraUsageDescription` is in `src-tauri/Info.plist`; WKWebView shows it in
  the system prompt when the app first calls `getUserMedia`.
- The MediaPipe GPU delegate may be unavailable in WKWebView; the tracker falls
  back to the CPU delegate automatically (`src/platform/mediapipe.ts`).
- Files can be opened through the document picker and "Open in LightPen"
  (`UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace`).

Both mobile builds are unverified for the same reason: no Xcode or Android SDK
here. See `docs/RELEASING.md` → Unverified.

Note that `bundle.targets` in `tauri.conf.json` must never list `apk`, `aab` or
`ipa`: those are not bundle targets in Tauri 2 and make `tauri build` fail
validation on every desktop platform. Android artifacts come from
`tauri android build` (see `release.yml`), not from `tauri build`.
