use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveConnectionState {
    pub connection_id: String,
    pub connected_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub connection_id: String,
    pub window_labels: Vec<String>,
    pub window_count: usize,
}

pub struct WindowStateManager {
    // window_label -> connection info
    states: Mutex<HashMap<String, ActiveConnectionState>>,
    // connection_id -> set of window labels (for multiple windows per connection)
    connections: Mutex<HashMap<String, HashSet<String>>>,
}

impl WindowStateManager {
    pub fn new() -> Self {
        Self {
            states: Mutex::new(HashMap::new()),
            connections: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_active_connection(
        &self,
        window_label: String,
        connection_id: String,
    ) -> crate::error::Result<()> {
        let mut states = self.states.lock().map_err(|e| {
            crate::error::AppError::internal(&format!("Failed to lock window states: {}", e))
        })?;

        let mut connections = self.connections.lock().map_err(|e| {
            crate::error::AppError::internal(&format!("Failed to lock connections: {}", e))
        })?;

        states.insert(
            window_label.clone(),
            ActiveConnectionState {
                connection_id: connection_id.clone(),
                connected_at: chrono::Utc::now(),
            },
        );

        // Track connection -> windows mapping
        connections
            .entry(connection_id.clone())
            .or_insert_with(HashSet::new)
            .insert(window_label.clone());

        tracing::info!(
            "Window {} registered for connection {}",
            window_label,
            connection_id
        );

        Ok(())
    }

    pub fn register_window(
        &self,
        window_label: String,
        connection_id: String,
        app: &AppHandle,
    ) -> crate::error::Result<()> {
        self.set_active_connection(window_label.clone(), connection_id.clone())?;
        
        // Emit event to all windows
        let status = self.get_connection_status(&connection_id)?;
        let _ = app.emit("connection-window-opened", status);
        
        Ok(())
    }

    pub fn get_active_connection(&self, window_label: &str) -> Option<String> {
        self.states
            .lock()
            .ok()
            .and_then(|states| states.get(window_label).map(|s| s.connection_id.clone()))
    }

    pub fn remove_window(&self, window_label: &str) -> crate::error::Result<()> {
        let mut states = self.states.lock().map_err(|e| {
            crate::error::AppError::internal(&format!("Failed to lock window states: {}", e))
        })?;

        let mut connections = self.connections.lock().map_err(|e| {
            crate::error::AppError::internal(&format!("Failed to lock connections: {}", e))
        })?;

        // Get connection_id before removing
        let connection_id = states.get(window_label).map(|s| s.connection_id.clone());

        // Remove from states
        states.remove(window_label);

        // Remove from connections map
        if let Some(conn_id) = connection_id {
            if let Some(window_set) = connections.get_mut(&conn_id) {
                window_set.remove(window_label);
                if window_set.is_empty() {
                    connections.remove(&conn_id);
                }
            }

            tracing::info!(
                "Window {} unregistered from connection {}",
                window_label,
                conn_id
            );
        }

        Ok(())
    }

    pub fn unregister_window(
        &self,
        window_label: &str,
        app: &AppHandle,
    ) -> crate::error::Result<()> {
        // Get connection_id before removing
        let connection_id = self.get_active_connection(window_label);

        self.remove_window(window_label)?;

        // Emit event if we had a connection
        if let Some(conn_id) = connection_id {
            let status = self.get_connection_status(&conn_id)?;
            let _ = app.emit("connection-window-closed", status);
        }

        Ok(())
    }

    pub fn get_window_for_connection(&self, connection_id: &str) -> Option<String> {
        self.states.lock().ok().and_then(|states| {
            states
                .iter()
                .find(|(_, state)| state.connection_id == connection_id)
                .map(|(label, _)| label.clone())
        })
    }

    pub fn get_all_states(&self) -> crate::error::Result<HashMap<String, ActiveConnectionState>> {
        let states = self.states.lock().map_err(|e| {
            crate::error::AppError::internal(&format!("Failed to lock window states: {}", e))
        })?;

        Ok(states.clone())
    }

    pub fn clear_connection(&self, connection_id: &str) -> crate::error::Result<Vec<String>> {
        let mut states = self.states.lock().map_err(|e| {
            crate::error::AppError::internal(&format!("Failed to lock window states: {}", e))
        })?;

        let mut connections = self.connections.lock().map_err(|e| {
            crate::error::AppError::internal(&format!("Failed to lock connections: {}", e))
        })?;

        let affected_windows: Vec<String> = states
            .iter()
            .filter(|(_, state)| state.connection_id == connection_id)
            .map(|(label, _)| label.clone())
            .collect();

        for window in &affected_windows {
            states.remove(window);
        }

        // Remove from connections map
        connections.remove(connection_id);

        Ok(affected_windows)
    }

    /// Get all windows for a specific connection
    pub fn get_windows_for_connection(&self, connection_id: &str) -> Vec<String> {
        self.connections
            .lock()
            .ok()
            .and_then(|connections| {
                connections.get(connection_id).map(|set| set.iter().cloned().collect())
            })
            .unwrap_or_default()
    }

    /// Get connection status (windows count and labels)
    pub fn get_connection_status(&self, connection_id: &str) -> crate::error::Result<ConnectionStatus> {
        let window_labels = self.get_windows_for_connection(connection_id);
        Ok(ConnectionStatus {
            connection_id: connection_id.to_string(),
            window_count: window_labels.len(),
            window_labels,
        })
    }

    /// Get all connection statuses
    pub fn get_all_connection_statuses(&self) -> crate::error::Result<Vec<ConnectionStatus>> {
        let connections = self.connections.lock().map_err(|e| {
            crate::error::AppError::internal(&format!("Failed to lock connections: {}", e))
        })?;

        Ok(connections
            .keys()
            .filter_map(|connection_id| self.get_connection_status(connection_id).ok())
            .collect())
    }
}
