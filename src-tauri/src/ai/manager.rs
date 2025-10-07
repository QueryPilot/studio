use std::sync::Arc;

use crate::ai::provider::{mock::MockProvider, AIProvider};
use crate::ai::session::SessionManager;

pub struct AIManager {
    provider: Arc<dyn AIProvider>,
    session_manager: Arc<SessionManager>,
}

impl AIManager {
    pub fn new() -> Self {
        Self {
            provider: Arc::new(MockProvider::default()),
            session_manager: Arc::new(SessionManager::new()),
        }
    }

    pub fn provider(&self) -> Arc<dyn AIProvider> {
        self.provider.clone()
    }

    pub fn session_manager(&self) -> Arc<SessionManager> {
        self.session_manager.clone()
    }
}
