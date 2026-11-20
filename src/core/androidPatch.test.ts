/**
 * Tests for the scripts that edit the generated Android project.
 *
 * The Android build only exists in CI, so a broken patch script fails a 90-minute
 * release run with an error nobody can reproduce locally. These exercise the pure
 * functions against Tauri's actual generated templates.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs script, no type declarations
import { patchMainActivity, patchManifest } from '../../scripts/patch-android-permissions.mjs';
// @ts-expect-error -- plain .mjs script, no type declarations
import { keystoreProperties, patchGradle } from '../../scripts/configure-android-signing.mjs';

/** Verbatim from tauri-cli templates/mobile/android/app/src/main/AndroidManifest.xml. */
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:icon="@mipmap/ic_launcher"
        android:usesCleartextTraffic="\${usesCleartextTraffic}">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
</manifest>
`;

/** Verbatim shape of the generated MainActivity.kt (note enableEdgeToEdge). */
const MAIN_ACTIVITY = `package app.lightpen.desktop

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
`;

const GRADLE = `import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

android {
    compileSdk = 37
    namespace = "app.lightpen.desktop"
    buildTypes {
        getByName("release") {
            optimization {
               enable = true
            }
        }
    }
}
`;

describe('patchManifest', () => {
  it('adds CAMERA, the WebView permission and a non-required camera feature', () => {
    const { xml, added } = patchManifest(MANIFEST);
    expect(added).toBe(3);
    expect(xml).toContain('android.permission.CAMERA');
    expect(xml).toContain('android.webkit.PermissionRequest');
    expect(xml).toContain('android.hardware.camera" android:required="false"');
  });

  it('is idempotent', () => {
    const once = patchManifest(MANIFEST);
    const twice = patchManifest(once.xml);
    expect(twice.added).toBe(0);
    expect(twice.xml).toBe(once.xml);
  });

  it('inserts inside <manifest>, never before the XML declaration', () => {
    const { xml } = patchManifest(MANIFEST);
    expect(xml.startsWith('<?xml')).toBe(true);
    const manifestOpen = xml.indexOf('<manifest');
    const camera = xml.indexOf('android.permission.CAMERA');
    const application = xml.indexOf('<application');
    expect(camera).toBeGreaterThan(manifestOpen);
    expect(camera).toBeLessThan(application);
  });

  it('leaves <application> untouched', () => {
    const { xml } = patchManifest(MANIFEST);
    expect(xml).toContain('<activity android:name=".MainActivity" android:exported="true" />');
  });
});

describe('patchMainActivity', () => {
  it('keeps the generated onCreate (enableEdgeToEdge)', () => {
    // Replacing the file with a committed template used to drop this.
    const { source } = patchMainActivity(MAIN_ACTIVITY);
    expect(source).toContain('enableEdgeToEdge()');
    expect(source).toContain('super.onCreate(savedInstanceState)');
  });

  it('adds the PermissionRequest override and its imports', () => {
    const { source, changed } = patchMainActivity(MAIN_ACTIVITY);
    expect(changed).toBe(true);
    expect(source).toContain('override fun onWebViewCreate(webView: WebView)');
    expect(source).toContain('onPermissionRequest');
    expect(source).toContain('import android.Manifest');
    expect(source).toContain('import androidx.core.content.ContextCompat');
  });

  it('grants video only and never audio', () => {
    const { source } = patchMainActivity(MAIN_ACTIVITY);
    expect(source).toContain('RESOURCE_VIDEO_CAPTURE');
    expect(source).toContain('request.deny()');
  });

  it('keeps the members inside the class body', () => {
    const { source } = patchMainActivity(MAIN_ACTIVITY);
    const lastBrace = source.lastIndexOf('}');
    expect(source.indexOf('onWebViewCreate')).toBeLessThan(lastBrace);
    // Exactly one statement may follow the inserted block: the class brace.
    expect(source.slice(lastBrace + 1).trim()).toBe('');
  });

  it('is idempotent', () => {
    const once = patchMainActivity(MAIN_ACTIVITY);
    const twice = patchMainActivity(once.source);
    expect(twice.changed).toBe(false);
    expect(twice.source).toBe(once.source);
  });

  it('does not duplicate imports that are already there', () => {
    const already = MAIN_ACTIVITY.replace(
      'import android.os.Bundle',
      'import android.os.Bundle\nimport android.webkit.WebView',
    );
    const { source } = patchMainActivity(already);
    expect(source.match(/^import android\.webkit\.WebView$/gm)).toHaveLength(1);
  });
});

describe('android signing', () => {
  it('writes the property names Gradle reads', () => {
    const props = keystoreProperties({
      storeFile: '/tmp/k.jks',
      keyAlias: 'upload',
      password: 's3cret',
    });
    expect(props).toContain('storeFile=/tmp/k.jks');
    expect(props).toContain('keyAlias=upload');
    expect(props).toContain('password=s3cret');
  });

  it('adds a release signingConfig and selects it in buildTypes', () => {
    const { gradle, changed } = patchGradle(GRADLE);
    expect(changed).toBe(true);
    expect(gradle).toContain('signingConfigs {');
    expect(gradle).toContain('create("release")');
    expect(gradle).toContain('rootProject.file("keystore.properties")');
    expect(gradle).toContain('signingConfig = signingConfigs.getByName("release")');
    expect(gradle).toContain('import java.io.FileInputStream');
  });

  it('puts signingConfigs before buildTypes and inside android {}', () => {
    const { gradle } = patchGradle(GRADLE);
    const androidOpen = gradle.indexOf('android {');
    const signing = gradle.indexOf('signingConfigs {');
    const buildTypes = gradle.indexOf('buildTypes {');
    expect(signing).toBeGreaterThan(androidOpen);
    expect(signing).toBeLessThan(buildTypes);
  });

  it('selects the config inside the release block, not the debug one', () => {
    const { gradle } = patchGradle(GRADLE);
    const releaseIdx = gradle.indexOf('getByName("release")');
    const selection = gradle.indexOf('signingConfig = signingConfigs.getByName("release")');
    expect(selection).toBeGreaterThan(releaseIdx);
  });

  it('is idempotent', () => {
    const once = patchGradle(GRADLE);
    const twice = patchGradle(once.gradle);
    expect(twice.changed).toBe(false);
    expect(twice.gradle).toBe(once.gradle);
  });

  it('does not import FileInputStream twice', () => {
    const once = patchGradle(GRADLE);
    const again = patchGradle(once.gradle.replace('// LIGHTPEN_RELEASE_SIGNING', ''));
    expect(again.gradle.match(/import java\.io\.FileInputStream/g)).toHaveLength(1);
  });
});
