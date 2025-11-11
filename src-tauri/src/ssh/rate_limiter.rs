use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub struct RateLimiter {
    attempts: Mutex<HashMap<String, Instant>>,
    cooldown: Duration,
}

impl RateLimiter {
    pub fn new(cooldown_secs: u64) -> Self {
        Self {
            attempts: Mutex::new(HashMap::new()),
            cooldown: Duration::from_secs(cooldown_secs),
        }
    }

    pub async fn check_rate_limit(&self, key: &str) -> bool {
        let mut attempts = self.attempts.lock().await;

        if let Some(&last_attempt) = attempts.get(key) {
            if last_attempt.elapsed() < self.cooldown {
                return false;
            }
        }

        attempts.insert(key.to_string(), Instant::now());
        true
    }
}
