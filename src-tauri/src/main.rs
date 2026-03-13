#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

struct RuntimeState {
    api_base: String,
    api_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    api_base: String,
    api_token: Option<String>,
}

#[tauri::command]
fn runtime_config(state: State<'_, RuntimeState>) -> RuntimeConfig {
    RuntimeConfig {
        api_base: state.api_base.clone(),
        api_token: state.api_token.clone(),
    }
}

fn spawn_backend(app: &tauri::App, api_token: Option<&str>) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();
    let app_data_dir = app_handle.path().app_local_data_dir()?;
    std::fs::create_dir_all(&app_data_dir)?;

    let mut sidecar = app_handle
        .shell()
        .sidecar("foundry-vox-backend")?
        .env("FOUNDRY_VOX_HOME", app_data_dir.to_string_lossy().to_string());

    if let Some(token) = api_token {
        sidecar = sidecar.env("FOUNDRY_VOX_API_TOKEN", token.to_string());
    }

    let (mut rx, _child) = sidecar.spawn()?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    if let Ok(line) = String::from_utf8(bytes) {
                        let _ = app_handle.emit("backend://stdout", line);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    if let Ok(line) = String::from_utf8(bytes) {
                        let _ = app_handle.emit("backend://stderr", line);
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let api_base = "http://127.0.0.1:3456/api/v1".to_string();
            let api_token = if cfg!(debug_assertions) {
                None
            } else {
                Some(Uuid::new_v4().to_string())
            };

            app.manage(RuntimeState {
                api_base,
                api_token: api_token.clone(),
            });

            if !cfg!(debug_assertions) {
                spawn_backend(app, api_token.as_deref())?;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![runtime_config])
        .run(tauri::generate_context!())
        .expect("error while running Foundry Vox");
}
