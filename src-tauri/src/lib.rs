//! LightPen Tauri backend.
//!
//! The app is intentionally thin on the Rust side: the frontend does PDF
//! rendering, annotation and hand tracking (WASM). The Rust layer only
//! provides the native window, native menus, file dialogs, the annotation
//! sidecar store and OS "open with" support.
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

/// Maximum size accepted through the "open with" path. Larger files must be
/// opened through the file dialog (which streams through the fs plugin).
/// Documented in `docs/DECISIONS.md` (ADR-016).
const MAX_OPEN_WITH_BYTES: u64 = 32 * 1024 * 1024;

/// A PDF handed to the app by the OS.
#[derive(Serialize)]
pub struct OpenFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Returns the app version, single-sourced from `Cargo.toml`.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Read a PDF passed by the OS ("open with" / double-click on a file).
/// Returns `None` when the path is not a PDF or is too large.
#[tauri::command]
fn read_open_file(path: String) -> Result<Option<OpenFile>, String> {
    let lower = path.to_lowercase();
    if !lower.ends_with(".pdf") {
        return Ok(None);
    }
    let meta = std::fs::metadata(&path).map_err(|e| format!("cannot read file: {e}"))?;
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_OPEN_WITH_BYTES {
        return Err("This PDF is too large to open from the file association. Use Open PDF instead.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("cannot read file: {e}"))?;
    let name = std::path::Path::new(&path)
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
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![app_version, read_open_file]);

    #[cfg(desktop)]
    {
        builder = builder
            .menu(|app| build_menu(app))
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

    app.run(|_app_handle, event| {
        // macOS / iOS deliver files opened from Finder or another app here.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            use tauri::Emitter;
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let _ = _app_handle.emit("lightpen:open-path", path.to_string_lossy().to_string());
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
}
