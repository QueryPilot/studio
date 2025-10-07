use std::collections::HashMap;

use anyhow::{anyhow, Result};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::ai::types::{AIMessage, MessageRole, SessionSummary};

#[derive(Clone, Debug)]
struct Session {
    id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    messages: Vec<AIMessage>,
}

impl Session {
    fn new(id: String, title: String, timestamp: i64) -> Self {
        Self {
            id,
            title,
            created_at: timestamp,
            updated_at: timestamp,
            messages: Vec::new(),
        }
    }

    fn summary(&self) -> SessionSummary {
        SessionSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            message_count: self.messages.len(),
        }
    }
}

#[derive(Default)]
pub struct SessionManager {
    sessions: RwLock<HashMap<String, Session>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub async fn create_session(&self, title: Option<String>) -> SessionSummary {
        let mut sessions = self.sessions.write().await;
        let now = chrono::Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let base_title = title.unwrap_or_default().trim().to_owned();
        let title = if base_title.is_empty() {
            format!("Session {}", sessions.len() + 1)
        } else {
            base_title
        };

        let session = Session::new(id.clone(), title, now);
        let summary = session.summary();
        sessions.insert(id, session);
        summary
    }

    pub async fn list_sessions(&self) -> Vec<SessionSummary> {
        let sessions = self.sessions.read().await;
        let mut summaries: Vec<_> = sessions.values().map(Session::summary).collect();
        summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        summaries
    }

    pub async fn get_history(&self, session_id: &str) -> Result<Vec<AIMessage>> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Session not found"))?;
        Ok(session.messages.clone())
    }

    pub async fn add_message(
        &self,
        session_id: &str,
        role: MessageRole,
        content: impl Into<String>,
    ) -> Result<AIMessage> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow!("Session not found"))?;

        let message = AIMessage::new(role, content);
        session.updated_at = message.created_at;
        session.messages.push(message.clone());
        Ok(message)
    }

    pub async fn ensure_session(&self, session_id: &str) -> Result<()> {
        let sessions = self.sessions.read().await;
        if sessions.contains_key(session_id) {
            Ok(())
        } else {
            Err(anyhow!("Session not found"))
        }
    }
}
