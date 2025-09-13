use std::sync::Arc;
use crate::window_state::WindowStateManager;

pub struct AppState {
    pub window_states: Arc<WindowStateManager>,
}