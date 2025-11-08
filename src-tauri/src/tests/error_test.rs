use crate::error::AppError;

#[test]
fn test_app_error_creation() {
    let db_error = AppError::DatabaseError("Connection failed".to_string());
    assert!(matches!(db_error, AppError::DatabaseError(_)));

    let internal_error = AppError::Internal("Internal error".to_string());
    assert!(matches!(internal_error, AppError::Internal(_)));

    let not_found_error = AppError::NotFound("Resource not found".to_string());
    assert!(matches!(not_found_error, AppError::NotFound(_)));
}

#[test]
fn test_error_display() {
    let error = AppError::DatabaseError("Test error".to_string());
    let display = format!("{}", error);
    assert!(display.contains("Test error") || display.contains("Database"));
}

#[test]
fn test_error_conversion_from_io() {
    let io_error = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
    let app_error: AppError = io_error.into();
    assert!(matches!(app_error, AppError::Io(_)));
}

#[test]
fn test_internal_error_creation() {
    let errors = vec![
        AppError::Internal("Unexpected state".to_string()),
        AppError::Internal("Invalid configuration".to_string()),
        AppError::Internal("Parsing failed".to_string()),
    ];

    for error in errors {
        assert!(matches!(error, AppError::Internal(_)));
        assert!(!format!("{}", error).is_empty());
    }
}

#[test]
fn test_database_error_messages() {
    let errors = vec![
        "Connection timeout",
        "Query execution failed",
        "Transaction rollback",
        "Constraint violation",
    ];

    for msg in errors {
        let error = AppError::DatabaseError(msg.to_string());
        let display = format!("{}", error);
        assert!(!display.is_empty());
    }
}

#[test]
fn test_error_is_send_and_sync() {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}

    assert_send::<AppError>();
    assert_sync::<AppError>();
}

#[test]
fn test_error_debug_format() {
    let error = AppError::DatabaseError("Debug test".to_string());
    let debug = format!("{:?}", error);
    assert!(!debug.is_empty());
    assert!(debug.contains("DatabaseError") || debug.contains("Debug test"));
}

#[test]
fn test_error_code() {
    let error = AppError::NotFound("test".to_string());
    assert_eq!(error.code(), "E_NOT_FOUND");

    let error = AppError::Internal("test".to_string());
    assert_eq!(error.code(), "E_INTERNAL");

    let error = AppError::DatabaseError("test".to_string());
    assert_eq!(error.code(), "E_DATABASE");
}

#[test]
fn test_all_error_variants() {
    let errors = vec![
        AppError::NotFound("not found".to_string()),
        AppError::ConnectionClosed("connection closed".to_string()),
        AppError::SafeBlocked("safe mode".to_string()),
        AppError::SqlSyntax("syntax error".to_string()),
        AppError::Timeout("timeout".to_string()),
        AppError::Driver("driver error".to_string()),
        AppError::Io("io error".to_string()),
        AppError::Ssh("ssh error".to_string()),
        AppError::Crypto("crypto error".to_string()),
        AppError::Internal("internal error".to_string()),
        AppError::Unsupported("unsupported".to_string()),
        AppError::InvalidInput("invalid input".to_string()),
        AppError::ParseError("parse error".to_string()),
        AppError::DatabaseError("database error".to_string()),
    ];

    for error in errors {
        // All errors should display properly
        assert!(!format!("{}", error).is_empty());
        // All errors should have error codes
        assert!(!error.code().is_empty());
    }
}

#[test]
fn test_error_helper_functions() {
    let error = AppError::not_found("resource");
    assert!(matches!(error, AppError::NotFound(_)));

    let error = AppError::internal("message");
    assert!(matches!(error, AppError::Internal(_)));

    let error = AppError::unsupported("feature");
    assert!(matches!(error, AppError::Unsupported(_)));
}

#[test]
fn test_error_conversion_from_json() {
    let json_error = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
    let app_error: AppError = json_error.into();
    assert!(matches!(app_error, AppError::Internal(_)));
}
