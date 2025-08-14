use sqlx::SqlitePool;
use std::error::Error;

/// Run database migrations
pub async fn run_migrations(pool: &SqlitePool) -> Result<(), Box<dyn Error>> {
    // Create connections table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT NOT NULL,
            encrypted_password TEXT,
            database_name TEXT,
            encrypted_ssh_key TEXT,
            encrypted_api_key TEXT,
            connection_type TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        "#
    )
    .execute(pool)
    .await?;
    
    // Create index on connection name
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_connections_name ON connections(name)"
    )
    .execute(pool)
    .await?;
    
    // Create workspaces table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            connection_id TEXT NOT NULL,
            settings TEXT NOT NULL, -- JSON
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;
    
    // Create generic secure storage table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS secure_storage (
            key TEXT PRIMARY KEY,
            encrypted_value TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        "#
    )
    .execute(pool)
    .await?;
    
    // Create audit log table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            timestamp TIMESTAMP NOT NULL,
            event_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            user_id TEXT,
            outcome TEXT NOT NULL,
            metadata TEXT, -- JSON
            ip_address TEXT,
            user_agent TEXT,
            error_message TEXT
        )
        "#
    )
    .execute(pool)
    .await?;
    
    // Create indices for audit log
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC)"
    )
    .execute(pool)
    .await?;
    
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type)"
    )
    .execute(pool)
    .await?;
    
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_audit_log_resource_id ON audit_log(resource_id)"
    )
    .execute(pool)
    .await?;
    
    // Create query history table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS query_history (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            query_text TEXT NOT NULL,
            execution_time_ms INTEGER NOT NULL,
            rows_affected INTEGER,
            error_message TEXT,
            executed_at TIMESTAMP NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;
    
    // Create index for query history
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_query_history_workspace ON query_history(workspace_id, executed_at DESC)"
    )
    .execute(pool)
    .await?;
    
    // Create key rotation tracking table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS key_rotation_log (
            id TEXT PRIMARY KEY,
            key_id TEXT NOT NULL,
            old_version INTEGER NOT NULL,
            new_version INTEGER NOT NULL,
            rotated_at TIMESTAMP NOT NULL,
            reason TEXT NOT NULL
        )
        "#
    )
    .execute(pool)
    .await?;
    
    // Create shared configurations table (for future team features)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS shared_configs (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            encrypted_key BLOB NOT NULL,
            permissions INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL,
            version INTEGER NOT NULL
        )
        "#
    )
    .execute(pool)
    .await?;
    
    // Create share recipients table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS share_recipients (
            config_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            wrapped_key BLOB NOT NULL,
            granted_at TIMESTAMP NOT NULL,
            PRIMARY KEY (config_id, user_id),
            FOREIGN KEY (config_id) REFERENCES shared_configs(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;
    
    Ok(())
}