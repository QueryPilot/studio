//! Agent discovery module
//!
//! Detects installed AI agents by checking common locations in PATH.

use std::process::Command;
use std::sync::OnceLock;

/// Cached user shell PATH, resolved once at first use.
///
/// macOS GUI apps (launched from Finder/Dock/Spotlight) inherit a minimal PATH
/// from launchd (typically `/usr/bin:/bin:/usr/sbin:/sbin`). Tools like nvm,
/// bun, homebrew, etc. add PATH entries in `.zshrc`/`.bashrc` which are only
/// sourced for interactive shells. We resolve the full PATH once at startup
/// using `-li` (login + interactive) and cache it for the process lifetime.
///
/// On Windows/Linux the process PATH is already fully populated, so we skip
/// the login-shell dance.
static USER_SHELL_PATH: OnceLock<Option<String>> = OnceLock::new();

/// Resolve the user's full shell PATH.
///
/// macOS: spawns a login+interactive shell (`-li`) to pick up PATH entries
/// from .zshrc/.bashrc that GUI apps don't inherit from launchd.
///
/// Windows/Linux: the process PATH is already correct, so we return it directly.
fn resolve_user_shell_path() -> Option<String> {
    // Windows & Linux: process PATH is already fully populated.
    #[cfg(not(target_os = "macos"))]
    {
        return None; // causes get_user_path() to fall back to std::env::var("PATH")
    }

    #[cfg(target_os = "macos")]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

        let delim = "__QP_PATH__";
        let cmd = format!("printf '{}%s{}' \"$PATH\"", delim, delim);

        let mut child = Command::new(&shell)
            .args(["-li", "-c", &cmd])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;

        let timeout = std::time::Duration::from_secs(5);
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if start.elapsed() > timeout {
                        tracing::warn!(
                            "Shell PATH resolution timed out after {:?}; killing shell process",
                            timeout
                        );
                        let _ = child.kill();
                        let _ = child.wait();
                        return None;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(_) => return None,
            }
        }

        let output = child.wait_with_output().ok()?;

        let stdout = String::from_utf8(output.stdout).ok()?;
        let start = stdout.find(delim)? + delim.len();
        let end = stdout[start..].find(delim)? + start;
        let path = stdout[start..end].to_string();
        if path.is_empty() {
            tracing::warn!("Resolved user shell PATH is empty; falling back to process PATH");
            None
        } else {
            tracing::info!(
                "Resolved user shell PATH ({} entries)",
                path.split(':').count()
            );
            Some(path)
        }
    }
}

/// Get the user's full PATH, falling back to the process PATH.
pub fn get_user_path() -> String {
    USER_SHELL_PATH
        .get_or_init(resolve_user_shell_path)
        .clone()
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
}

/// Run a command through the user's shell with the resolved PATH.
///
/// Unix: uses `$SHELL -c` with the cached user PATH so that binaries
/// installed via nvm, bun, homebrew, etc. are found.
/// Windows: uses `cmd.exe /C` which inherits the full process PATH.
pub fn run_in_user_shell(command: &str) -> std::io::Result<std::process::Output> {
    let user_path = get_user_path();

    #[cfg(windows)]
    {
        Command::new("cmd.exe")
            .args(["/C", command])
            .env("PATH", &user_path)
            .output()
    }

    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        Command::new(&shell)
            .args(["-c", command])
            .env("PATH", &user_path)
            .output()
    }
}

/// Information about a discovered AI agent
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub acp_args: Vec<String>,
    pub installed: bool,
    pub install_url: Option<String>,
    /// Package names to install (supports multiple packages)
    pub packages: Vec<PackageInfo>,
    /// Available models for this agent
    pub models: Vec<ModelInfo>,
}

/// Information about a model available for an agent
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// Information about a package to install
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub name: String,
    pub description: String,
    /// Package manager type: "npm" for npm/pnpm/yarn/bun, "brew" for homebrew
    pub manager_type: String,
    /// Whether this package is already installed
    pub installed: bool,
    /// Currently installed version (e.g. "0.13.2")
    pub installed_version: Option<String>,
    /// Latest available version from registry (e.g. "0.15.0")
    pub latest_version: Option<String>,
    /// True when installed_version < latest_version
    pub update_available: bool,
}

/// Model definition for static configuration
struct ModelDef {
    id: &'static str,
    name: &'static str,
    description: &'static str,
}

/// Package definition for static configuration
struct PackageDef {
    name: &'static str,
    description: &'static str,
    manager_type: &'static str,
    /// Binary name this package provides (to check if installed)
    binary: &'static str,
}

/// Definition of a known agent (static configuration)
struct AgentDefinition {
    binary: &'static str,
    name: &'static str,
    acp_args: &'static [&'static str],
    install_url: &'static str,
    packages: &'static [PackageDef],
    models: &'static [ModelDef],
}

/// Known agents and their ACP invocation args (MVP list; prefer registry later)
const KNOWN_AGENTS: &[AgentDefinition] = &[
    AgentDefinition {
        binary: "claude-code-acp",
        name: "Claude Code",
        acp_args: &[],
        install_url: "https://github.com/zed-industries/claude-code-acp",
        packages: &[
            PackageDef {
                name: "@anthropic-ai/claude-code",
                description: "Claude Code CLI",
                manager_type: "npm",
                binary: "claude",
            },
            PackageDef {
                name: "@zed-industries/claude-code-acp",
                description: "ACP Adapter",
                manager_type: "npm",
                binary: "claude-code-acp",
            },
        ],
        models: &[
            ModelDef {
                id: "opus",
                name: "Opus 4.5",
                description: "Most capable for complex work",
            },
            ModelDef {
                id: "sonnet",
                name: "Sonnet 4.5",
                description: "Best for everyday tasks",
            },
            ModelDef {
                id: "haiku",
                name: "Haiku 4.5",
                description: "Fastest for quick answers",
            },
        ],
    },
    AgentDefinition {
        binary: "opencode",
        name: "OpenCode",
        // Use --log-level ERROR to suppress benign "NotFoundError" warnings from session storage
        acp_args: &["acp", "--log-level", "ERROR"],
        install_url: "https://opencode.ai",
        packages: &[PackageDef {
            name: "opencode-ai",
            description: "OpenCode CLI",
            manager_type: "npm",
            binary: "opencode",
        }],
        models: &[
            ModelDef {
                id: "gpt-4o",
                name: "GPT-4o",
                description: "OpenAI's flagship model",
            },
            ModelDef {
                id: "claude-sonnet-4-20250514",
                name: "Claude Sonnet 4",
                description: "Anthropic's balanced model",
            },
        ],
    },
    AgentDefinition {
        binary: "codex-acp",
        name: "Codex",
        acp_args: &[],
        install_url: "https://github.com/zed-industries/codex-acp",
        packages: &[
            PackageDef {
                name: "@openai/codex",
                description: "Codex CLI",
                manager_type: "npm",
                binary: "codex",
            },
            PackageDef {
                name: "@zed-industries/codex-acp",
                description: "ACP Adapter",
                manager_type: "npm",
                binary: "codex-acp",
            },
        ],
        models: &[
            ModelDef {
                id: "gpt-5.2-codex",
                name: "GPT-5.2 Codex",
                description: "Latest frontier agentic coding model",
            },
            ModelDef {
                id: "gpt-5.2",
                name: "GPT-5.2",
                description: "Latest frontier model for knowledge & reasoning",
            },
            ModelDef {
                id: "gpt-5.1-codex-max",
                name: "GPT-5.1 Codex Max",
                description: "Flagship for deep and fast reasoning",
            },
            ModelDef {
                id: "gpt-5.1-codex-mini",
                name: "GPT-5.1 Codex Mini",
                description: "Cheaper, faster, but less capable",
            },
        ],
    },
];

/// Discover all known AI agents and their installation status
pub fn discover_agents() -> Vec<AgentInfo> {
    KNOWN_AGENTS
        .iter()
        .map(|def| {
            let found = shell_which(def.binary);
            let installed = found.is_some();
            let path = found.as_ref().map(|p| p.to_string_lossy().to_string());
            let version = found.as_ref().and_then(|p| get_agent_version(p));

            AgentInfo {
                id: def.binary.to_string(),
                name: def.name.to_string(),
                path,
                version,
                acp_args: def.acp_args.iter().map(|s| s.to_string()).collect(),
                installed,
                install_url: Some(def.install_url.to_string()),
                packages: def
                    .packages
                    .iter()
                    .map(|p| {
                        let bin_path = shell_which(p.binary);
                        let installed = bin_path.is_some();
                        let installed_version = bin_path
                            .as_ref()
                            .and_then(|path| get_installed_package_version(path));
                        PackageInfo {
                            name: p.name.to_string(),
                            description: p.description.to_string(),
                            manager_type: p.manager_type.to_string(),
                            installed,
                            installed_version,
                            latest_version: None, // populated by check_updates
                            update_available: false, // populated by check_updates
                        }
                    })
                    .collect(),
                models: def
                    .models
                    .iter()
                    .map(|m| ModelInfo {
                        id: m.id.to_string(),
                        name: m.name.to_string(),
                        description: m.description.to_string(),
                    })
                    .collect(),
            }
        })
        .collect()
}

/// Try to get the version of an agent by running --version
fn get_agent_version(path: &std::path::Path) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}

/// Public wrapper for shell_which (used by commands module)
pub fn shell_which_public(binary: &str) -> Option<std::path::PathBuf> {
    shell_which(binary)
}

/// Find a binary by searching the user's full shell PATH.
///
/// Instead of spawning a subshell for every lookup (expensive with `-li`),
/// we search the cached PATH directories directly. Uses `std::env::split_paths`
/// for cross-platform PATH splitting (`:` on Unix, `;` on Windows).
///
/// On Windows, also probes common executable extensions (.exe, .cmd, .bat, .ps1)
/// when the bare name isn't found, matching `where.exe` behavior.
fn shell_which(binary: &str) -> Option<std::path::PathBuf> {
    let user_path = get_user_path();
    let path_os = std::ffi::OsString::from(&user_path);
    let dirs: Vec<std::path::PathBuf> = std::env::split_paths(&path_os).collect();
    let has_ext = std::path::Path::new(binary).extension().is_some();

    for dir in &dirs {
        // Windows: always try .cmd/.exe/.bat first when the binary has no extension.
        // npm installs both an extensionless Unix shell script AND a .cmd wrapper;
        // executing the extensionless script directly fails with error 193.
        #[cfg(windows)]
        {
            if !has_ext {
                for ext in &["cmd", "exe", "bat", "ps1"] {
                    let with_ext = dir.join(format!("{}.{}", binary, ext));
                    if with_ext.is_file() {
                        return Some(with_ext);
                    }
                }
            }
        }

        let candidate = dir.join(binary);
        if candidate.is_file() && is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// Check if a file has any executable permission bit set.
#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// On Windows any existing file is considered executable.
#[cfg(not(unix))]
fn is_executable(path: &std::path::Path) -> bool {
    path.is_file()
}

/// Get the installed version of an npm package by resolving the binary's symlink
/// to find its package.json.
///
/// On Windows, npm globals use `.cmd` wrapper scripts instead of symlinks.
/// The `.cmd` files contain a reference to the `node_modules` directory,
/// so we also check the sibling `node_modules/<pkg>/package.json` path.
fn get_installed_package_version(bin_path: &std::path::Path) -> Option<String> {
    // Try symlink resolution first (works on Unix and some Windows setups)
    let resolved = std::fs::read_link(bin_path)
        .ok()
        .map(|target| {
            if target.is_relative() {
                bin_path.parent().unwrap_or(bin_path).join(&target)
            } else {
                target
            }
        })
        .unwrap_or_else(|| bin_path.to_path_buf());

    // Walk up from the resolved path looking for package.json
    let mut dir = resolved.parent();
    for _ in 0..6 {
        let d = dir?;
        let pkg_json = d.join("package.json");
        if pkg_json.exists() {
            let content = std::fs::read_to_string(&pkg_json).ok()?;
            let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
            return parsed.get("version")?.as_str().map(|s| s.to_string());
        }
        dir = d.parent();
    }

    // Windows fallback: npm globals live in <prefix>/node_modules/<pkg>/package.json
    // where the .cmd wrapper sits in <prefix>/.
    #[cfg(windows)]
    {
        if let Some(bin_dir) = bin_path.parent() {
            let stem = bin_path.file_stem()?.to_string_lossy();
            let node_modules = bin_dir.join("node_modules");

            // Try exact name, then @-scoped patterns (e.g. @anthropic-ai/claude-code)
            let pkg_json = node_modules.join(stem.as_ref()).join("package.json");
            if pkg_json.exists() {
                let content = std::fs::read_to_string(&pkg_json).ok()?;
                let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
                return parsed.get("version")?.as_str().map(|s| s.to_string());
            }

            // Scan scoped packages (@scope/pkg) in node_modules
            if let Ok(entries) = std::fs::read_dir(&node_modules) {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if name_str.starts_with('@') {
                        if let Ok(scoped) = std::fs::read_dir(entry.path()) {
                            for sub in scoped.flatten() {
                                let sub_pkg = sub.path().join("package.json");
                                if sub_pkg.exists() {
                                    let content =
                                        std::fs::read_to_string(&sub_pkg).ok()?;
                                    let parsed: serde_json::Value =
                                        serde_json::from_str(&content).ok()?;
                                    if let Some(bin_field) = parsed.get("bin") {
                                        let has_binary = match bin_field {
                                            serde_json::Value::String(_) => {
                                                sub.file_name().to_string_lossy()
                                                    == stem.as_ref()
                                            }
                                            serde_json::Value::Object(map) => {
                                                map.contains_key(stem.as_ref())
                                            }
                                            _ => false,
                                        };
                                        if has_binary {
                                            return parsed.get("version")?.as_str().map(
                                                |s| s.to_string(),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Get the latest version of a package from the npm registry.
fn get_latest_npm_version(package_name: &str) -> Option<String> {
    let npm_bin = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let output = Command::new(npm_bin)
        .args(["view", package_name, "version"])
        .env("PATH", get_user_path())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let version = String::from_utf8(output.stdout).ok()?;
    let version = version.trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

/// Get the latest version of a brew package.
/// Returns None on Windows where brew is not available.
fn get_latest_brew_version(package_name: &str) -> Option<String> {
    #[cfg(windows)]
    {
        let _ = package_name;
        return None;
    }

    #[cfg(not(windows))]
    {
        let output = Command::new("brew")
            .args(["info", "--json=v1", package_name])
            .env("PATH", get_user_path())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8(output.stdout).ok()?;
        let parsed: serde_json::Value = serde_json::from_str(&stdout).ok()?;
        parsed
            .as_array()?
            .first()?
            .get("versions")?
            .get("stable")?
            .as_str()
            .map(|s| s.to_string())
    }
}

/// Detect which npm-compatible package manager installed a binary.
/// Returns "bun", "pnpm", "yarn", or "npm" (default).
/// Handles both forward-slash (Unix) and backslash (Windows) path separators.
pub fn detect_package_manager(bin_path: &std::path::Path) -> String {
    let path_str = bin_path.to_string_lossy();
    let has = |pattern: &str| {
        path_str.contains(&format!(".{}/", pattern))
            || path_str.contains(&format!("/{}/", pattern))
            || path_str.contains(&format!(".{}\\", pattern))
            || path_str.contains(&format!("\\{}\\", pattern))
    };
    if has("bun") {
        "bun".to_string()
    } else if has("pnpm") {
        "pnpm".to_string()
    } else if has("yarn") {
        "yarn".to_string()
    } else {
        "npm".to_string()
    }
}

/// Check for updates across all known agents' packages.
/// Returns agents whose packages have updates available.
pub fn check_package_updates() -> Vec<AgentInfo> {
    let mut agents = discover_agents();

    for agent in &mut agents {
        for pkg in &mut agent.packages {
            if !pkg.installed {
                continue;
            }

            let latest = match pkg.manager_type.as_str() {
                "brew" => get_latest_brew_version(&pkg.name),
                _ => get_latest_npm_version(&pkg.name),
            };

            if let Some(ref latest_ver) = latest {
                if let Some(ref installed_ver) = pkg.installed_version {
                    pkg.update_available = installed_ver != latest_ver;
                }
            }
            pkg.latest_version = latest;
        }
    }

    // Only return agents that have at least one updatable package
    agents
        .into_iter()
        .filter(|a| a.packages.iter().any(|p| p.update_available))
        .collect()
}

/// Fetch available models for an agent dynamically
/// Returns None if the agent doesn't support dynamic model listing or fetch fails
pub fn fetch_agent_models(agent_id: &str) -> Option<Vec<ModelInfo>> {
    match agent_id {
        "opencode" => fetch_opencode_models(),
        "codex-acp" => fetch_codex_models(),
        "claude-code-acp" => fetch_claude_code_models(),
        _ => None,
    }
}

/// Fetch models from OpenCode CLI using `opencode models` command
fn fetch_opencode_models() -> Option<Vec<ModelInfo>> {
    let opencode_path = shell_which("opencode")?;
    let output = Command::new(opencode_path)
        .arg("models")
        .env("PATH", get_user_path())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let models = parse_opencode_models_output(&stdout);

    if models.is_empty() {
        None
    } else {
        Some(models)
    }
}

/// Parse the output of `opencode models` command
/// Expected format: lines containing "provider/model" entries
fn parse_opencode_models_output(output: &str) -> Vec<ModelInfo> {
    let mut models = Vec::new();

    for line in output.lines() {
        let line = line.trim();

        // Skip empty lines, headers, and separator lines
        if line.is_empty() || line.starts_with("─") || line.starts_with("Provider") {
            continue;
        }

        // Try to parse "provider/model" format
        if let Some((provider, model)) = line.split_once('/') {
            let provider = provider.trim();
            let model = model.trim();

            // Skip if either part is empty
            if provider.is_empty() || model.is_empty() {
                continue;
            }

            let id = format!("{}/{}", provider, model);
            let name = format_model_name(model);
            let description = format!("{} via {}", name, format_provider_name(provider));

            models.push(ModelInfo {
                id,
                name,
                description,
            });
        }
    }

    models
}

/// Format a model ID into a display name
fn format_model_name(model_id: &str) -> String {
    // Common model name transformations
    model_id
        .replace("-", " ")
        .replace("_", " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().chain(chars).collect(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Format a provider ID into a display name
fn format_provider_name(provider_id: &str) -> String {
    match provider_id {
        "openai" => "OpenAI".to_string(),
        "anthropic" => "Anthropic".to_string(),
        "google" => "Google".to_string(),
        "groq" => "Groq".to_string(),
        "together" => "Together AI".to_string(),
        "fireworks" => "Fireworks".to_string(),
        "deepseek" => "DeepSeek".to_string(),
        "xai" => "xAI".to_string(),
        "ollama" => "Ollama".to_string(),
        _ => format_model_name(provider_id),
    }
}

// ---------------------------------------------------------------------------
// Codex: read ~/.codex/models_cache.json (populated by the Codex CLI)
// ---------------------------------------------------------------------------

fn fetch_codex_models() -> Option<Vec<ModelInfo>> {
    let home = dirs::home_dir()?;
    let cache_path = home.join(".codex").join("models_cache.json");
    let content = std::fs::read_to_string(&cache_path).ok()?;

    #[derive(serde::Deserialize)]
    struct CodexModelsCache {
        models: Vec<CodexModel>,
    }

    #[derive(serde::Deserialize)]
    struct CodexModel {
        slug: String,
        display_name: String,
        description: String,
        visibility: String,
        #[allow(dead_code)]
        priority: u32,
    }

    let cache: CodexModelsCache = serde_json::from_str(&content).ok()?;

    let models: Vec<ModelInfo> = cache
        .models
        .into_iter()
        .filter(|m| m.visibility == "list")
        .map(|m| ModelInfo {
            id: m.slug,
            name: m.display_name,
            description: m.description,
        })
        .collect();

    if models.is_empty() {
        None
    } else {
        tracing::info!("Fetched {} Codex models from cache", models.len());
        Some(models)
    }
}

// ---------------------------------------------------------------------------
// Claude Code: extract the alias→model mapping from the `claude` binary.
//
// The compiled binary embeds a JS object like:
//   {opus:"claude-opus-4-6",sonnet:"claude-sonnet-4-5-20250929",haiku:"claude-haiku-4-5-20251001"}
//
// We read the binary and extract printable ASCII strings in pure Rust
// (cross-platform replacement for `strings | grep`), then regex-match
// the model aliases.
// ---------------------------------------------------------------------------

fn fetch_claude_code_models() -> Option<Vec<ModelInfo>> {
    let claude_path = shell_which("claude")?;
    let resolved = std::fs::canonicalize(&claude_path).unwrap_or(claude_path);

    // Read the binary and scan for the model alias pattern in printable strings.
    // This replaces the Unix-only `strings | grep` pipeline with pure Rust so it
    // works on Windows and Linux too.
    let data = std::fs::read(&resolved).ok()?;
    let text = extract_printable_strings(&data);

    let re = regex::Regex::new(
        r#"\{opus:"(claude-[^"]+)",sonnet:"(claude-[^"]+)",haiku:"(claude-[^"]+)"\}"#,
    )
    .ok()?;

    let caps = re.captures(&text)?;
    let opus_id = caps.get(1)?.as_str();
    let sonnet_id = caps.get(2)?.as_str();
    let haiku_id = caps.get(3)?.as_str();

    let models = vec![
        ModelInfo {
            id: "opus".to_string(),
            name: "Opus".to_string(),
            description: format!(
                "{} · Most capable for complex work",
                format_claude_version(opus_id)
            ),
        },
        ModelInfo {
            id: "sonnet".to_string(),
            name: "Sonnet".to_string(),
            description: format!(
                "{} · Best for everyday tasks",
                format_claude_version(sonnet_id)
            ),
        },
        ModelInfo {
            id: "haiku".to_string(),
            name: "Haiku".to_string(),
            description: format!(
                "{} · Fastest for quick answers",
                format_claude_version(haiku_id)
            ),
        },
    ];

    tracing::info!("Extracted Claude Code model aliases from binary");
    Some(models)
}

/// Pure-Rust replacement for the Unix `strings` command.
/// Extracts runs of printable ASCII characters (4+ bytes) from a binary buffer,
/// joined by spaces. This is enough to find embedded JSON/JS model aliases.
fn extract_printable_strings(data: &[u8]) -> String {
    const MIN_LEN: usize = 4;
    let mut result = String::new();
    let mut current = String::new();

    for &byte in data {
        if byte >= 0x20 && byte <= 0x7e {
            current.push(byte as char);
        } else {
            if current.len() >= MIN_LEN {
                if !result.is_empty() {
                    result.push(' ');
                }
                result.push_str(&current);
            }
            current.clear();
        }
    }
    if current.len() >= MIN_LEN {
        if !result.is_empty() {
            result.push(' ');
        }
        result.push_str(&current);
    }
    result
}

/// "claude-opus-4-6" → "Claude Opus 4.6"
fn format_claude_version(model_id: &str) -> String {
    let s = model_id.strip_prefix("claude-").unwrap_or(model_id);

    // Strip the date suffix (e.g. -20250929)
    let base = regex::Regex::new(r"-\d{8}$")
        .ok()
        .map(|re| re.replace(s, "").to_string())
        .unwrap_or_else(|| s.to_string());

    // "opus-4-6" → "Opus 4.6"
    let parts: Vec<&str> = base.splitn(2, '-').collect();
    if parts.len() == 2 {
        let family = {
            let mut c = parts[0].chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().chain(c).collect(),
            }
        };
        let version = parts[1].replace('-', ".");
        format!("Claude {} {}", family, version)
    } else {
        format!("Claude {}", format_model_name(&base))
    }
}
