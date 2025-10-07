use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AIMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub created_at: i64,
}

impl AIMessage {
    pub fn new(role: MessageRole, content: impl Into<String>) -> Self {
        let created_at = chrono::Utc::now().timestamp_millis();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role,
            content: content.into(),
            created_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChunkEvent {
    pub session_id: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct CompleteEvent {
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ErrorEvent {
    pub session_id: String,
    pub message: String,
}

#[derive(Clone, Debug)]
pub struct ChatRequest {
    pub prompt: String,
    pub history: Vec<AIMessage>,
}

impl ChatRequest {
    pub fn new(prompt: impl Into<String>, history: Vec<AIMessage>) -> Self {
        Self {
            prompt: prompt.into(),
            history,
        }
    }
}
