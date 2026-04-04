///! Sentry integration for crash reporting and error tracking
///!
///! This module provides conditional Sentry initialization based on:
///! 1. Feature flag compilation (`telemetry` feature must be enabled)
///! 2. Runtime environment (never in debug builds)
///! 3. User preference (must opt-in via preferences)

#[cfg(feature = "telemetry")]
use sentry::{ClientInitGuard, ClientOptions};
#[cfg(feature = "telemetry")]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

#[cfg(feature = "telemetry")]
static SENTRY_GUARD: OnceLock<Mutex<Option<ClientInitGuard>>> = OnceLock::new();

#[cfg(feature = "telemetry")]
static SENTRY_ENABLED: AtomicBool = AtomicBool::new(false);

/// Initialize Sentry for error tracking
///
/// Creates the Sentry client if a DSN was provided at compile time.
/// The guard is stored statically to keep Sentry active for the lifetime of the app.
/// Uses a global flag to control whether events are actually sent (opt-in via user preferences).
/// Call `set_sentry_enabled(true/false)` to toggle event sending at runtime.
#[cfg(feature = "telemetry")]
pub fn initialize_sentry(sentry_enabled: bool, app_version: &str) -> Option<ClientInitGuard> {
    // Never initialize in debug builds
    if cfg!(debug_assertions) {
        tracing::info!("[Sentry] Skipping initialization (debug build)");
        return None;
    }

    // Update the global enabled flag
    SENTRY_ENABLED.store(sentry_enabled, Ordering::Relaxed);

    // Get or create the global guard storage
    let guard_mutex = SENTRY_GUARD.get_or_init(|| Mutex::new(None));

    // Check if already initialized
    if let Ok(guard) = guard_mutex.lock() {
        if guard.is_some() {
            tracing::info!(
                "[Sentry] Already initialized, updated enabled flag to: {}",
                sentry_enabled
            );
            return None;
        }
    }

    // Get DSN embedded at compile time (set SENTRY_DSN env var during `cargo build`)
    let dsn = match option_env!("SENTRY_DSN") {
        Some(dsn) if !dsn.is_empty() => dsn,
        _ => {
            tracing::warn!("[Sentry] SENTRY_DSN not compiled in (set env var at build time)");
            return None;
        }
    };

    // Get OS and architecture info
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    tracing::info!(
        "[Sentry] Initializing (version: {}, os: {}, arch: {})",
        app_version,
        os,
        arch
    );

    let guard = sentry::init((
        dsn,
        ClientOptions {
            release: Some(format!("query-pilot@{}", app_version).into()),
            environment: Some("production".into()),
            sample_rate: 1.0,        // Capture 100% of errors
            traces_sample_rate: 0.1, // Capture 10% of performance traces
            before_send: Some(Arc::new(|mut event| {
                // Check if user has enabled Sentry
                if !SENTRY_ENABLED.load(Ordering::Relaxed) {
                    return None; // Drop the event
                }

                // Strip sensitive data before sending
                sanitize_event(&mut event);
                Some(event)
            })),
            ..Default::default()
        },
    ));

    // Set tags for filtering in Sentry
    sentry::configure_scope(|scope| {
        scope.set_tag("component", "backend");
        scope.set_tag("platform", "rust");
        scope.set_tag("os", os);
        scope.set_tag("arch", arch);
    });

    tracing::info!("[Sentry] Initialized successfully");

    // Store the guard globally to keep it alive
    if let Ok(mut stored_guard) = guard_mutex.lock() {
        *stored_guard = Some(guard);
    }

    None // We store the guard globally, so return None
}

/// Update the Sentry enabled flag at runtime (e.g., when user changes preferences)
#[cfg(feature = "telemetry")]
pub fn set_sentry_enabled(enabled: bool) {
    SENTRY_ENABLED.store(enabled, Ordering::Relaxed);
    tracing::info!("[Sentry] Event sending {}", if enabled { "enabled" } else { "disabled" });
}

/// No-op version when telemetry feature is disabled
#[cfg(not(feature = "telemetry"))]
pub fn initialize_sentry(_sentry_enabled: bool, _app_version: &str) -> Option<()> {
    tracing::info!("[Sentry] Telemetry feature not enabled, skipping initialization");
    None
}

/// No-op version when telemetry feature is disabled
#[cfg(not(feature = "telemetry"))]
pub fn set_sentry_enabled(_enabled: bool) {}

/// Sanitize event data to remove sensitive information
#[cfg(feature = "telemetry")]
fn sanitize_event(event: &mut sentry::protocol::Event<'static>) {
    // Remove request data (might contain SQL queries or credentials)
    if let Some(request) = &mut event.request {
        request.data = None;
        request.env.clear();
        request.headers.clear();
    }

    // Sanitize breadcrumbs
    event.breadcrumbs.values.retain_mut(|breadcrumb| {
        // Remove breadcrumbs that might contain sensitive info
        if let Some(message) = &breadcrumb.message {
            if message.contains("password")
                || message.contains("token")
                || message.contains("secret")
                || message.to_lowercase().contains("select")
                || message.to_lowercase().contains("insert")
                || message.to_lowercase().contains("update")
                || message.to_lowercase().contains("delete")
            {
                breadcrumb.message = Some("[REDACTED - sensitive data]".to_string());
            }
        }

        // Clear data field
        breadcrumb.data.clear();
        true
    });

    // Sanitize extra data
    event.extra.retain(|k, v| {
        if k.to_lowercase().contains("password")
            || k.to_lowercase().contains("token")
            || k.to_lowercase().contains("secret")
            || k.to_lowercase().contains("key")
            || k.to_lowercase().contains("credential")
        {
            *v = "[REDACTED]".into();
        }
        true
    });
}

/// Capture an exception with context
#[cfg(feature = "telemetry")]
pub fn capture_error(error: &dyn std::error::Error, operation: &str, adapter: Option<&str>) {
    sentry::with_scope(
        |scope| {
            scope.set_tag("operation", operation);
            if let Some(adapter) = adapter {
                scope.set_tag("adapter", adapter);
            }
        },
        || {
            sentry::capture_error(error);
        },
    );
}

/// Capture an exception with context (no-op version)
#[cfg(not(feature = "telemetry"))]
pub fn capture_error(_error: &dyn std::error::Error, _operation: &str, _adapter: Option<&str>) {
    // No-op when telemetry is disabled
}

/// Add a breadcrumb for debugging context
#[cfg(feature = "telemetry")]
pub fn add_breadcrumb(message: impl Into<String>, category: impl Into<String>) {
    sentry::add_breadcrumb(sentry::Breadcrumb {
        message: Some(message.into()),
        category: Some(category.into()),
        level: sentry::Level::Info,
        ..Default::default()
    });
}

/// Add a breadcrumb (no-op version)
#[cfg(not(feature = "telemetry"))]
pub fn add_breadcrumb(_message: impl Into<String>, _category: impl Into<String>) {
    // No-op when telemetry is disabled
}

/// Tauri command to toggle Sentry event sending at runtime
#[tauri::command]
pub fn configure_telemetry(enabled: bool) {
    set_sentry_enabled(enabled);
}
