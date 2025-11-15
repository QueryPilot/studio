use crate::ssh::rate_limiter::RateLimiter;

pub struct AppState {
    pub ssh_test_rate_limiter: RateLimiter,
}
