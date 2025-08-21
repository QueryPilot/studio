use tauri::State;
use crate::database::ConnectionRegistry;
use crate::error::AppError;

#[tauri::command]
pub async fn test_connection(
    connection_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<bool, AppError> {
    println!("[test_connection] Testing connection: {}", connection_id);
    
    let connection = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.clone()))?;
    
    match connection.adapter.ping().await {
        Ok(duration) => {
            println!("[test_connection] Connection {} healthy, RTT: {:?}", connection_id, duration);
            Ok(true)
        }
        Err(e) => {
            println!("[test_connection] Connection {} test failed: {}", connection_id, e);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn get_connection_health(
    connection_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> Result<serde_json::Value, AppError> {
    let connection = registry.get(&connection_id).await
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.clone()))?;
    
    match connection.adapter.ping().await {
        Ok(duration) => {
            let rtt_ms = duration.as_millis() as u32;
            let status = if rtt_ms <= 150 {
                "ready"
            } else if rtt_ms <= 1000 {
                "degraded"
            } else {
                "degraded"
            };
            
            Ok(serde_json::json!({
                "connectionId": connection_id,
                "status": status,
                "rttMs": rtt_ms,
                "healthy": true,
            }))
        }
        Err(e) => {
            Ok(serde_json::json!({
                "connectionId": connection_id,
                "status": "error",
                "healthy": false,
                "error": e.to_string(),
            }))
        }
    }
}