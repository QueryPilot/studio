use std::error::Error;
use sqlx::{SqlitePool, Row};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

/// Security event types for audit logging
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SecurityEventType {
    // Credential operations
    CredentialCreated,
    CredentialAccess,
    CredentialModified,
    CredentialDeleted,
    
    // Authentication events
    AuthenticationAttempt,
    AuthenticationSuccess,
    AuthenticationFailure,
    
    // Key management
    KeyRotation,
    KeyBackup,
    KeyRecovery,
    
    // Configuration changes
    ConfigurationChange,
    PermissionChange,
    
    // Data operations
    DataExport,
    DataImport,
    DataPurge,
    
    // Security events
    SecurityViolation,
    AnomalyDetected,
    EmergencyAccess,
}

/// Event outcome
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EventOutcome {
    Success,
    Failure,
    Partial,
    Unknown,
}

/// Audit event structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub event_type: SecurityEventType,
    pub resource_id: String,
    pub user_id: Option<String>,
    pub outcome: EventOutcome,
    pub metadata: Option<JsonValue>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub error_message: Option<String>,
}

impl AuditEvent {
    /// Create a new audit event
    pub fn new(
        event_type: SecurityEventType,
        resource_id: String,
        outcome: EventOutcome,
        metadata: Option<JsonValue>,
    ) -> Self {
        AuditEvent {
            id: Uuid::new_v4(),
            timestamp: Utc::now(),
            event_type,
            resource_id,
            user_id: None, // Would be set from session context
            outcome,
            metadata,
            ip_address: None, // Would be captured from request
            user_agent: None, // Would be captured from request
            error_message: None,
        }
    }
    
    /// Create a failed event with error message
    pub fn failure(
        event_type: SecurityEventType,
        resource_id: String,
        error: &str,
    ) -> Self {
        let mut event = Self::new(event_type, resource_id, EventOutcome::Failure, None);
        event.error_message = Some(error.to_string());
        event
    }
}

/// Audit logger for security events
pub struct AuditLogger {
    pool: SqlitePool,
}

impl AuditLogger {
    /// Create a new audit logger
    pub fn new(pool: SqlitePool) -> Self {
        AuditLogger { pool }
    }
    
    /// Log an audit event
    pub async fn log_event(&self, event: AuditEvent) -> Result<(), Box<dyn Error>> {
        let mut conn = self.pool.acquire().await?;
        
        let metadata_json = event.metadata.map(|m| serde_json::to_string(&m).unwrap_or_default());
        
        sqlx::query(
            r#"
            INSERT INTO audit_log (
                id, timestamp, event_type, resource_id, user_id,
                outcome, metadata, ip_address, user_agent, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(event.id.to_string())
        .bind(event.timestamp.to_rfc3339())
        .bind(serde_json::to_string(&event.event_type)?)
        .bind(&event.resource_id)
        .bind(&event.user_id)
        .bind(serde_json::to_string(&event.outcome)?)
        .bind(&metadata_json)
        .bind(&event.ip_address)
        .bind(&event.user_agent)
        .bind(&event.error_message)
        .execute(&mut *conn)
        .await?;
        
        Ok(())
    }
    
    /// Query audit events with filters
    pub async fn query_events(
        &self,
        event_type: Option<SecurityEventType>,
        resource_id: Option<&str>,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
        limit: Option<i64>,
    ) -> Result<Vec<AuditEvent>, Box<dyn Error>> {
        let mut conn = self.pool.acquire().await?;
        
        let mut query = String::from(
            "SELECT * FROM audit_log WHERE 1=1"
        );
        let mut bindings: Vec<String> = Vec::new();
        
        if let Some(event_type) = event_type {
            query.push_str(" AND event_type = ?");
            bindings.push(serde_json::to_string(&event_type)?);
        }
        
        if let Some(resource_id) = resource_id {
            query.push_str(" AND resource_id = ?");
            bindings.push(resource_id.to_string());
        }
        
        if let Some(start_time) = start_time {
            query.push_str(" AND timestamp >= ?");
            bindings.push(start_time.to_rfc3339());
        }
        
        if let Some(end_time) = end_time {
            query.push_str(" AND timestamp <= ?");
            bindings.push(end_time.to_rfc3339());
        }
        
        query.push_str(" ORDER BY timestamp DESC");
        
        if let Some(limit) = limit {
            query.push_str(&format!(" LIMIT {}", limit));
        }
        
        // Execute query with dynamic bindings
        let mut sql_query = sqlx::query(&query);
        for binding in bindings {
            sql_query = sql_query.bind(binding);
        }
        
        let rows = sql_query.fetch_all(&mut *conn).await?;
        
        let events = rows.into_iter().map(|row| {
            let metadata_str: Option<String> = row.try_get("metadata").ok();
            let metadata = metadata_str.and_then(|s| serde_json::from_str(&s).ok());
            
            AuditEvent {
                id: Uuid::parse_str(&row.try_get::<String, _>("id").unwrap_or_default()).unwrap_or_default(),
                timestamp: {
                    let date_str: String = row.try_get("timestamp").unwrap_or_else(|_| Utc::now().to_rfc3339());
                    DateTime::parse_from_rfc3339(&date_str).ok().map(|dt| dt.with_timezone(&Utc)).unwrap_or_else(|| Utc::now())
                },
                event_type: serde_json::from_str(&row.try_get::<String, _>("event_type").unwrap_or_default()).unwrap_or(SecurityEventType::AnomalyDetected),
                resource_id: row.try_get::<String, _>("resource_id").unwrap_or_default(),
                user_id: row.try_get("user_id").ok(),
                outcome: serde_json::from_str(&row.try_get::<String, _>("outcome").unwrap_or_default()).unwrap_or(EventOutcome::Unknown),
                metadata,
                ip_address: row.try_get("ip_address").ok(),
                user_agent: row.try_get("user_agent").ok(),
                error_message: row.try_get("error_message").ok(),
            }
        }).collect();
        
        Ok(events)
    }
    
    /// Get recent security violations
    pub async fn get_security_violations(&self, hours: i64) -> Result<Vec<AuditEvent>, Box<dyn Error>> {
        let start_time = Utc::now() - chrono::Duration::hours(hours);
        
        self.query_events(
            Some(SecurityEventType::SecurityViolation),
            None,
            Some(start_time),
            None,
            Some(100),
        ).await
    }
    
    /// Get failed authentication attempts
    pub async fn get_failed_auth_attempts(&self, resource_id: &str, hours: i64) -> Result<Vec<AuditEvent>, Box<dyn Error>> {
        let start_time = Utc::now() - chrono::Duration::hours(hours);
        
        self.query_events(
            Some(SecurityEventType::AuthenticationFailure),
            Some(resource_id),
            Some(start_time),
            None,
            Some(100),
        ).await
    }
    
    /// Clean up old audit logs
    pub async fn cleanup_old_logs(&self, days: i64) -> Result<u64, Box<dyn Error>> {
        let cutoff_date = Utc::now() - chrono::Duration::days(days);
        
        let mut conn = self.pool.acquire().await?;
        let result = sqlx::query("DELETE FROM audit_log WHERE timestamp < ?")
            .bind(cutoff_date.to_rfc3339())
            .execute(&mut *conn)
            .await?;
        
        Ok(result.rows_affected())
    }
}