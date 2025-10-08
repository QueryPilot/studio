use std::sync::Arc;

use tauri::{async_runtime, Emitter, State, Window};

use crate::ai::manager::AIManager;
use crate::ai::provider::ProviderEvent;
use crate::ai::types::{
    AIMessage, ChatRequest, ChunkEvent, CompleteEvent, ErrorEvent, MessageRole, SessionSummary,
};

#[tauri::command]
pub async fn create_ai_session(
    title: Option<String>,
    manager: State<'_, Arc<AIManager>>,
) -> Result<SessionSummary, String> {
    Ok(manager.session_manager().create_session(title).await)
}

#[tauri::command]
pub async fn list_ai_sessions(
    manager: State<'_, Arc<AIManager>>,
) -> Result<Vec<SessionSummary>, String> {
    Ok(manager.session_manager().list_sessions().await)
}

#[tauri::command]
pub async fn get_ai_session_history(
    session_id: String,
    manager: State<'_, Arc<AIManager>>,
) -> Result<Vec<AIMessage>, String> {
    manager
        .session_manager()
        .get_history(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_ai_message_streaming(
    session_id: String,
    message: String,
    window: Window,
    manager: State<'_, Arc<AIManager>>,
) -> Result<(), String> {
    let session_manager = manager.session_manager();
    session_manager
        .ensure_session(&session_id)
        .await
        .map_err(|e| e.to_string())?;

    // Store the user message immediately
    let user_message = session_manager
        .add_message(&session_id, MessageRole::User, message.clone())
        .await
        .map_err(|e| e.to_string())?;

    let history = session_manager
        .get_history(&session_id)
        .await
        .map_err(|e| e.to_string())?;

    let provider = manager.provider();
    let request = ChatRequest::new(user_message.content.clone(), history.clone());
    let stream = provider
        .stream_chat(request)
        .await
        .map_err(|e| e.to_string())?;

    let session_id_clone = session_id.clone();
    let window_clone = window.clone();
    let session_manager_clone = session_manager.clone();

    async_runtime::spawn(async move {
        let mut receiver = stream;
        let mut full_response = String::new();

        while let Some(event) = receiver.recv().await {
            match event {
                ProviderEvent::Delta(chunk) => {
                    full_response.push_str(&chunk);
                    if let Err(err) = window_clone.emit(
                        "ai:chunk",
                        ChunkEvent {
                            session_id: session_id_clone.clone(),
                            content: chunk,
                        },
                    ) {
                        tracing::error!("Failed to emit chunk: {}", err);
                        break;
                    }
                }
                ProviderEvent::Finished => {
                    break;
                }
            }
        }

        if full_response.trim().is_empty() {
            let _ = window_clone.emit(
                "ai:error",
                ErrorEvent {
                    session_id: session_id_clone.clone(),
                    message: "Provider returned an empty response".to_string(),
                },
            );
            let _ = window_clone.emit(
                "ai:complete",
                CompleteEvent {
                    session_id: session_id_clone.clone(),
                },
            );
            return;
        }

        if let Err(err) = session_manager_clone
            .add_message(
                &session_id_clone,
                MessageRole::Assistant,
                full_response.clone(),
            )
            .await
        {
            tracing::error!("Failed to persist assistant message: {}", err);
        }

        if let Err(err) = window_clone.emit(
            "ai:complete",
            CompleteEvent {
                session_id: session_id_clone,
            },
        ) {
            tracing::error!("Failed to emit completion: {}", err);
        }
    });

    Ok(())
}
