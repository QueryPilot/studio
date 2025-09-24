use std::sync::Arc;
use crate::window_state::WindowStateManager;
use tokio::sync::Mutex;
use tokio::process::ChildStdin;
use tokio::process::Child;

pub struct AppState {
    pub window_states: Arc<WindowStateManager>,
    // Handle to the current opencode login stdin (if any)
    pub ai_opencode_stdin: Arc<Mutex<Option<Arc<Mutex<ChildStdin>>>>>,
    // Handle to the opencode server process and url
    pub ai_opencode_server: Arc<Mutex<Option<Child>>>,
    pub ai_opencode_server_url: Arc<Mutex<Option<String>>>,
}
