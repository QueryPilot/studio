use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveConnectionState {
    pub connection_id: String,
    pub connected_at: chrono::DateTime<chrono::Utc>,
}

pub struct WindowStateManager {
    states: Mutex<HashMap<String, ActiveConnectionState>>,
}

impl WindowStateManager {
    pub fn new() -> Self {
        Self {
            states: Mutex::new(HashMap::new()),
        }
    }
    
    pub fn set_active_connection(&self, window_label: String, connection_id: String) -> crate::error::Result<()> {
        let mut states = self.states.lock()
            .map_err(|e| crate::error::AppError::internal(&format!("Failed to lock window states: {}", e)))?;
        
        states.insert(
            window_label,
            ActiveConnectionState {
                connection_id,
                connected_at: chrono::Utc::now(),
            },
        );
        
        Ok(())
    }
    
    pub fn get_active_connection(&self, window_label: &str) -> Option<String> {
        self.states.lock().ok()
            .and_then(|states| states.get(window_label).map(|s| s.connection_id.clone()))
    }
    
    pub fn remove_window(&self, window_label: &str) -> crate::error::Result<()> {
        let mut states = self.states.lock()
            .map_err(|e| crate::error::AppError::internal(&format!("Failed to lock window states: {}", e)))?;
        
        states.remove(window_label);
        Ok(())
    }
    
    pub fn get_window_for_connection(&self, connection_id: &str) -> Option<String> {
        self.states.lock().ok()
            .and_then(|states| {
                states.iter()
                    .find(|(_, state)| state.connection_id == connection_id)
                    .map(|(label, _)| label.clone())
            })
    }
    
    pub fn get_all_states(&self) -> crate::error::Result<HashMap<String, ActiveConnectionState>> {
        let states = self.states.lock()
            .map_err(|e| crate::error::AppError::internal(&format!("Failed to lock window states: {}", e)))?;
        
        Ok(states.clone())
    }
    
    pub fn clear_connection(&self, connection_id: &str) -> crate::error::Result<Vec<String>> {
        let mut states = self.states.lock()
            .map_err(|e| crate::error::AppError::internal(&format!("Failed to lock window states: {}", e)))?;
        
        let affected_windows: Vec<String> = states
            .iter()
            .filter(|(_, state)| state.connection_id == connection_id)
            .map(|(label, _)| label.clone())
            .collect();
        
        for window in &affected_windows {
            states.remove(window);
        }
        
        Ok(affected_windows)
    }
}