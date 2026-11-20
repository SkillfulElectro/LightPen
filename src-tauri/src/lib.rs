//! LightPen Tauri backend.
//!
//! The app is intentionally thin on the Rust side: the frontend does PDF
//! rendering, annotation and hand tracking (WASM). The Rust layer only
//! provides the native window, native menus, file dialogs and the annotation
//! sidecar store.
//!
//! Security notes:
//! - no `unsafe` code (enforced by `#![forbid(unsafe_code)]`),
//! - capabilities are least-privilege (see `capabilities/`),
//! - no network access is granted to the frontend.

#![forbid(unsafe_code)]
#![cfg_attr(not(debug_assertions), deny(warnings))]

use tauri::Manager;

/// Returns the app version, single-sourced from `Cargo.toml`.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![app_version]);

    #[cfg(desktop)]
    {
        builder = builder.setup(|app| {
            let _ = app.get_webview_window("main");
            Ok(())
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running LightPen");
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
}
