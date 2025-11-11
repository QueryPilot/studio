use crate::ssh::rate_limiter::RateLimiter;
use crate::window_state::WindowStateManager;
use std::sync::Arc;

pub struct AppState {
    pub window_states: Arc<WindowStateManager>,
    pub ssh_test_rate_limiter: RateLimiter,
}
