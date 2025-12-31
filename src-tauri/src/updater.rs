use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;
use tokio::io::AsyncWriteExt;

// Token compiled into binary at build time
const GITHUB_TOKEN: Option<&str> = option_env!("GITHUB_RELEASE_TOKEN");

#[derive(Debug, Serialize, Deserialize)]
pub struct ReleaseInfo {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub download_url: String,
    pub signature: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields present in JSON but only `platforms` is accessed
struct UpdateManifest {
    version: String,
    notes: String,
    pub_date: String,
    platforms: std::collections::HashMap<String, PlatformInfo>,
}

#[derive(Debug, Deserialize)]
struct PlatformInfo {
    url: String,
    signature: Option<String>,
}

/// Check for updates from private GitHub repository
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<Option<ReleaseInfo>, String> {
    let token = GITHUB_TOKEN.ok_or("GitHub token not configured")?;
    let current_version = app.package_info().version.to_string();

    // Fetch latest release
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.github.com/repos/QueryPilot/studio-app/releases/latest")
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "QueryPilot")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("GitHub API error {}: {}", status, body));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v');

    // Compare versions
    if !is_newer_version(latest_version, &current_version) {
        return Ok(None);
    }

    // Try to get platform-specific info from latest.json
    let platform = get_platform_key();
    let mut download_url = String::new();
    let mut signature = None;

    // Find latest.json asset
    if let Some(manifest_asset) = release.assets.iter().find(|a| a.name == "latest.json") {
        if let Ok(manifest) =
            fetch_manifest(&client, token, &manifest_asset.browser_download_url).await
        {
            if let Some(platform_info) = manifest.platforms.get(&platform) {
                download_url = platform_info.url.clone();
                signature = platform_info.signature.clone();
            }
        }
    }

    // Fallback: find DMG directly
    if download_url.is_empty() {
        let asset_name = get_asset_name_for_platform(&platform);
        if let Some(asset) = release.assets.iter().find(|a| a.name == asset_name) {
            download_url = asset.browser_download_url.clone();
        }
    }

    if download_url.is_empty() {
        return Err(format!("No download available for platform: {}", platform));
    }

    Ok(Some(ReleaseInfo {
        version: latest_version.to_string(),
        notes: release.body.unwrap_or_default(),
        pub_date: release.published_at,
        download_url,
        signature,
    }))
}

/// Download update to temp directory
#[tauri::command]
pub async fn download_update(url: String) -> Result<PathBuf, String> {
    let token = GITHUB_TOKEN.ok_or("GitHub token not configured")?;

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/octet-stream")
        .header("User-Agent", "QueryPilot")
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    // Get filename from URL
    let filename = url.split('/').last().unwrap_or("update.dmg").to_string();

    // Save to temp directory
    let temp_dir = std::env::temp_dir().join("query-pilot-updates");
    fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let file_path = temp_dir.join(&filename);

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let mut file = fs::File::create(&file_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    file.write_all(&bytes)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    tracing::info!("Downloaded update to: {:?}", file_path);
    Ok(file_path)
}

/// Open the downloaded DMG/installer
#[tauri::command]
pub async fn install_update(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err("Update file not found".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        // Open DMG with default handler
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open DMG: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        // Run installer
        std::process::Command::new(&path)
            .spawn()
            .map_err(|e| format!("Failed to run installer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Make AppImage executable and run
        std::process::Command::new("chmod")
            .args(["+x", &file_path])
            .output()
            .map_err(|e| format!("Failed to make executable: {}", e))?;

        std::process::Command::new(&path)
            .spawn()
            .map_err(|e| format!("Failed to run AppImage: {}", e))?;
    }

    Ok(())
}

async fn fetch_manifest(
    client: &reqwest::Client,
    token: &str,
    url: &str,
) -> Result<UpdateManifest, String> {
    let response = client
        .get(url)
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/octet-stream")
        .header("User-Agent", "QueryPilot")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {}", e))?;

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse manifest: {}", e))
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> { v.split('.').filter_map(|s| s.parse().ok()).collect() };

    let latest_parts = parse(latest);
    let current_parts = parse(current);

    for i in 0..latest_parts.len().max(current_parts.len()) {
        let l = latest_parts.get(i).copied().unwrap_or(0);
        let c = current_parts.get(i).copied().unwrap_or(0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    false
}

fn get_platform_key() -> String {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "darwin-aarch64".to_string();

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "darwin-x86_64".to_string();

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "windows-x86_64".to_string();

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "linux-x86_64".to_string();

    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
    )))]
    return "unknown".to_string();
}

fn get_asset_name_for_platform(platform: &str) -> String {
    match platform {
        "darwin-aarch64" => "Query-Pilot_aarch64.dmg",
        "darwin-x86_64" => "Query-Pilot_x64.dmg",
        "windows-x86_64" => "Query-Pilot_x64-setup.exe",
        "linux-x86_64" => "Query-Pilot_amd64.AppImage",
        _ => "Query-Pilot_aarch64.dmg",
    }
    .to_string()
}
