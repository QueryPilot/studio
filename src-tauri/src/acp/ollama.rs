//! Ollama integration module
//!
//! Provides an HTTP-based AI client for Ollama, enabling local LLM inference
//! without requiring cloud services. Communicates via Ollama's REST API
//! instead of subprocess stdio used by other ACP agents.

use futures::StreamExt;
use tokio::sync::mpsc;

use super::discovery::ModelInfo;

/// Ollama chat message
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Response from GET /api/tags
#[derive(Debug, serde::Deserialize)]
struct TagsResponse {
    models: Vec<OllamaModel>,
}

/// Model entry from /api/tags
#[derive(Debug, serde::Deserialize)]
struct OllamaModel {
    name: String,
    // Other fields exist but we only need name
}

/// Single streaming response line from POST /api/chat
#[derive(Debug, serde::Deserialize)]
struct ChatStreamLine {
    message: Option<ChatStreamMessage>,
    done: bool,
}

/// Message within a streaming response line
#[derive(Debug, serde::Deserialize)]
struct ChatStreamMessage {
    content: String,
}

/// Events emitted by the Ollama chat stream
#[derive(Debug)]
pub enum OllamaEvent {
    /// A chunk of assistant message text
    Chunk(String),
    /// The stream has completed
    Done,
    /// An error occurred
    Error(String),
}

/// HTTP client for the Ollama API
pub struct OllamaClient {
    base_url: String,
    client: reqwest::Client,
}

impl OllamaClient {
    pub fn new(base_url: &str) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .unwrap_or_default();

        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client,
        }
    }

    /// Check if Ollama is running and reachable
    pub async fn is_available(&self) -> bool {
        self.client
            .get(format!("{}/api/tags", self.base_url))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    /// List available models from Ollama
    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        let resp = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Ollama returned status {}", resp.status()));
        }

        let tags: TagsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        Ok(tags
            .models
            .into_iter()
            .map(|m| {
                let display_name = format_model_display_name(&m.name);
                ModelInfo {
                    id: m.name.clone(),
                    name: display_name,
                    description: "Local model via Ollama".to_string(),
                }
            })
            .collect())
    }

    /// Send a chat message and stream the response via a channel
    pub async fn chat_stream(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        event_tx: mpsc::UnboundedSender<OllamaEvent>,
    ) -> Result<(), String> {
        let resp = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true
            }))
            .send()
            .await
            .map_err(|e| format!("Failed to send chat request to Ollama: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let _ = event_tx.send(OllamaEvent::Error(format!(
                "Ollama returned status {}: {}",
                status, body
            )));
            return Err(format!("Ollama returned status {}", status));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    let _ = event_tx.send(OllamaEvent::Error(format!("Stream error: {}", e)));
                    return Err(format!("Stream error: {}", e));
                }
            };

            // Append raw bytes to buffer
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process complete JSON lines from buffer
            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                match serde_json::from_str::<ChatStreamLine>(&line) {
                    Ok(parsed) => {
                        if let Some(msg) = parsed.message {
                            if !msg.content.is_empty() {
                                let _ = event_tx.send(OllamaEvent::Chunk(msg.content));
                            }
                        }
                        if parsed.done {
                            let _ = event_tx.send(OllamaEvent::Done);
                            return Ok(());
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to parse Ollama stream line: {} (line: {})",
                            e,
                            line
                        );
                    }
                }
            }
        }

        // Stream ended without a done message
        let _ = event_tx.send(OllamaEvent::Done);
        Ok(())
    }
}

/// Build a system prompt for SQL assistance with schema context
pub fn build_system_prompt(db_type: Option<&str>, context_json: Option<&str>) -> String {
    let mut prompt = String::from(
        "You are a SQL expert assistant inside Query Pilot, a database IDE. \
         Your primary job is to help users write and debug SQL queries.\n\n\
         Rules:\n\
         - Output SQL inside ```sql code blocks\n\
         - Be concise and direct\n\
         - If the user asks for a query, provide ONLY the SQL in a code block\n\
         - Use the schema context below to write accurate queries\n",
    );

    if let Some(db) = db_type {
        prompt.push_str(&format!("\nDatabase type: {}\n", db));
    }

    if let Some(ctx) = context_json {
        prompt.push_str(&format!(
            "\nDatabase schema context:\n```json\n{}\n```\n",
            ctx
        ));
    }

    prompt
}

/// Format an Ollama model name for display
/// e.g., "qwen2.5-coder:7b" -> "Qwen2.5 Coder 7B"
fn format_model_display_name(name: &str) -> String {
    // Split on ":" to separate model name from tag
    let parts: Vec<&str> = name.splitn(2, ':').collect();
    let base = parts[0];
    let tag = parts.get(1).copied().unwrap_or("");

    // Capitalize first letter of base name
    let display_base = {
        let mut chars = base.chars();
        match chars.next() {
            None => String::new(),
            Some(first) => {
                let rest: String = chars.collect();
                format!("{}{}", first.to_uppercase(), rest)
            }
        }
    };

    // Clean up dashes and format tag
    let display_base = display_base.replace('-', " ");
    if tag.is_empty() {
        display_base
    } else {
        format!("{} ({})", display_base, tag.to_uppercase())
    }
}

/// Check if Ollama is running at the given base URL.
/// Used by the discovery module.
pub async fn detect_ollama(base_url: &str) -> bool {
    let client = OllamaClient::new(base_url);
    client.is_available().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_model_display_name() {
        assert_eq!(
            format_model_display_name("qwen2.5-coder:7b"),
            "Qwen2.5 coder (7B)"
        );
        assert_eq!(
            format_model_display_name("llama3:latest"),
            "Llama3 (LATEST)"
        );
        assert_eq!(format_model_display_name("mistral"), "Mistral");
    }

    #[test]
    fn test_build_system_prompt() {
        let prompt = build_system_prompt(Some("PostgreSQL"), None);
        assert!(prompt.contains("PostgreSQL"));
        assert!(prompt.contains("SQL expert"));
    }
}
