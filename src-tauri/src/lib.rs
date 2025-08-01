use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use tokio::fs;
use tokio::time::{sleep, Duration};
use base64::Engine;
use rusqlite::{Connection, params};

// Helper macro for database operations
macro_rules! db_blocking {
    ($db_path:expr, $operation:expr) => {
        tokio::task::spawn_blocking(move || {
            let conn = Connection::open($db_path)
                .map_err(|e| format!("Failed to open database: {}", e))?;
            $operation(conn)
        }).await.map_err(|e| format!("Task join error: {}", e))?
    };
}

#[derive(Debug, Serialize, Deserialize)]
struct CloudinaryResource {
    public_id: String,
    format: String,
    version: i64,
    resource_type: String,
    #[serde(rename = "type")]
    resource_kind: String,
    created_at: String,
    bytes: u64,
    width: Option<u32>,
    height: Option<u32>,
    secure_url: String,
    tags: Option<Vec<String>>,
    context: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CloudinaryResponse {
    resources: Vec<CloudinaryResource>,
    next_cursor: Option<String>,
    rate_limit_allowed: Option<u32>,
    rate_limit_remaining: Option<u32>,
    rate_limit_reset_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct DownloadProgress {
    total: usize,
    downloaded: usize,
    current_file: String,
    status: String,
}

struct AppState {
    download_progress: Mutex<DownloadProgress>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DatabasePhoto {
    id: Option<i64>,
    public_id: String,
    format: String,
    version: i64,
    resource_type: String,
    resource_kind: String,
    created_at: String,
    bytes: u64,
    width: Option<u32>,
    height: Option<u32>,
    secure_url: String,
    local_path: Option<String>,
    backup_date: Option<String>,
    checksum: Option<String>,
    is_downloaded: bool,
    download_failed: bool,
    failure_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupSession {
    id: Option<i64>,
    session_type: String,
    started_at: String,
    completed_at: Option<String>,
    cloudinary_cloud_name: String,
    total_photos: i64,
    successful_photos: i64,
    failed_photos: i64,
    total_bytes: i64,
    notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DownloadStatistics {
    total_photos: i64,
    downloaded_photos: i64,
    failed_photos: i64,
    total_bytes: i64,
    downloaded_bytes: i64,
    download_percentage: f64,
}

#[tauri::command]
async fn fetch_cloudinary_resources(
    cloud_name: String,
    api_key: String,
    api_secret: String,
    cursor: Option<String>,
) -> Result<CloudinaryResponse, String> {
    let client = Client::new();
    let mut url = format!("https://api.cloudinary.com/v1_1/{}/resources/image", cloud_name);
    
    if let Some(cursor) = cursor {
        url = format!("{}?next_cursor={}&max_results=100", url, cursor);
    } else {
        url = format!("{}?max_results=100", url);
    }
    
    // Create proper Authorization header instead of embedding credentials in URL
    let auth_string = format!("{}:{}", api_key, api_secret);
    let auth_header = format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(auth_string));

    sleep(Duration::from_millis(100)).await;

    let response = client.get(&url)
        .header("Authorization", auth_header)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("API request failed with status: {} - {}", status, error_text));
    }

    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response text: {}", e))?;
    
    let cloudinary_response: CloudinaryResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {} - Response body: {}", e, response_text))?;

    Ok(cloudinary_response)
}

#[tauri::command]
async fn download_resource(
    url: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let client = Client::new();
    
    // Create parent directory if it doesn't exist
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    let response = client.get(&url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let bytes = response.bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    fs::write(&file_path, bytes)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    {
        let mut progress = state.download_progress.lock().unwrap();
        progress.downloaded += 1;
        progress.current_file = file_path;
    }

    sleep(Duration::from_millis(200)).await;

    Ok(())
}

#[tauri::command]
async fn get_download_progress(state: State<'_, AppState>) -> Result<DownloadProgress, String> {
    let progress = state.download_progress.lock().unwrap();
    Ok(DownloadProgress {
        total: progress.total,
        downloaded: progress.downloaded,
        current_file: progress.current_file.clone(),
        status: progress.status.clone(),
    })
}

#[tauri::command]
async fn reset_download_progress(total: usize, state: State<'_, AppState>) -> Result<(), String> {
    let mut progress = state.download_progress.lock().unwrap();
    progress.total = total;
    progress.downloaded = 0;
    progress.current_file = String::new();
    progress.status = "starting".to_string();
    Ok(())
}

#[tauri::command]
async fn save_metadata(
    resources: Vec<CloudinaryResource>,
    file_path: String,
) -> Result<(), String> {
    let json_data = serde_json::to_string_pretty(&resources)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

    fs::write(&file_path, json_data)
        .await
        .map_err(|e| format!("Failed to write metadata file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn file_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
async fn get_file_size(path: String) -> Result<u64, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    Ok(metadata.len())
}

// Note: For now, we'll use a simpler approach with localStorage encryption
// Full Stronghold implementation requires more complex setup with password management
// This is a security improvement over plaintext storage

#[tauri::command]
async fn save_credentials_encrypted(
    cloud_name: String,
    api_key: String,
    api_secret: String,
) -> Result<String, String> {
    // For now, return the credentials as a JSON string
    // The frontend will handle basic encryption before storing
    let credentials = serde_json::json!({
        "cloud_name": cloud_name,
        "api_key": api_key,
        "api_secret": api_secret
    });
    
    Ok(credentials.to_string())
}

#[tauri::command]
async fn load_credentials_encrypted(encrypted_data: String) -> Result<Option<(String, String, String)>, String> {
    // Parse the JSON credentials
    let credentials: serde_json::Value = serde_json::from_str(&encrypted_data)
        .map_err(|e| format!("Failed to parse credentials: {}", e))?;
    
    let cloud_name = credentials["cloud_name"].as_str().unwrap_or("").to_string();
    let api_key = credentials["api_key"].as_str().unwrap_or("").to_string();
    let api_secret = credentials["api_secret"].as_str().unwrap_or("").to_string();
    
    if cloud_name.is_empty() || api_key.is_empty() || api_secret.is_empty() {
        return Ok(None);
    }
    
    Ok(Some((cloud_name, api_key, api_secret)))
}

// Database initialization
#[tauri::command]
async fn init_database(db_path: String) -> Result<(), String> {
    db_blocking!(db_path, |conn: Connection| {
        // Read and execute schema
        let schema = include_str!("../../schema.sql");
        conn.execute_batch(schema)
            .map_err(|e| format!("Failed to initialize database schema: {}", e))?;
        
        Ok(())
    })
}

// Create backup session
#[tauri::command]
async fn create_backup_session(db_path: String, session: BackupSession) -> Result<i64, String> {
    db_blocking!(db_path, |conn: Connection| {
        conn.execute(
            "INSERT INTO backup_sessions (session_type, started_at, cloudinary_cloud_name, 
             total_photos, successful_photos, failed_photos, total_bytes, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session.session_type,
                session.started_at,
                session.cloudinary_cloud_name,
                session.total_photos,
                session.successful_photos,
                session.failed_photos,
                session.total_bytes,
                session.notes
            ],
        ).map_err(|e| format!("Failed to create backup session: {}", e))?;
        
        Ok(conn.last_insert_rowid())
    })
}

// Update backup session
#[tauri::command]
async fn update_backup_session(db_path: String, session_id: i64, updates: serde_json::Value) -> Result<(), String> {
    db_blocking!(db_path, |conn: Connection| {
        if let Some(completed_at) = updates.get("completed_at").and_then(|v| v.as_str()) {
            conn.execute(
                "UPDATE backup_sessions SET completed_at = ?1 WHERE id = ?2",
                params![completed_at, session_id],
            ).map_err(|e| format!("Failed to update backup session: {}", e))?;
        }
        
        Ok(())
    })
}

// Removed unused insert_photo function - using batch insert instead

// Insert photo batch
#[tauri::command]
async fn insert_photo_batch(db_path: String, photos: Vec<DatabasePhoto>) -> Result<(), String> {
    db_blocking!(db_path, |conn: Connection| {
        let mut stmt = conn.prepare(
            "INSERT INTO photos (public_id, format, version, resource_type, resource_kind,
             created_at, bytes, width, height, secure_url, local_path, backup_date,
             checksum, is_downloaded, download_failed, failure_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;
        
        for photo in photos {
            stmt.execute(params![
                photo.public_id,
                photo.format,
                photo.version,
                photo.resource_type,
                photo.resource_kind,
                photo.created_at,
                photo.bytes as i64,
                photo.width.map(|w| w as i64),
                photo.height.map(|h| h as i64),
                photo.secure_url,
                photo.local_path,
                photo.backup_date,
                photo.checksum,
                photo.is_downloaded,
                photo.download_failed,
                photo.failure_reason
            ]).map_err(|e| format!("Failed to insert photo batch: {}", e))?;
        }
        
        Ok(())
    })
}

// Update photo download status
#[tauri::command]
async fn update_photo_download_status(
    db_path: String,
    public_id: String,
    is_downloaded: bool,
    local_path: Option<String>,
    failure_reason: Option<String>
) -> Result<(), String> {
    db_blocking!(db_path, |conn: Connection| {
        conn.execute(
            "UPDATE photos SET is_downloaded = ?1, download_failed = ?2, local_path = ?3, failure_reason = ?4
             WHERE public_id = ?5",
            params![
                is_downloaded,
                !is_downloaded,
                local_path,
                failure_reason,
                public_id
            ],
        ).map_err(|e| format!("Failed to update photo download status: {}", e))?;
        
        Ok(())
    })
}

// Additional database functions temporarily removed to eliminate warnings
// Will be re-added when needed for advanced features

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // .plugin(tauri_plugin_stronghold::init()) // TODO: Add proper stronghold setup
        .manage(AppState {
            download_progress: Mutex::new(DownloadProgress {
                total: 0,
                downloaded: 0,
                current_file: String::new(),
                status: "idle".to_string(),
            }),
        })
        .invoke_handler(tauri::generate_handler![
            fetch_cloudinary_resources,
            download_resource,
            get_download_progress,
            reset_download_progress,
            save_metadata,
            file_exists,
            get_file_size,
            save_credentials_encrypted,
            load_credentials_encrypted,
            init_database,
            create_backup_session,
            update_backup_session,
            insert_photo_batch,
            update_photo_download_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
