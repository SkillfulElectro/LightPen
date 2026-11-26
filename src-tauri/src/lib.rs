//! LightPen Tauri backend.
//!
//! The app is intentionally thin on the Rust side: the frontend does PDF
//! rendering, annotation and hand tracking (WASM). The Rust layer only
//! provides the native window, native menus, file dialogs, the annotation
//! sidecar store, diagnostic logging and OS "open with" support.
//!
//! Security notes:
//! - no `unsafe` code (enforced by `#![forbid(unsafe_code)]`),
//! - capabilities are least-privilege (see `capabilities/`),
//! - no network access is granted to the frontend,
//! - "open with" only reads files whose extension is `.pdf`, with a size cap.

#![forbid(unsafe_code)]
// Deliberately no `deny(warnings)` in release: with it, a new deprecation or an
// `unused_imports` inside a dependency's macro expansion fails the whole release
// build. Warnings are printed; `cargo clippy -D warnings` in CI is the gate.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::webview::{PermissionKind, PermissionResponse};

/// Maximum size accepted through the "open with" path. Larger files must be
/// opened through the file dialog (which streams through the fs plugin).
/// Documented in `docs/DECISIONS.md` (ADR-016).
const MAX_OPEN_WITH_BYTES: u64 = 32 * 1024 * 1024;

/// Maximum size of the rolling diagnostic log file before rotation.
const MAX_LOG_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Default and maximum tail size returned by `read_recent_logs`.
const DEFAULT_READ_LOG_BYTES: usize = 128 * 1024;
const MAX_READ_LOG_BYTES: usize = 512 * 1024;

static LOG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

/// A PDF handed to the app by the OS.
#[derive(Serialize)]
pub struct OpenFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

fn default_log_path() -> PathBuf {
    if let Some(xdg) = non_empty_env("XDG_DATA_HOME") {
        return PathBuf::from(xdg)
            .join("app.lightpen.desktop")
            .join("logs")
            .join("lightpen.log");
    }
    if let Some(appdata) = non_empty_env("APPDATA") {
        return PathBuf::from(appdata)
            .join("app.lightpen.desktop")
            .join("logs")
            .join("lightpen.log");
    }
    if let Some(home) = non_empty_env("HOME") {
        #[cfg(target_os = "macos")]
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("app.lightpen.desktop")
            .join("logs")
            .join("lightpen.log");
        #[cfg(not(target_os = "macos"))]
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("app.lightpen.desktop")
            .join("logs")
            .join("lightpen.log");
    }
    std::env::temp_dir().join("lightpen.log")
}

fn sanitize_log_level(level: &str) -> &'static str {
    match level.to_ascii_lowercase().as_str() {
        "debug" => "DEBUG",
        "warn" | "warning" => "WARN",
        "error" => "ERROR",
        _ => "INFO",
    }
}

fn format_log_line(
    unix_ms: u128,
    level: &str,
    scope: &str,
    message: &str,
    context: Option<&str>,
) -> String {
    let lvl = sanitize_log_level(level);
    match context.filter(|c| !c.is_empty()) {
        Some(ctx) => format!("[{unix_ms}] [{lvl}] [{scope}] {message} {ctx}"),
        None => format!("[{unix_ms}] [{lvl}] [{scope}] {message}"),
    }
}

fn append_log_file(path: &Path, line: &str) {
    let _guard = match LOG_LOCK.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if fs::metadata(path).is_ok_and(|m| m.len() > MAX_LOG_FILE_BYTES) {
        let rotated = path.with_extension("log.old");
        let _ = fs::rename(path, rotated);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn read_tail_bytes(path: &Path, max_bytes: usize) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("cannot read log file: {e}"))?;
    let start = bytes.len().saturating_sub(max_bytes);
    Ok(String::from_utf8_lossy(&bytes[start..]).into_owned())
}

fn log_line(level: &str, scope: &str, message: &str, context: Option<&str>) {
    let unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = format_log_line(unix_ms, level, scope, message, context);
    eprintln!("{line}");
    let path = LOG_FILE_PATH.get_or_init(default_log_path);
    append_log_file(path, &line);
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".into());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("non-string panic payload");
        let ctx = format!("location={location}");
        log_line("error", "rust-panic", payload, Some(&ctx));
        previous(info);
    }));
}

#[cfg(target_os = "linux")]
fn detect_nvidia_driver() -> Option<String> {
    if let Ok(text) = fs::read_to_string("/proc/driver/nvidia/version") {
        let first = text
            .lines()
            .next()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .unwrap_or("nvidia");
        return Some(first.to_string());
    }
    if Path::new("/sys/module/nvidia").exists() {
        return Some("nvidia-module".into());
    }
    None
}

/// Log Linux graphics/WebKitGTK environment before GTK/WebKit initializes.
///
/// Never forces `WEBKIT_DISABLE_DMABUF_RENDERER=1` automatically: on modern
/// WebKitGTK + NVIDIA hosts, disabling DMA-BUF can break WebGL2 / texture
/// uploads so MediaPipe stops receiving camera frames. Users who want to test
/// without DMA-BUF can opt in explicitly via `LIGHTPEN_DISABLE_DMABUF=1` or
/// `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
#[cfg(target_os = "linux")]
fn configure_linux_webkit_env() {
    let nvidia = detect_nvidia_driver();
    let dmabuf_before = non_empty_env("WEBKIT_DISABLE_DMABUF_RENDERER");
    let opt_in_disable_dmabuf = non_empty_env("LIGHTPEN_DISABLE_DMABUF").as_deref() == Some("1");

    if opt_in_disable_dmabuf && dmabuf_before.is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        log_line(
            "info",
            "linux-webkit",
            "LIGHTPEN_DISABLE_DMABUF=1 set; enabled WEBKIT_DISABLE_DMABUF_RENDERER=1",
            None,
        );
    }

    let session = non_empty_env("XDG_SESSION_TYPE").unwrap_or_else(|| "unknown".into());
    let wayland = non_empty_env("WAYLAND_DISPLAY").is_some();
    let x11 = non_empty_env("DISPLAY").is_some();
    let appimage = non_empty_env("APPIMAGE").is_some();
    let dmabuf_now =
        non_empty_env("WEBKIT_DISABLE_DMABUF_RENDERER").unwrap_or_else(|| "unset".into());
    let compositing =
        non_empty_env("WEBKIT_DISABLE_COMPOSITING_MODE").unwrap_or_else(|| "unset".into());
    let nvidia_str = nvidia.as_deref().unwrap_or("none");
    let ctx = format!(
        "session={session} wayland={wayland} x11={x11} appimage={appimage} dmabuf_disabled={dmabuf_now} compositing_disabled={compositing} nvidia={nvidia_str}"
    );
    log_line("info", "linux-env", "Linux graphics/session environment", Some(&ctx));
}

fn log_startup_banner() {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0);
    let path = LOG_FILE_PATH.get_or_init(default_log_path);
    let ctx = format!(
        "version={} os={} arch={} cpu_threads={} log_file={}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        threads,
        path.display()
    );
    log_line("info", "startup", "LightPen starting", Some(&ctx));
}

/// Decide a webview permission request.
///
/// This is what makes the camera work on Linux (e.g. CachyOS/Arch) at all.
/// WebKitGTK denies every `permission-request` that nobody answers, and
/// wry/Tauri only connect that signal when a handler is installed — so with
/// no handler, `getUserMedia({ video: true })` rejected with
/// `NotAllowedError` on every Linux machine, no prompt ever appeared, and
/// the UI reported “camera permission was denied” even though the user had
/// never been asked. There is no browser or OS toggle that could undo that
/// denial; only the embedder (this code) can answer it.
///
/// Only the camera is allowed, because that is the only capture the app
/// uses; microphone, geolocation and notifications stay on the webview
/// default (denied). macOS/iOS still enforce the OS prompt (`Info.plist`) and
/// Android still goes through the runtime permission (see
/// `scripts/patch-android-permissions.mjs`); this handler only removes
/// the extra webview-level veto. Documented in ADR-023.
///
/// Requires Tauri ≥ 2.12, the first release with
/// `Builder::on_permission_request`; `Cargo.toml` pins that floor.
fn permission_response(kind: PermissionKind) -> PermissionResponse {
    match kind {
        PermissionKind::Camera => PermissionResponse::Allow,
        _ => PermissionResponse::Default,
    }
}

/// Returns the app version, single-sourced from `Cargo.toml`.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Receive structured diagnostic logs from the frontend and write them to stderr + log file.
#[tauri::command]
fn log_event(level: String, scope: String, message: String, context: Option<String>) {
    log_line(&level, &scope, &message, context.as_deref());
}

/// Return the persistent diagnostic log file path so users can share bug reports easily.
#[tauri::command]
fn get_log_path() -> Option<String> {
    let path = LOG_FILE_PATH.get_or_init(default_log_path);
    Some(path.to_string_lossy().into_owned())
}

/// Read the tail of the persistent diagnostic log file.
#[tauri::command]
fn read_recent_logs(max_bytes: Option<usize>) -> Result<String, String> {
    let path = LOG_FILE_PATH.get_or_init(default_log_path);
    if !path.exists() {
        return Ok(String::new());
    }
    let limit = max_bytes.unwrap_or(DEFAULT_READ_LOG_BYTES).clamp(1024, MAX_READ_LOG_BYTES);
    read_tail_bytes(path, limit)
}

/// Read a PDF passed by the OS ("open with" / double-click on a file).
/// Returns `None` when the path is not a PDF or is too large.
#[tauri::command]
fn read_open_file(path: String) -> Result<Option<OpenFile>, String> {
    let lower = path.to_lowercase();
    if !lower.ends_with(".pdf") {
        return Ok(None);
    }
    let meta = fs::metadata(&path).map_err(|e| format!("cannot read file: {e}"))?;
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_OPEN_WITH_BYTES {
        return Err(
            "This PDF is too large to open from the file association. Use Open PDF instead.".into(),
        );
    }
    let bytes = fs::read(&path).map_err(|e| format!("cannot read file: {e}"))?;
    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.pdf")
        .to_string();
    Ok(Some(OpenFile { name, bytes }))
}

/// Native application menu (macOS gets the standard app menu with About/Quit).
#[cfg(desktop)]
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

    let about = AboutMetadata {
        name: Some("LightPen".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        copyright: Some("MIT © ElectroMutex".into()),
        comments: Some("Write on PDFs in the air. Everything runs on your device.".into()),
        ..Default::default()
    };

    let file = SubmenuBuilder::new(app, "File")
        .text("open", "Open PDF…")
        .text("export_pdf", "Save Annotated PDF…")
        .text("export_png", "Export Page as PNG…")
        .separator()
        .close_window()
        .quit()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .text("undo", "Undo")
        .text("redo", "Redo")
        .separator()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .text("zoom_in", "Zoom In")
        .text("zoom_out", "Zoom Out")
        .text("fit_page", "Fit Page")
        .build()?;

    // Help owns the About item. macOS shows it in the application menu instead,
    // where `.about(...)` below puts it with the proper role handler — hence the
    // cfg split. macOS never gets both.
    #[cfg(not(target_os = "macos"))]
    let help = SubmenuBuilder::new(app, "Help")
        .text("tutorial", "Tutorial")
        .text("cheat_sheet", "Gesture Cheat Sheet")
        .text("shortcuts", "Keyboard Shortcuts")
        .separator()
        .about(Some(about.clone()))
        .build()?;
    #[cfg(target_os = "macos")]
    let help = SubmenuBuilder::new(app, "Help")
        .text("tutorial", "Tutorial")
        .text("cheat_sheet", "Gesture Cheat Sheet")
        .text("shortcuts", "Keyboard Shortcuts")
        .build()?;

    let app_menu = SubmenuBuilder::new(app, "LightPen")
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &help])
        .build()
}

/// Forward a menu selection to the frontend as a `lightpen:menu` event.
#[cfg(desktop)]
fn forward_menu_event(app: &tauri::AppHandle, id: &tauri::menu::MenuId) {
    use tauri::Emitter;
    let id = id.as_ref().to_string();
    // Standard roles are handled by Tauri itself; only forward ours.
    const OURS: [&str; 11] = [
        "open",
        "export_pdf",
        "export_png",
        "undo",
        "redo",
        "zoom_in",
        "zoom_out",
        "fit_page",
        "tutorial",
        "cheat_sheet",
        "shortcuts",
    ];
    if OURS.contains(&id.as_str()) {
        let _ = app.emit("lightpen:menu", id);
    }
}

/// Emit the first `.pdf` argument so the frontend can open it.
#[cfg(desktop)]
fn emit_cli_file(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let path = std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".pdf"));
    if let Some(path) = path {
        let _ = app.emit("lightpen:open-path", path);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();
    log_startup_banner();
    #[cfg(target_os = "linux")]
    configure_linux_webkit_env();

    let mut builder = tauri::Builder::default()
        // Without this, WebKitGTK denies the camera unconditionally on
        // Linux (see `permission_response`). Applies to every webview.
        .on_permission_request(|_, kind| permission_response(kind))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            app_version,
            read_open_file,
            log_event,
            get_log_path,
            read_recent_logs
        ]);

    #[cfg(desktop)]
    {
        builder = builder
            .menu(build_menu)
            .on_menu_event(|app, event| forward_menu_event(app, event.id()))
            .setup(|app| {
                use tauri::Manager;
                // `get_webview_window` comes from the `Manager` trait; without the
                // import this is E0599 ("no method named get_webview_window").
                let _ = app.get_webview_window("main");
                emit_cli_file(app.handle());
                Ok(())
            });
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building LightPen");

    // The handler is only meaningful on macOS/iOS; the leading underscore keeps
    // `-D warnings` (clippy) happy on the other platforms, where the body below
    // compiles away and the parameter would otherwise be unused (and `_event`
    // is still a usable name inside the `cfg` block).
    app.run(|_app_handle, _event| {
        // macOS / iOS deliver files opened from Finder or another app here.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            use tauri::Emitter;
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let _ =
                        _app_handle.emit("lightpen:open-path", path.to_string_lossy().to_string());
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_semver() {
        let v = app_version();
        let parts: Vec<&str> = v.split('.').collect();
        assert_eq!(parts.len(), 3, "version must be SemVer MAJOR.MINOR.PATCH");
        for p in parts {
            assert!(p.chars().next().unwrap().is_ascii_digit());
        }
    }

    #[test]
    fn rejects_non_pdf_paths() {
        assert!(read_open_file("/tmp/notes.txt".into()).unwrap().is_none());
    }

    #[test]
    fn missing_file_is_an_error_not_a_panic() {
        assert!(read_open_file("/definitely/not/here.pdf".into()).is_err());
    }

    #[test]
    fn camera_permission_is_allowed() {
        // The regression this guards: with no (or a Default) answer,
        // WebKitGTK denies getUserMedia on Linux before any prompt exists.
        assert!(matches!(
            permission_response(PermissionKind::Camera),
            PermissionResponse::Allow
        ));
    }

    #[test]
    fn non_camera_permissions_keep_the_webview_default() {
        // The app never records audio and never asks where the user is, so
        // those requests must not be silently granted by the camera fix.
        for kind in [
            PermissionKind::Microphone,
            PermissionKind::Geolocation,
            PermissionKind::Notifications,
        ] {
            assert!(
                matches!(permission_response(kind), PermissionResponse::Default),
                "{kind:?} must stay on the webview default"
            );
        }
    }

    #[test]
    fn formats_diagnostic_log_lines_cleanly() {
        assert_eq!(sanitize_log_level("warn"), "WARN");
        assert_eq!(sanitize_log_level("ERROR"), "ERROR");
        assert_eq!(sanitize_log_level("unknown"), "INFO");
        assert_eq!(
            format_log_line(42, "warn", "perf", "Slow frame", Some("fps=16")),
            "[42] [WARN] [perf] Slow frame fps=16"
        );
        assert_eq!(
            format_log_line(42, "info", "startup", "Boot", None),
            "[42] [INFO] [startup] Boot"
        );
    }

    #[test]
    fn reads_tail_of_log_file() {
        let path = std::env::temp_dir().join("lightpen-tail-test.log");
        let _ = fs::write(&path, "0123456789abcdef");
        let tail = read_tail_bytes(&path, 6).unwrap();
        let _ = fs::remove_file(&path);
        assert_eq!(tail, "abcdef");
    }
}
