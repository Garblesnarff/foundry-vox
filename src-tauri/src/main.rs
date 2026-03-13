#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::{multipart, Method};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::TcpListener;
use std::sync::Mutex;
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

struct ProgressBridgeState {
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloneUploadPayload {
    name: String,
    gender: String,
    transcript: String,
    tags: String,
    filename: String,
    audio_bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportBatchPayload {
    generation_ids: Vec<String>,
    mode: String,
    format: String,
    pause_seconds: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BinaryResponse {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressBridgeEvent {
    event_type: String,
    payload: Value,
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

async fn backend_request_bytes(
    runtime: &RuntimeState,
    client: &BackendClient,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<BinaryResponse, String> {
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

    let file_name = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split("filename=\"").nth(1))
        .and_then(|value| value.split('"').next())
        .unwrap_or("foundry-vox-output.bin")
        .to_string();

    let bytes = response.bytes().await.map_err(|error| error.to_string())?.to_vec();
    Ok(BinaryResponse { file_name, bytes })
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

#[tauri::command]
async fn backend_create_clone(
    payload: CloneUploadPayload,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    let url = format!("{}/voices/clone", runtime.api_base);
    let audio_part = multipart::Part::bytes(payload.audio_bytes).file_name(payload.filename);
    let form = multipart::Form::new()
        .text("name", payload.name)
        .text("gender", payload.gender)
        .text("transcript", payload.transcript)
        .text("tags", payload.tags)
        .part("audio", audio_part);

    let mut request = client.client.post(url).multipart(form);
    if let Some(token) = &runtime.api_token {
        request = request.header("x-foundry-vox-token", token);
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

    response.json::<Value>().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn backend_download_generation_audio(
    generation_id: String,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<BinaryResponse, String> {
    backend_request_bytes(
        &runtime,
        &client,
        Method::GET,
        &format!("/generate/{generation_id}/download"),
        None,
    )
    .await
}

#[tauri::command]
async fn backend_export_batch(
    payload: ExportBatchPayload,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<BinaryResponse, String> {
    let body = serde_json::json!({
        "generation_ids": payload.generation_ids,
        "mode": payload.mode,
        "format": payload.format,
        "pause_seconds": payload.pause_seconds.unwrap_or(0.5),
    });
    backend_request_bytes(&runtime, &client, Method::POST, "/export/batch", Some(body)).await
}

#[tauri::command]
async fn backend_get_voice_preview(
    voice_id: String,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<BinaryResponse, String> {
    backend_request_bytes(
        &runtime,
        &client,
        Method::GET,
        &format!("/voices/{voice_id}/preview"),
        None,
    )
    .await
}

async fn run_progress_bridge(
    app: tauri::AppHandle,
    client: reqwest::Client,
    api_base: String,
    api_token: Option<String>,
) -> Result<(), String> {
    let mut request = client.get(format!("{api_base}/generate/progress"));
    if let Some(token) = api_token {
        request = request.header("x-foundry-vox-token", token);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Progress stream failed with {}", response.status()));
    }

    let mut response = response;
    let mut buffer = String::new();
    let mut current_event = String::from("message");
    let mut data_lines: Vec<String> = Vec::new();

    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_index) = buffer.find('\n') {
            let line = buffer[..newline_index].trim_end_matches('\r').to_string();
            buffer.drain(..=newline_index);

            if line.is_empty() {
                if !data_lines.is_empty() {
                    let payload = serde_json::from_str::<Value>(&data_lines.join("\n"))
                        .unwrap_or_else(|_| Value::String(data_lines.join("\n")));
                    let _ = app.emit(
                        "backend://progress",
                        ProgressBridgeEvent {
                            event_type: current_event.clone(),
                            payload,
                        },
                    );
                }
                current_event = String::from("message");
                data_lines.clear();
                continue;
            }

            if let Some(event_type) = line.strip_prefix("event:") {
                current_event = event_type.trim().to_string();
                continue;
            }

            if let Some(data) = line.strip_prefix("data:") {
                data_lines.push(data.trim().to_string());
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn start_progress_bridge(
    app: tauri::AppHandle,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
    bridge: State<'_, ProgressBridgeState>,
) -> Result<(), String> {
    {
        let mut task = bridge.task.lock().map_err(|_| "Failed to lock progress bridge.".to_string())?;
        if let Some(existing) = task.take() {
            existing.abort();
        }
    }

    let app_handle = app.clone();
    let api_base = runtime.api_base.clone();
    let api_token = runtime.api_token.clone();
    let http = client.client.clone();

    let handle = tauri::async_runtime::spawn(async move {
        if let Err(error) = run_progress_bridge(app_handle.clone(), http, api_base, api_token).await {
            let _ = app_handle.emit("backend://progress-error", error);
        }
    });

    let mut task = bridge.task.lock().map_err(|_| "Failed to lock progress bridge.".to_string())?;
    *task = Some(handle);
    Ok(())
}

#[tauri::command]
fn stop_progress_bridge(bridge: State<'_, ProgressBridgeState>) -> Result<(), String> {
    let mut task = bridge.task.lock().map_err(|_| "Failed to lock progress bridge.".to_string())?;
    if let Some(existing) = task.take() {
        existing.abort();
    }
    Ok(())
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
            app.manage(ProgressBridgeState {
                task: Mutex::new(None),
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
            backend_generate,
            backend_create_clone,
            backend_download_generation_audio,
            backend_export_batch,
            backend_get_voice_preview,
            start_progress_bridge,
            stop_progress_bridge
        ])
        .run(tauri::generate_context!())
        .expect("error while running Foundry Vox");
}
