use crate::window_state::WindowStateManager;
use std::sync::Arc;
use tokio::process::Child;
use tokio::process::ChildStdin;
use tokio::sync::Mutex;

pub struct AppState {
    pub window_states: Arc<WindowStateManager>,
    // Handle to the current opencode login stdin (if any)
    pub ai_opencode_stdin: Arc<Mutex<Option<Arc<Mutex<ChildStdin>>>>>,
    // Handle to the opencode server process and url
    pub ai_opencode_server: Arc<Mutex<Option<Child>>>,
    pub ai_opencode_server_url: Arc<Mutex<Option<String>>>,
}
