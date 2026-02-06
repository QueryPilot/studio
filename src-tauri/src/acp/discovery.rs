//! Agent discovery module
//!
//! Detects installed AI agents by checking common locations in PATH.

use std::process::Command;

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
            name: "opencode-ai/tap/opencode",
            description: "OpenCode CLI",
            manager_type: "brew",
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
                    .map(|p| PackageInfo {
                        name: p.name.to_string(),
                        description: p.description.to_string(),
                        manager_type: p.manager_type.to_string(),
                        installed: shell_which(p.binary).is_some(),
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
    Command::new(path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}

/// Find a binary using the shell's `which` command
/// This ensures we use the current shell's PATH, including recent additions
fn shell_which(binary: &str) -> Option<std::path::PathBuf> {
    // Use login shell to get full PATH from user's profile
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

    Command::new(&shell)
        .args(["-l", "-c", &format!("which {}", binary)])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| std::path::PathBuf::from(s.trim()))
            } else {
                None
            }
        })
}

/// Fetch available models for an agent dynamically
/// Returns None if the agent doesn't support dynamic model listing or fetch fails
pub async fn fetch_agent_models(agent_id: &str) -> Option<Vec<ModelInfo>> {
    match agent_id {
        "opencode" => fetch_opencode_models(),
        "codex-acp" => fetch_codex_models(),
        "claude-code-acp" => fetch_claude_code_models().await,
        _ => None,
    }
}

/// Fetch models from OpenCode CLI using `opencode models` command
fn fetch_opencode_models() -> Option<Vec<ModelInfo>> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

    let output = Command::new(&shell)
        .args(["-l", "-c", "opencode models 2>/dev/null"])
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
// Claude Code: call Anthropic GET /v1/models (requires ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

async fn fetch_claude_code_models() -> Option<Vec<ModelInfo>> {
    let api_key = std::env::var("ANTHROPIC_API_KEY").ok().or_else(|| {
        // Fallback: read from ~/.anthropic/api_key if it exists
        dirs::home_dir()
            .map(|h| h.join(".anthropic").join("api_key"))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })?;

    tracing::info!("Fetching Claude models from Anthropic API");

    let client = reqwest::Client::new();
    let response = client
        .get("https://api.anthropic.com/v1/models")
        .query(&[("limit", "1000")])
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        tracing::warn!(
            "Anthropic models API returned status {}",
            response.status()
        );
        return None;
    }

    #[derive(serde::Deserialize)]
    struct AnthropicModelsResponse {
        data: Vec<AnthropicModel>,
    }

    #[derive(serde::Deserialize)]
    struct AnthropicModel {
        id: String,
        display_name: String,
    }

    let body: AnthropicModelsResponse = response.json().await.ok()?;

    let models: Vec<ModelInfo> = body
        .data
        .into_iter()
        // Keep only current-generation Claude models
        .filter(|m| {
            m.id.starts_with("claude-")
                && !m.id.starts_with("claude-2")
                && !m.id.starts_with("claude-3-")
                && !m.id.contains("claude-instant")
        })
        .map(|m| ModelInfo {
            name: m.display_name,
            description: format!("Anthropic {}", m.id),
            id: m.id,
        })
        .collect();

    if models.is_empty() {
        None
    } else {
        tracing::info!("Fetched {} Claude models from API", models.len());
        Some(models)
    }
}
