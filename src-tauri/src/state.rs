use crate::window_state::WindowStateManager;
use std::sync::Arc;

pub struct AppState {
    pub window_states: Arc<WindowStateManager>,
}
