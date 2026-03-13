#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::net::TcpListener;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

struct RuntimeState {
    api_base: String,
    api_token: Option<String>,
}

#[derive(Clone)]
struct BackendClient {
    client: reqwest::Client,
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

async fn backend_request<T: DeserializeOwned>(
    runtime: &RuntimeState,
    client: &BackendClient,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<T, String> {
    let url = format!("{}{}", runtime.api_base, path);
    let mut request = client.client.request(method, &url);

    if let Some(token) = &runtime.api_token {
        request = request.header("x-foundry-vox-token", token);
    }

    if let Some(payload) = body {
        request = request.json(&payload);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        let fallback = format!("Backend request failed with {}", response.status());
        let error = response
            .json::<Value>()
            .await
            .ok()
            .and_then(|payload| payload.get("message").and_then(Value::as_str).map(str::to_string))
            .unwrap_or(fallback);
        return Err(error);
    }

    response.json::<T>().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn backend_get_health(
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(&runtime, &client, Method::GET, "/health", None).await
}

#[tauri::command]
async fn backend_get_settings(
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(&runtime, &client, Method::GET, "/settings", None).await
}

#[tauri::command]
async fn backend_patch_settings(
    payload: Value,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(&runtime, &client, Method::PATCH, "/settings", Some(payload)).await
}

#[tauri::command]
async fn backend_get_history(
    query: String,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    let path = if query.is_empty() {
        "/history".to_string()
    } else {
        format!("/history?{query}")
    };
    backend_request(&runtime, &client, Method::GET, &path, None).await
}

#[tauri::command]
async fn backend_get_history_stats(
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(&runtime, &client, Method::GET, "/history/stats", None).await
}

#[tauri::command]
async fn backend_get_voices(
    voice_type: Option<String>,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    let path = match voice_type {
        Some(kind) if !kind.is_empty() => format!("/voices?type={kind}"),
        _ => "/voices".to_string(),
    };
    backend_request(&runtime, &client, Method::GET, &path, None).await
}

#[tauri::command]
async fn backend_get_voice(
    voice_id: String,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(&runtime, &client, Method::GET, &format!("/voices/{voice_id}"), None).await
}

#[tauri::command]
async fn backend_update_voice(
    voice_id: String,
    payload: Value,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(
        &runtime,
        &client,
        Method::PUT,
        &format!("/voices/{voice_id}"),
        Some(payload),
    )
    .await
}

#[tauri::command]
async fn backend_delete_voice(
    voice_id: String,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(
        &runtime,
        &client,
        Method::DELETE,
        &format!("/voices/{voice_id}"),
        None,
    )
    .await
}

#[tauri::command]
async fn backend_delete_history_item(
    generation_id: String,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(
        &runtime,
        &client,
        Method::DELETE,
        &format!("/history/{generation_id}"),
        None,
    )
    .await
}

#[tauri::command]
async fn backend_clear_history(
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(&runtime, &client, Method::DELETE, "/history", None).await
}

#[tauri::command]
async fn backend_generate(
    payload: Value,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(&runtime, &client, Method::POST, "/generate", Some(payload)).await
}

fn open_loopback_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn spawn_backend(
    app: &tauri::App,
    api_port: u16,
    api_token: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();
    let app_data_dir = app_handle.path().app_local_data_dir()?;
    std::fs::create_dir_all(&app_data_dir)?;

    let mut sidecar = app_handle
        .shell()
        .sidecar("foundry-vox-backend")?
        .env("FOUNDRY_VOX_HOME", app_data_dir.to_string_lossy().to_string())
        .env("FOUNDRY_VOX_PORT", api_port.to_string());

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
            let api_port = if cfg!(debug_assertions) { 3456 } else { open_loopback_port()? };
            let api_base = format!("http://127.0.0.1:{api_port}/api/v1");
            let api_token = if cfg!(debug_assertions) {
                None
            } else {
                Some(Uuid::new_v4().to_string())
            };

            app.manage(RuntimeState {
                api_base,
                api_token: api_token.clone(),
            });
            app.manage(BackendClient {
                client: reqwest::Client::new(),
            });

            if !cfg!(debug_assertions) {
                spawn_backend(app, api_port, api_token.as_deref())?;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_config,
            backend_get_health,
            backend_get_settings,
            backend_patch_settings,
            backend_get_history,
            backend_get_history_stats,
            backend_get_voices,
            backend_get_voice,
            backend_update_voice,
            backend_delete_voice,
            backend_delete_history_item,
            backend_clear_history,
            backend_generate
        ])
        .run(tauri::generate_context!())
        .expect("error while running Foundry Vox");
}
