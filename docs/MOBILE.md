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

The manifest additions live in `src-tauri/AndroidManifest.fragment.xml`
(`CAMERA` + a non-required camera `uses-feature`, so tablets without a camera can
still install and draw manually).

Approve the request in the generated `MainActivity` (created by
`npm run tauri android init`, path
`src-tauri/gen/android/app/src/main/java/app/lightpen/desktop/MainActivity.kt`):

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
> pattern but was not compiled or run (no Android SDK/NDK in the development
> environment). Apply it after `tauri android init`, then run the Android items in
> `docs/QA-CHECKLIST.md`. `docs/RELEASING.md` lists this under Unverified as well.

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
