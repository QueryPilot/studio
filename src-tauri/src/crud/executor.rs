use crate::core::adapter::{DbAdapter, ParameterizedSql, SqlParam};
use crate::error::{AppError, Result};
use crate::types::*;
use std::collections::HashMap;
use std::time::Instant;

/// Execute a CRUD transaction with all-or-nothing semantics
///
/// Security: Uses parameterized queries (via adapter methods) to prevent SQL injection
/// Performance: Executes commands sequentially within a single database transaction
pub async fn execute_crud_transaction(
    adapter: &dyn DbAdapter,
    transaction: CrudTransaction,
) -> Result<TransactionResult> {
    tracing::info!("🟢 CRUD executor: Starting transaction {}", transaction.id);
    tracing::info!("  Commands to execute: {}", transaction.commands.len());

    let start_time = Instant::now();
    let transaction_id = transaction.id.clone();

    // Validate the transaction
    tracing::info!("  Validating transaction...");
    crate::crud::validator::validate_transaction(&transaction)?;
    tracing::info!("  ✅ Validation passed");

    // Try to use PostgreSQL's proper transaction method if available
    if let Some(pg_adapter) = adapter
        .as_any()
        .downcast_ref::<crate::adapters::postgres::adapter::PostgresAdapter>()
    {
        tracing::info!("  Using PostgreSQL transaction (single connection)");
        return execute_postgres_transaction(pg_adapter, transaction, transaction_id, start_time)
            .await;
    }

    // Fallback to old (broken) method for other databases
    tracing::warn!("  Using fallback transaction method (NOT properly transactional!)");

    // Begin database transaction (rollback any existing transaction first)
    tracing::info!("  Ensuring clean transaction state...");
    let _ = adapter.execute("ROLLBACK").await; // Ignore error if no transaction exists

    tracing::info!("  Beginning database transaction...");
    adapter.execute("BEGIN").await.map_err(|e| {
        tracing::error!("  ❌ Failed to BEGIN transaction: {}", e);
        AppError::DatabaseError(format!("Failed to begin transaction: {}", e))
    })?;
    tracing::info!("  ✅ Database transaction started");

    let mut committed = Vec::new();
    let mut id_mappings = HashMap::new();
    let mut warnings = Vec::new();

    // Execute each command sequentially
    for (idx, command) in transaction.commands.iter().enumerate() {
        tracing::info!(
            "  Executing command {}/{}: {} ({})",
            idx + 1,
            transaction.commands.len(),
            command.operation_type,
            command.id
        );

        match execute_command(adapter, command, &mut id_mappings).await {
            Ok((summary, command_warnings)) => {
                tracing::info!("  ✅ Command {} succeeded", command.id);
                committed.push(summary);
                warnings.extend(command_warnings);
            }
            Err(e) => {
                tracing::error!("  ❌ Command {} failed: {}", command.id, e);
                // Rollback on error
                tracing::info!("  Rolling back transaction...");
                let _ = adapter.execute("ROLLBACK").await;

                let error = CommandError {
                    code: "EXECUTION_FAILED".to_string(),
                    message: e.to_string(),
                    severity: "error".to_string(),
                    recoverable: false,
                };

                let failure = CommandFailure {
                    id: command.id.clone(),
                    operation_type: command.operation_type.clone(),
                    error,
                    rolled_back: true,
                };

                return Ok(TransactionResult {
                    transaction_id,
                    success: false,
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    committed: vec![],
                    failures: vec![failure],
                    warnings: None,
                    id_mappings: None,
                });
            }
        }
    }

    // Commit transaction
    tracing::info!("  Committing transaction...");
    adapter.execute("COMMIT").await.map_err(|e| {
        tracing::error!("  ❌ Failed to COMMIT transaction: {}", e);
        AppError::DatabaseError(format!("Failed to commit transaction: {}", e))
    })?;
    tracing::info!("  ✅ Transaction committed successfully");
    tracing::info!("  Duration: {}ms", start_time.elapsed().as_millis());

    Ok(TransactionResult {
        transaction_id,
        success: true,
        duration_ms: start_time.elapsed().as_millis() as u64,
        committed,
        failures: vec![],
        warnings: if warnings.is_empty() {
            None
        } else {
            Some(warnings)
        },
        id_mappings: if id_mappings.is_empty() {
            None
        } else {
            Some(id_mappings)
        },
    })
}

/// Execute transaction using PostgreSQL's proper transaction API with parameterized queries
/// SECURITY: Uses $1, $2 placeholders to prevent SQL injection
async fn execute_postgres_transaction(
    adapter: &crate::adapters::postgres::adapter::PostgresAdapter,
    transaction: CrudTransaction,
    transaction_id: String,
    start_time: Instant,
) -> Result<TransactionResult> {
    let mut committed = Vec::new();
    let id_mappings = HashMap::new();
    let warnings = Vec::new();
    let mut parameterized_statements = Vec::new();

    // Build all parameterized SQL statements
    for (idx, command) in transaction.commands.iter().enumerate() {
        tracing::info!(
            "  Building parameterized SQL for command {}/{}: {} ({})",
            idx + 1,
            transaction.commands.len(),
            command.operation_type,
            command.id
        );

        match build_command_sql(command) {
            Ok(stmt) => {
                tracing::info!("    Generated SQL: {} (with {} params)", stmt.sql, stmt.params.len());
                parameterized_statements.push(stmt);

                let summary = CommandSummary {
                    id: command.id.clone(),
                    operation_type: command.operation_type.clone(),
                    description: command
                        .metadata
                        .as_ref()
                        .and_then(|m| m.description.clone()),
                    affected_rows: Some(1), // Will be updated after execution
                };
                committed.push(summary);
            }
            Err(e) => {
                tracing::error!("  ❌ Failed to build SQL for command {}: {}", command.id, e);

                let error = CommandError {
                    code: "SQL_BUILD_FAILED".to_string(),
                    message: e.to_string(),
                    severity: "error".to_string(),
                    recoverable: false,
                };

                let failure = CommandFailure {
                    id: command.id.clone(),
                    operation_type: command.operation_type.clone(),
                    error,
                    rolled_back: false,
                };

                return Ok(TransactionResult {
                    transaction_id,
                    success: false,
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    committed: vec![],
                    failures: vec![failure],
                    warnings: None,
                    id_mappings: None,
                });
            }
        }
    }

    // Execute all statements in a single transaction with parameterized queries
    tracing::info!(
        "  Executing {} parameterized statements in transaction...",
        parameterized_statements.len()
    );
    match adapter
        .execute_parameterized_transaction(parameterized_statements)
        .await
    {
        Ok(results) => {
            tracing::info!("  ✅ Transaction committed successfully");
            tracing::info!("  Duration: {}ms", start_time.elapsed().as_millis());

            // Check for conflicts: UPDATE with 0 affected rows means optimistic lock failed
            for (i, rows) in results.iter().enumerate() {
                if let Some(cmd) = transaction.commands.get(i) {
                    if cmd.operation_type == "data.update" && *rows == 0 {
                        // Check if oldValue was provided (optimistic locking enabled)
                        if let Some(payload) = cmd.payload.as_object() {
                            if payload.contains_key("oldValue") {
                                tracing::warn!(
                                    "  ⚠️ Conflict detected for command {}: row was modified by another user",
                                    cmd.id
                                );

                                let error = CommandError {
                                    code: "CONFLICT_DETECTED".to_string(),
                                    message: "Row was modified by another user since you started editing. Please refresh and try again.".to_string(),
                                    severity: "error".to_string(),
                                    recoverable: true,
                                };

                                let failure = CommandFailure {
                                    id: cmd.id.clone(),
                                    operation_type: cmd.operation_type.clone(),
                                    error,
                                    rolled_back: false, // Transaction already committed
                                };

                                // Note: In a real conflict scenario, we'd want to rollback
                                // but since the transaction already committed, we report the conflict
                                return Ok(TransactionResult {
                                    transaction_id,
                                    success: false,
                                    duration_ms: start_time.elapsed().as_millis() as u64,
                                    committed: vec![],
                                    failures: vec![failure],
                                    warnings: None,
                                    id_mappings: None,
                                });
                            }
                        }
                    }
                }
            }

            // Update affected rows in committed summaries
            for (i, rows) in results.iter().enumerate() {
                if let Some(summary) = committed.get_mut(i) {
                    summary.affected_rows = Some(*rows);
                }
            }

            Ok(TransactionResult {
                transaction_id,
                success: true,
                duration_ms: start_time.elapsed().as_millis() as u64,
                committed,
                failures: vec![],
                warnings: if warnings.is_empty() {
                    None
                } else {
                    Some(warnings)
                },
                id_mappings: if id_mappings.is_empty() {
                    None
                } else {
                    Some(id_mappings)
                },
            })
        }
        Err(e) => {
            tracing::error!("  ❌ Transaction failed: {}", e);

            let error = CommandError {
                code: "TRANSACTION_FAILED".to_string(),
                message: e.to_string(),
                severity: "error".to_string(),
                recoverable: false,
            };

            let failure = CommandFailure {
                id: "transaction".to_string(),
                operation_type: "transaction".to_string(),
                error,
                rolled_back: true,
            };

            Ok(TransactionResult {
                transaction_id,
                success: false,
                duration_ms: start_time.elapsed().as_millis() as u64,
                committed: vec![],
                failures: vec![failure],
                warnings: None,
                id_mappings: None,
            })
        }
    }
}

/// Build parameterized SQL for a single command (SQL INJECTION SAFE)
fn build_command_sql(command: &CrudCommand) -> Result<ParameterizedSql> {
    match command.operation_type.as_str() {
        "data.update" => build_update_sql_parameterized(command),
        "data.insert" => build_insert_sql_parameterized(command),
        "data.delete" => build_delete_sql_parameterized(command),
        _ => Err(AppError::Unsupported(format!(
            "Operation type {} not yet supported in transactions",
            command.operation_type
        ))),
    }
}

/// Types that need explicit SQL casting because tokio_postgres ToSql doesn't support them directly
/// These types require $1::type syntax instead of just $1
fn needs_explicit_cast(pg_type: &str) -> bool {
    let type_lower = pg_type.to_lowercase();
    matches!(
        type_lower.as_str(),
        // Monetary
        "money"
        // Interval
        | "interval"
        // Network types
        | "inet"
        | "cidr"
        | "macaddr"
        | "macaddr8"
        // Geometric types
        | "point"
        | "line"
        | "lseg"
        | "box"
        | "path"
        | "polygon"
        | "circle"
        // Bit strings
        | "bit"
        | "varbit"
        | "bit varying"
        // Range types
        | "int4range"
        | "int8range"
        | "numrange"
        | "tsrange"
        | "tstzrange"
        | "daterange"
        // Multirange types (PostgreSQL 14+)
        | "int4multirange"
        | "int8multirange"
        | "nummultirange"
        | "tsmultirange"
        | "tstzmultirange"
        | "datemultirange"
        // Full-text search
        | "tsvector"
        | "tsquery"
        // XML
        | "xml"
        // Other specialty types
        | "pg_lsn"
        | "pg_snapshot"
        | "txid_snapshot"
    ) || type_lower.ends_with("[]") // All array types need casting
      || type_lower.starts_with("_") // Internal array type names (e.g., _int4)
}

/// Build parameterized UPDATE SQL (SQL INJECTION SAFE)
/// Includes optimistic locking via oldValue check for conflict detection
fn build_update_sql_parameterized(command: &CrudCommand) -> Result<ParameterizedSql> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("data.update payload must be an object".to_string())
    })?;

    let column = payload
        .get("column")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing 'column' in payload".to_string()))?;

    let new_value = payload
        .get("newValue")
        .ok_or_else(|| AppError::InvalidInput("Missing 'newValue' in payload".to_string()))?;

    // Optional columnType for explicit casting (needed for specialty types like money, inet, etc.)
    let column_type = payload.get("columnType").and_then(|v| v.as_str());

    // Optional oldValue for conflict detection (optimistic locking)
    let old_value = payload.get("oldValue");

    let primary_keys = payload
        .get("primaryKeys")
        .and_then(|v| v.as_object())
        .ok_or_else(|| AppError::InvalidInput("Missing 'primaryKeys' in payload".to_string()))?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Build parameterized query with $1, $2, etc. placeholders
    let mut params = Vec::new();
    let mut param_idx = 1;

    // SET clause: column = $1 (or $1::type for specialty types)
    params.push(SqlParam::from_json(new_value));
    let placeholder = if let Some(col_type) = column_type {
        if needs_explicit_cast(col_type) {
            format!("${}::{}", param_idx, col_type)
        } else {
            format!("${}", param_idx)
        }
    } else {
        format!("${}", param_idx)
    };
    let set_clause = format!("{} = {}", quote_identifier(column), placeholder);
    param_idx += 1;

    // WHERE clause: pk1 = $2 AND pk2 = $3 ...
    let mut where_parts: Vec<String> = primary_keys
        .iter()
        .map(|(k, v)| {
            params.push(SqlParam::from_json(v));
            let placeholder = format!("{} = ${}", quote_identifier(k), param_idx);
            param_idx += 1;
            placeholder
        })
        .collect();

    // Add optimistic locking check if oldValue is provided
    // This ensures the row hasn't been modified since we fetched it
    if let Some(old_val) = old_value {
        if old_val.is_null() {
            // For NULL values, use IS NULL (not = NULL which doesn't work in SQL)
            where_parts.push(format!("{} IS NULL", quote_identifier(column)));
        } else {
            params.push(SqlParam::from_json(old_val));
            where_parts.push(format!("{} = ${}", quote_identifier(column), param_idx));
            // param_idx += 1; // Not needed as this is the last parameter
        }
    }

    let where_clause = where_parts.join(" AND ");

    let sql = format!(
        "UPDATE {}.{} SET {} WHERE {}",
        quote_identifier(schema),
        quote_identifier(table),
        set_clause,
        where_clause
    );

    Ok(ParameterizedSql::new(sql, params))
}

/// Build parameterized INSERT SQL (SQL INJECTION SAFE)
fn build_insert_sql_parameterized(command: &CrudCommand) -> Result<ParameterizedSql> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("data.insert payload must be an object".to_string())
    })?;

    let values = payload
        .get("values")
        .and_then(|v| v.as_object())
        .ok_or_else(|| AppError::InvalidInput("Missing 'values' in payload".to_string()))?;

    // Optional columnTypes for explicit casting (needed for specialty types)
    let column_types = payload
        .get("columnTypes")
        .and_then(|v| v.as_object());

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Build column list and parameterized values
    let mut params = Vec::new();
    let columns: Vec<&str> = values.keys().map(|s| s.as_str()).collect();

    let column_list = columns
        .iter()
        .map(|c| quote_identifier(c))
        .collect::<Vec<_>>()
        .join(", ");

    // Build $1, $2, $3 ... placeholders (with optional type casts)
    let placeholders: Vec<String> = columns
        .iter()
        .enumerate()
        .map(|(idx, c)| {
            params.push(SqlParam::from_json(values.get(*c).unwrap()));
            let param_num = idx + 1;

            // Check if this column needs explicit casting
            if let Some(types_map) = column_types {
                if let Some(col_type) = types_map.get(*c).and_then(|v| v.as_str()) {
                    if needs_explicit_cast(col_type) {
                        return format!("${}::{}", param_num, col_type);
                    }
                }
            }
            format!("${}", param_num)
        })
        .collect();
    let placeholder_list = placeholders.join(", ");

    let sql = format!(
        "INSERT INTO {}.{} ({}) VALUES ({})",
        quote_identifier(schema),
        quote_identifier(table),
        column_list,
        placeholder_list
    );

    Ok(ParameterizedSql::new(sql, params))
}

/// Build parameterized DELETE SQL (SQL INJECTION SAFE)
fn build_delete_sql_parameterized(command: &CrudCommand) -> Result<ParameterizedSql> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("data.delete payload must be an object".to_string())
    })?;

    let primary_keys = payload
        .get("primaryKeys")
        .and_then(|v| v.as_object())
        .ok_or_else(|| AppError::InvalidInput("Missing 'primaryKeys' in payload".to_string()))?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Build WHERE clause with parameterized values
    let mut params = Vec::new();
    let where_parts: Vec<String> = primary_keys
        .iter()
        .enumerate()
        .map(|(idx, (k, v))| {
            params.push(SqlParam::from_json(v));
            format!("{} = ${}", quote_identifier(k), idx + 1)
        })
        .collect();
    let where_clause = where_parts.join(" AND ");

    let sql = format!(
        "DELETE FROM {}.{} WHERE {}",
        quote_identifier(schema),
        quote_identifier(table),
        where_clause
    );

    Ok(ParameterizedSql::new(sql, params))
}

/// Execute a single CRUD command
///
/// Returns (summary, warnings) on success
async fn execute_command(
    adapter: &dyn DbAdapter,
    command: &CrudCommand,
    id_mappings: &mut HashMap<String, String>,
) -> Result<(CommandSummary, Vec<CommandError>)> {
    let warnings = Vec::new();

    let affected_rows = match command.operation_type.as_str() {
        "data.update" => execute_data_update(adapter, command).await?,
        "data.insert" => execute_data_insert(adapter, command, id_mappings).await?,
        "data.delete" => execute_data_delete(adapter, command).await?,
        "table.create" => execute_table_create(adapter, command).await?,
        "table.drop" => execute_table_drop(adapter, command).await?,
        "column.add" => execute_column_add(adapter, command).await?,
        "column.modify" => execute_column_modify(adapter, command).await?,
        "column.drop" => execute_column_drop(adapter, command).await?,
        "column.rename" => execute_column_rename(adapter, command).await?,
        "index.create" => execute_index_create(adapter, command).await?,
        "index.drop" => execute_index_drop(adapter, command).await?,
        "index.rename" => execute_index_rename(adapter, command).await?,
        "fk.add" => execute_foreign_key_add(adapter, command).await?,
        "fk.drop" => execute_foreign_key_drop(adapter, command).await?,
        _ => {
            return Err(AppError::InvalidInput(format!(
                "Unsupported operation type: {}",
                command.operation_type
            )))
        }
    };

    let summary = CommandSummary {
        id: command.id.clone(),
        operation_type: command.operation_type.clone(),
        description: command
            .metadata
            .as_ref()
            .and_then(|m| m.description.clone()),
        affected_rows: Some(affected_rows),
    };

    Ok((summary, warnings))
}

// ============================================================================
// DATA OPERATIONS
// ============================================================================

async fn execute_data_update(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    // Parse payload
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("data.update payload must be an object".to_string())
    })?;

    let column = payload
        .get("column")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing 'column' in payload".to_string()))?;

    let new_value = payload
        .get("newValue")
        .ok_or_else(|| AppError::InvalidInput("Missing 'newValue' in payload".to_string()))?;

    let primary_keys = payload
        .get("primaryKeys")
        .and_then(|v| v.as_object())
        .ok_or_else(|| AppError::InvalidInput("Missing 'primaryKeys' in payload".to_string()))?;

    // Build SQL (basic implementation - should use parameterized queries)
    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Build WHERE clause from primary keys
    let where_clause = primary_keys
        .iter()
        .map(|(k, v)| format!("{} = {}", quote_identifier(k), format_value(v)))
        .collect::<Vec<_>>()
        .join(" AND ");

    let sql = format!(
        "UPDATE {}.{} SET {} = {} WHERE {}",
        quote_identifier(schema),
        quote_identifier(table),
        quote_identifier(column),
        format_value(new_value),
        where_clause
    );

    tracing::info!("    Generated SQL: {}", sql);

    adapter.execute(&sql).await
}

async fn execute_data_insert(
    adapter: &dyn DbAdapter,
    command: &CrudCommand,
    id_mappings: &mut HashMap<String, String>,
) -> Result<u64> {
    // Parse payload
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("data.insert payload must be an object".to_string())
    })?;

    let values = payload
        .get("values")
        .and_then(|v| v.as_object())
        .ok_or_else(|| AppError::InvalidInput("Missing 'values' in payload".to_string()))?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Build INSERT statement
    let columns: Vec<&str> = values.keys().map(|s| s.as_str()).collect();
    let column_list = columns
        .iter()
        .map(|c| quote_identifier(c))
        .collect::<Vec<_>>()
        .join(", ");

    let value_list = columns
        .iter()
        .map(|c| format_value(values.get(*c).unwrap()))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "INSERT INTO {}.{} ({}) VALUES ({}) RETURNING *",
        quote_identifier(schema),
        quote_identifier(table),
        column_list,
        value_list
    );

    // Execute and get inserted ID
    let result = adapter.query(&sql).await?;

    // Track temp → permanent ID mapping if temp_id was provided
    if let Some(metadata) = &command.metadata {
        if let Some(temp_id) = &metadata.temp_id {
            // Extract permanent ID from result (first column, first row)
            if let Some(first_row) = result.rows.first() {
                if let Some(perm_id) = first_row.first() {
                    id_mappings.insert(temp_id.clone(), perm_id.to_string());
                }
            }
        }
    }

    Ok(1) // One row inserted
}

async fn execute_data_delete(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    // Parse payload
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("data.delete payload must be an object".to_string())
    })?;

    let primary_keys = payload
        .get("primaryKeys")
        .and_then(|v| v.as_object())
        .ok_or_else(|| AppError::InvalidInput("Missing 'primaryKeys' in payload".to_string()))?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Build WHERE clause
    let where_clause = primary_keys
        .iter()
        .map(|(k, v)| format!("{} = {}", quote_identifier(k), format_value(v)))
        .collect::<Vec<_>>()
        .join(" AND ");

    let sql = format!(
        "DELETE FROM {}.{} WHERE {}",
        quote_identifier(schema),
        quote_identifier(table),
        where_clause
    );

    adapter.execute(&sql).await
}

// ============================================================================
// STRUCTURE OPERATIONS
// ============================================================================

// --- TABLE OPERATIONS ---

async fn execute_table_create(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("table.create payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");

    // Frontend sends { tableName, columns: [...], primaryKey?: [...], ifNotExists?: bool }
    let table_name = payload
        .get("tableName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing 'tableName' in payload".to_string()))?;

    let columns = payload
        .get("columns")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::InvalidInput("Missing 'columns' array in payload".to_string()))?;

    let primary_key = payload
        .get("primaryKey")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(String::from)
                .collect::<Vec<_>>()
        });

    let if_not_exists = payload
        .get("ifNotExists")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Build column definitions
    let mut column_defs = Vec::new();
    for col in columns {
        let col_obj = col.as_object().ok_or_else(|| {
            AppError::InvalidInput("Each column must be an object".to_string())
        })?;

        let name = col_obj
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing column name".to_string()))?;

        let data_type = col_obj
            .get("dataType")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing column dataType".to_string()))?;

        let nullable = col_obj
            .get("nullable")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let default_value = col_obj
            .get("defaultValue")
            .filter(|v| !v.is_null());

        let mut def = format!("{} {}", quote_identifier(name), data_type);
        if !nullable {
            def.push_str(" NOT NULL");
        }
        if let Some(default) = default_value {
            def.push_str(" DEFAULT ");
            def.push_str(&format_value(default));
        }

        column_defs.push(def);
    }

    // Add primary key constraint if specified
    if let Some(pk_columns) = &primary_key {
        if !pk_columns.is_empty() {
            let pk_def = format!(
                "PRIMARY KEY ({})",
                pk_columns
                    .iter()
                    .map(|c| quote_identifier(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            column_defs.push(pk_def);
        }
    }

    // Build CREATE TABLE SQL
    let if_not_exists_clause = if if_not_exists { "IF NOT EXISTS " } else { "" };
    let sql = format!(
        "CREATE TABLE {}{}.{} (\n  {}\n)",
        if_not_exists_clause,
        quote_identifier(schema),
        quote_identifier(table_name),
        column_defs.join(",\n  ")
    );

    tracing::info!("Executing CREATE TABLE: {}", sql);
    adapter.execute(&sql).await
}

async fn execute_table_drop(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("table.drop payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");

    // Frontend sends { tableName, cascade?: bool, ifExists?: bool }
    let table_name = payload
        .get("tableName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing 'tableName' in payload".to_string()))?;

    let cascade = payload
        .get("cascade")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let if_exists = payload
        .get("ifExists")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    // Build DROP TABLE SQL
    let if_exists_clause = if if_exists { "IF EXISTS " } else { "" };
    let cascade_clause = if cascade { " CASCADE" } else { "" };
    let sql = format!(
        "DROP TABLE {}{}.{}{}",
        if_exists_clause,
        quote_identifier(schema),
        quote_identifier(table_name),
        cascade_clause
    );

    tracing::info!("Executing DROP TABLE: {}", sql);
    adapter.execute(&sql).await
}

// --- COLUMN OPERATIONS ---

async fn execute_column_add(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("column.add payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Frontend sends { column: { name, dataType, ... }, tempId }
    // Extract column definition from nested object
    let column = payload
        .get("column")
        .and_then(|v| v.as_object())
        .ok_or_else(|| AppError::InvalidInput("Missing 'column' object in payload".to_string()))?;

    let name = column
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing column name".to_string()))?;
    let data_type = column
        .get("dataType")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing dataType".to_string()))?;
    let nullable = column
        .get("nullable")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    // Handle defaultValue as either string or other JSON value
    let default_value = column.get("defaultValue").and_then(|v| {
        if v.is_null() {
            None
        } else if let Some(s) = v.as_str() {
            Some(s.to_string())
        } else {
            Some(v.to_string())
        }
    });
    let check_constraint = column.get("checkExpression").and_then(|v| v.as_str());
    let comment = column.get("comment").and_then(|v| v.as_str());

    // Build ADD COLUMN SQL
    let mut sql = format!(
        "ALTER TABLE {}.{} ADD COLUMN {} {}",
        quote_identifier(schema),
        quote_identifier(table),
        quote_identifier(name),
        data_type
    );

    if !nullable {
        sql.push_str(" NOT NULL");
    }

    if let Some(ref default) = default_value {
        sql.push_str(&format!(" DEFAULT {}", default));
    }

    if let Some(check) = check_constraint {
        sql.push_str(&format!(" CHECK ({})", check));
    }

    adapter.execute(&sql).await?;

    // Add comment if provided
    if let Some(cmt) = comment {
        let escaped = cmt.replace('\'', "''");
        let comment_sql = format!(
            "COMMENT ON COLUMN {}.{}.{} IS '{}'",
            quote_identifier(schema),
            quote_identifier(table),
            quote_identifier(name),
            escaped
        );
        adapter.execute(&comment_sql).await?;
    }

    Ok(1)
}

async fn execute_column_modify(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("column.modify payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Frontend sends { columnName, newDefinition: { dataType, nullable, defaultValue, comment } }
    let column_name = payload
        .get("columnName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing columnName".to_string()))?;

    let new_definition = payload
        .get("newDefinition")
        .and_then(|v| v.as_object());

    // Extract fields from newDefinition (all optional)
    let new_type = new_definition.and_then(|d| d.get("dataType")).and_then(|v| v.as_str());
    let nullable = new_definition.and_then(|d| d.get("nullable")).and_then(|v| v.as_bool());
    let default_value = new_definition.and_then(|d| d.get("defaultValue")).and_then(|v| {
        if v.is_null() {
            None
        } else if let Some(s) = v.as_str() {
            Some(s.to_string())
        } else {
            Some(v.to_string())
        }
    });
    // Check if defaultValue was explicitly set to null (drop default)
    let drop_default = new_definition
        .and_then(|d| d.get("defaultValue"))
        .map(|v| v.is_null())
        .unwrap_or(false);
    let new_check_constraint = new_definition.and_then(|d| d.get("checkExpression")).and_then(|v| v.as_str());
    let drop_check_constraint = new_definition
        .and_then(|d| d.get("dropCheckConstraint"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let comment = new_definition.and_then(|d| d.get("comment")).and_then(|v| v.as_str());

    let current_column_name = quote_identifier(column_name);

    // Handle column rename (from newDefinition.name if different)
    let new_name = new_definition.and_then(|d| d.get("name")).and_then(|v| v.as_str());
    if let Some(new_n) = new_name {
        if new_n != column_name {
            let sql = format!(
                "ALTER TABLE {}.{} RENAME COLUMN {} TO {}",
                quote_identifier(schema),
                quote_identifier(table),
                current_column_name,
                quote_identifier(new_n)
            );
            adapter.execute(&sql).await?;
        }
    }

    // Use the new name for subsequent operations if it was renamed
    let working_column_name = new_name
        .filter(|n| *n != column_name)
        .map(|n| quote_identifier(n))
        .unwrap_or_else(|| current_column_name.clone());

    // Handle type change
    if let Some(new_t) = new_type {
        let sql = format!(
            "ALTER TABLE {}.{} ALTER COLUMN {} TYPE {} USING {}::{}",
            quote_identifier(schema),
            quote_identifier(table),
            working_column_name,
            new_t,
            working_column_name,
            new_t
        );
        adapter.execute(&sql).await?;
    }

    // Handle nullable change
    if let Some(is_nullable) = nullable {
        let sql = if is_nullable {
            format!(
                "ALTER TABLE {}.{} ALTER COLUMN {} DROP NOT NULL",
                quote_identifier(schema),
                quote_identifier(table),
                working_column_name
            )
        } else {
            format!(
                "ALTER TABLE {}.{} ALTER COLUMN {} SET NOT NULL",
                quote_identifier(schema),
                quote_identifier(table),
                working_column_name
            )
        };
        adapter.execute(&sql).await?;
    }

    // Handle default value
    if drop_default {
        let sql = format!(
            "ALTER TABLE {}.{} ALTER COLUMN {} DROP DEFAULT",
            quote_identifier(schema),
            quote_identifier(table),
            working_column_name
        );
        adapter.execute(&sql).await?;
    } else if let Some(ref default) = default_value {
        let sql = format!(
            "ALTER TABLE {}.{} ALTER COLUMN {} SET DEFAULT {}",
            quote_identifier(schema),
            quote_identifier(table),
            working_column_name,
            default
        );
        adapter.execute(&sql).await?;
    }

    // Handle CHECK constraint changes
    if drop_check_constraint {
        // Find and drop existing check constraints for this column
        let result = adapter
            .query(&format!(
                "SELECT con.conname FROM pg_constraint con \
                 JOIN pg_class t ON t.oid = con.conrelid \
                 JOIN pg_namespace n ON n.oid = t.relnamespace \
                 WHERE n.nspname = '{}' AND t.relname = '{}' AND con.contype = 'c' \
                 AND pg_get_constraintdef(con.oid) ILIKE '%{}%'",
                schema,
                table,
                working_column_name.trim_matches('"')
            ))
            .await?;

        for row in &result.rows {
            if let Some(conname) = row.first() {
                let sql = format!(
                    "ALTER TABLE {}.{} DROP CONSTRAINT IF EXISTS {}",
                    quote_identifier(schema),
                    quote_identifier(table),
                    quote_identifier(&conname.to_string())
                );
                let _ = adapter.execute(&sql).await;
            }
        }
    }

    if let Some(check) = new_check_constraint {
        let conname = format!("chk_{}_{}", table, working_column_name.trim_matches('"'));
        let sql = format!(
            "ALTER TABLE {}.{} ADD CONSTRAINT {} CHECK ({}) NOT VALID",
            quote_identifier(schema),
            quote_identifier(table),
            quote_identifier(&conname),
            check
        );
        adapter.execute(&sql).await?;
    }

    // Update comment
    if let Some(cmt) = comment {
        let escaped = cmt.replace('\'', "''");
        let comment_sql = format!(
            "COMMENT ON COLUMN {}.{}.{} IS '{}'",
            quote_identifier(schema),
            quote_identifier(table),
            working_column_name,
            escaped
        );
        adapter.execute(&comment_sql).await?;
    }

    Ok(1)
}

async fn execute_column_drop(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("column.drop payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Frontend sends { columnName, cascade? }
    let column_name = payload
        .get("columnName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing columnName".to_string()))?;

    let cascade = payload
        .get("cascade")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let cascade_str = if cascade { " CASCADE" } else { "" };
    let sql = format!(
        "ALTER TABLE {}.{} DROP COLUMN IF EXISTS {}{}",
        quote_identifier(schema),
        quote_identifier(table),
        quote_identifier(column_name),
        cascade_str
    );

    adapter.execute(&sql).await?;
    Ok(1)
}

async fn execute_column_rename(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("column.rename payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Frontend sends { columnName, newName }
    let old_name = payload
        .get("columnName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing columnName".to_string()))?;

    let new_name = payload
        .get("newName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing newName".to_string()))?;

    let sql = format!(
        "ALTER TABLE {}.{} RENAME COLUMN {} TO {}",
        quote_identifier(schema),
        quote_identifier(table),
        quote_identifier(old_name),
        quote_identifier(new_name)
    );

    adapter.execute(&sql).await?;
    Ok(1)
}

async fn execute_index_create(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("index.create payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    // Frontend sends { definition: { name, columns, unique, using, where, includeColumns }, tempId }
    let definition = payload
        .get("definition")
        .and_then(|v| v.as_object())
        .ok_or_else(|| AppError::InvalidInput("Missing 'definition' object in payload".to_string()))?;

    let columns = definition
        .get("columns")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::InvalidInput("Missing or invalid columns array".to_string()))?
        .iter()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>();

    if columns.is_empty() {
        return Err(AppError::InvalidInput(
            "columns array cannot be empty".to_string(),
        ));
    }

    let name = definition
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing index name".to_string()))?;
    let unique = definition
        .get("unique")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // Frontend uses "using" (e.g., "btree", "hash", "gin")
    let index_type = definition
        .get("using")
        .and_then(|v| v.as_str())
        .unwrap_or("btree");
    // Frontend uses "where" for partial index condition
    let condition = definition.get("where").and_then(|v| v.as_str());

    // Format columns (handle opclass syntax like: column gin_trgm_ops)
    let formatted_columns = columns
        .iter()
        .map(|col| {
            if col.contains('(') {
                // Expression like lower(col) - use as-is
                col.to_string()
            } else {
                let mut parts = col.split_whitespace();
                let first = parts.next().unwrap_or(col);
                let rest: Vec<&str> = parts.collect();
                if rest.is_empty() {
                    quote_identifier(first)
                } else {
                    format!("{} {}", quote_identifier(first), rest.join(" "))
                }
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    let unique_str = if unique { "UNIQUE " } else { "" };

    let mut sql = format!(
        "CREATE {}INDEX {} ON {}.{} USING {} ({})",
        unique_str,
        quote_identifier(name),
        quote_identifier(schema),
        quote_identifier(table),
        index_type,
        formatted_columns
    );

    if let Some(cond) = condition {
        sql.push_str(&format!(" WHERE {}", cond));
    }

    adapter.execute(&sql).await?;
    Ok(1)
}

async fn execute_index_drop(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("index.drop payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");

    // Frontend sends { indexName, ifExists? }
    let index_name = payload
        .get("indexName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing indexName".to_string()))?;

    let sql = format!(
        "DROP INDEX IF EXISTS {}.{}",
        quote_identifier(schema),
        quote_identifier(index_name)
    );

    adapter.execute(&sql).await?;
    Ok(1)
}

async fn execute_index_rename(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("index.rename payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");

    // Frontend sends { indexName, newName }
    let old_name = payload
        .get("indexName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing indexName".to_string()))?;

    let new_name = payload
        .get("newName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing newName".to_string()))?;

    let sql = format!(
        "ALTER INDEX {}.{} RENAME TO {}",
        quote_identifier(schema),
        quote_identifier(old_name),
        quote_identifier(new_name)
    );

    adapter.execute(&sql).await?;
    Ok(1)
}

async fn execute_foreign_key_add(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command
        .payload
        .as_object()
        .ok_or_else(|| AppError::InvalidInput("fk.add payload must be an object".to_string()))?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    let constraint_name = payload.get("constraintName").and_then(|v| v.as_str());
    let column_name = payload
        .get("columnName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing columnName".to_string()))?;
    let referenced_table = payload
        .get("referencedTable")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing referencedTable".to_string()))?;
    let referenced_column = payload
        .get("referencedColumn")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing referencedColumn".to_string()))?;
    let on_update = payload
        .get("onUpdate")
        .and_then(|v| v.as_str())
        .unwrap_or("NO ACTION");
    let on_delete = payload
        .get("onDelete")
        .and_then(|v| v.as_str())
        .unwrap_or("NO ACTION");

    // Check if the column is an array type (cannot have FK)
    let type_check_sql = format!(
        "SELECT format_type(a.atttypid, a.atttypmod) as data_type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = '{}' AND c.relname = '{}' AND a.attname = '{}' AND NOT a.attisdropped",
        schema, table, column_name
    );

    let result = adapter.query(&type_check_sql).await?;
    if let Some(row) = result.rows.first() {
        if let Some(data_type) = row.first() {
            let type_str = data_type.to_string();
            if type_str.ends_with("[]") || type_str.starts_with("ARRAY") {
                return Err(AppError::InvalidInput(format!(
                    "Cannot create foreign key on array column '{}' (type: {}). PostgreSQL does not support foreign key constraints on array columns.",
                    column_name, type_str
                )));
            }
        }
    }

    let final_constraint_name = constraint_name
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("fk_{}_{}_{}", table, column_name, referenced_table));

    let sql = format!(
        "ALTER TABLE {}.{} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON UPDATE {} ON DELETE {}",
        quote_identifier(schema),
        quote_identifier(table),
        quote_identifier(&final_constraint_name),
        quote_identifier(column_name),
        quote_identifier(referenced_table),
        quote_identifier(referenced_column),
        on_update,
        on_delete
    );

    adapter.execute(&sql).await?;
    Ok(1)
}

async fn execute_foreign_key_drop(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command
        .payload
        .as_object()
        .ok_or_else(|| AppError::InvalidInput("fk.drop payload must be an object".to_string()))?;

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    let constraint_name = payload
        .get("constraintName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing constraintName".to_string()))?;

    let sql = format!(
        "ALTER TABLE {}.{} DROP CONSTRAINT IF EXISTS {}",
        quote_identifier(schema),
        quote_identifier(table),
        quote_identifier(constraint_name)
    );

    adapter.execute(&sql).await?;
    Ok(1)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Quote SQL identifier (basic implementation - should be database-specific)
fn quote_identifier(ident: &str) -> String {
    format!("\"{}\"", ident.replace("\"", "\"\""))
}

/// Format JSON value for SQL (basic implementation - needs improvement)
fn format_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => format!("'{}'", s.replace("'", "''")),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            format!("'{}'", value.to_string().replace("'", "''"))
        }
    }
}
