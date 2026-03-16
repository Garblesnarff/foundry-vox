#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::{multipart, Method};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::time::sleep;
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

const STARTUP_RETRY_ATTEMPTS: usize = 20;
const STARTUP_RETRY_DELAY: Duration = Duration::from_millis(300);

#[derive(Clone, Deserialize)]
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

async fn send_with_retry(
    client: &reqwest::Client,
    method: Method,
    url: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<reqwest::Response, String> {
    let mut last_error: Option<String> = None;

    for attempt in 0..STARTUP_RETRY_ATTEMPTS {
        let mut request = client.request(method.clone(), url);
        if let Some(token_value) = token {
            request = request.header("x-foundry-vox-token", token_value);
        }
        if let Some(payload) = body.clone() {
            request = request.json(&payload);
        }

        match request.send().await {
            Ok(response) => return Ok(response),
            Err(error) if error.is_connect() || error.is_timeout() => {
                last_error = Some(error.to_string());
                if attempt + 1 < STARTUP_RETRY_ATTEMPTS {
                    sleep(STARTUP_RETRY_DELAY).await;
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err(last_error.unwrap_or_else(|| "The Foundry Vox backend did not become ready in time.".to_string()))
}

async fn backend_request<T: DeserializeOwned>(
    runtime: &RuntimeState,
    client: &BackendClient,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<T, String> {
    let url = format!("{}{}", runtime.api_base, path);
    let response = send_with_retry(&client.client, method, &url, runtime.api_token.as_deref(), body).await?;
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
    let response = send_with_retry(&client.client, method, &url, runtime.api_token.as_deref(), body).await?;
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
fn open_models_directory(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let models_dir = app_data_dir.join("models");
    std::fs::create_dir_all(&models_dir).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(models_dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| error.to_string())
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
    let mut last_error: Option<String> = None;
    let mut maybe_response = None;

    for attempt in 0..STARTUP_RETRY_ATTEMPTS {
        let audio_part =
            multipart::Part::bytes(payload.audio_bytes.clone()).file_name(payload.filename.clone());
        let form = multipart::Form::new()
            .text("name", payload.name.clone())
            .text("gender", payload.gender.clone())
            .text("transcript", payload.transcript.clone())
            .text("tags", payload.tags.clone())
            .part("audio", audio_part);

        let mut request = client.client.post(&url).multipart(form);
        if let Some(token) = &runtime.api_token {
            request = request.header("x-foundry-vox-token", token);
        }

        match request.send().await {
            Ok(response) => {
                maybe_response = Some(response);
                break;
            }
            Err(error) if error.is_connect() || error.is_timeout() => {
                last_error = Some(error.to_string());
                if attempt + 1 < STARTUP_RETRY_ATTEMPTS {
                    sleep(STARTUP_RETRY_DELAY).await;
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    let response = maybe_response.ok_or_else(|| {
        last_error
            .clone()
            .unwrap_or_else(|| "The Foundry Vox backend did not become ready in time.".to_string())
    })?;
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

#[tauri::command]
async fn backend_warmup_voice(
    voice_id: String,
    runtime: State<'_, RuntimeState>,
    client: State<'_, BackendClient>,
) -> Result<Value, String> {
    backend_request(
        &runtime,
        &client,
        Method::POST,
        &format!("/voices/{voice_id}/warmup"),
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
    let response = send_with_retry(
        &client,
        Method::GET,
        &format!("{api_base}/generate/progress"),
        api_token.as_deref(),
        None,
    )
    .await?;
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

fn copy_dir_all(source: &Path, destination: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)?;

        if metadata.file_type().is_dir() {
            copy_dir_all(&source_path, &destination_path)?;
            continue;
        }

        if metadata.file_type().is_symlink() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;

                let target = fs::read_link(&source_path)?;
                if destination_path.exists() {
                    fs::remove_file(&destination_path)?;
                }
                symlink(target, &destination_path)?;
            }
            continue;
        }

        fs::copy(&source_path, &destination_path)?;
        fs::set_permissions(&destination_path, metadata.permissions())?;
    }

    Ok(())
}

fn needs_backend_refresh(
    source_dir: &Path,
    staged_dir: &Path,
) -> Result<bool, Box<dyn std::error::Error>> {
    let source_executable = source_dir.join("foundry-vox-backend");
    let staged_executable = staged_dir.join("foundry-vox-backend");

    if !staged_executable.exists() {
        return Ok(true);
    }

    let source_modified = fs::metadata(&source_executable)?.modified()?;
    let staged_modified = fs::metadata(&staged_executable)?.modified()?;
    if source_modified > staged_modified {
        return Ok(true);
    }

    let staged_metallib = staged_dir.join("_internal").join("mlx").join("lib").join("mlx.metallib");
    if !staged_metallib.exists() {
        return Ok(true);
    }

    Ok(false)
}

fn stage_backend_runtime(
    source_dir: &Path,
    app_data_dir: &Path,
    backend_name: &str,
) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let runtime_root = app_data_dir.join("runtime");
    let staged_dir = runtime_root.join(backend_name);
    fs::create_dir_all(&runtime_root)?;

    if needs_backend_refresh(source_dir, &staged_dir)? {
        if staged_dir.exists() {
            fs::remove_dir_all(&staged_dir)?;
        }
        copy_dir_all(source_dir, &staged_dir)?;
    }

    Ok(staged_dir)
}

fn spawn_backend(
    app: &tauri::App,
    api_port: u16,
    api_token: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();
    let app_data_dir = app_handle.path().app_local_data_dir()?;
    std::fs::create_dir_all(&app_data_dir)?;

    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    };
    let resource_dir = app_handle.path().resource_dir()?;
    let bundled_backend_name = format!("foundry-vox-backend-{arch}-apple-darwin");
    let backend_dir = [
        resource_dir.join("resources").join("backend").join(&bundled_backend_name),
        resource_dir.join("backend").join(&bundled_backend_name),
    ]
    .into_iter()
    .find(|path| path.exists())
    .ok_or_else(|| {
        format!(
            "Bundled backend resources not found under {}",
            resource_dir.display()
        )
    })?;
    let staged_backend_dir = stage_backend_runtime(&backend_dir, &app_data_dir, &bundled_backend_name)?;
    let backend_executable = staged_backend_dir.join("foundry-vox-backend");

    if !backend_executable.exists() {
        return Err(format!(
            "Bundled backend executable not found at {}",
            backend_executable.display()
        )
        .into());
    }

    let mut command = Command::new(&backend_executable);
    command
        .current_dir(&staged_backend_dir)
        .env("FOUNDRY_VOX_HOME", app_data_dir.to_string_lossy().to_string())
        .env("FOUNDRY_VOX_PORT", api_port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(token) = api_token {
        command.env("FOUNDRY_VOX_API_TOKEN", token);
    }

    let mut child = command.spawn()?;

    if let Some(stdout) = child.stdout.take() {
        let stdout_app = app_handle.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = stdout_app.emit("backend://stdout", line);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let stderr_app = app_handle.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = stderr_app.emit("backend://stderr", line);
            }
        });
    }

    tauri::async_runtime::spawn(async move {
        match child.wait() {
            Ok(status) => {
                let _ = app_handle.emit(
                    "backend://stderr",
                    format!("Foundry Vox backend exited with status {status}"),
                );
            }
            Err(error) => {
                let _ = app_handle.emit(
                    "backend://stderr",
                    format!("Failed to wait for Foundry Vox backend: {error}"),
                );
            }
        }
    });

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
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
            open_models_directory,
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
            backend_warmup_voice,
            start_progress_bridge,
            stop_progress_bridge
        ])
        .run(tauri::generate_context!())
        .expect("error while running Foundry Vox");
}
