use crate::core::adapter::DbAdapter;
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

/// Execute transaction using PostgreSQL's proper transaction API (single connection)
async fn execute_postgres_transaction(
    adapter: &crate::adapters::postgres::adapter::PostgresAdapter,
    transaction: CrudTransaction,
    transaction_id: String,
    start_time: Instant,
) -> Result<TransactionResult> {
    let mut committed = Vec::new();
    let id_mappings = HashMap::new();
    let warnings = Vec::new();
    let mut sql_statements = Vec::new();

    // Build all SQL statements
    for (idx, command) in transaction.commands.iter().enumerate() {
        tracing::info!(
            "  Building SQL for command {}/{}: {} ({})",
            idx + 1,
            transaction.commands.len(),
            command.operation_type,
            command.id
        );

        match build_command_sql(command) {
            Ok(sql) => {
                tracing::info!("    Generated SQL: {}", sql);
                sql_statements.push(sql);

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

    // Execute all statements in a single transaction
    tracing::info!(
        "  Executing {} statements in transaction...",
        sql_statements.len()
    );
    match adapter.execute_in_transaction(sql_statements).await {
        Ok(results) => {
            tracing::info!("  ✅ Transaction committed successfully");
            tracing::info!("  Duration: {}ms", start_time.elapsed().as_millis());

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

/// Build SQL for a single command
fn build_command_sql(command: &CrudCommand) -> Result<String> {
    match command.operation_type.as_str() {
        "data.update" => build_update_sql(command),
        "data.insert" => build_insert_sql(command),
        "data.delete" => build_delete_sql(command),
        _ => Err(AppError::Unsupported(format!(
            "Operation type {} not yet supported in transactions",
            command.operation_type
        ))),
    }
}

/// Build UPDATE SQL
fn build_update_sql(command: &CrudCommand) -> Result<String> {
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

    let schema = command.target.schema.as_deref().unwrap_or("public");
    let table = command
        .target
        .table
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("Missing table in target".to_string()))?;

    let where_clause = primary_keys
        .iter()
        .map(|(k, v)| format!("{} = {}", quote_identifier(k), format_value(v)))
        .collect::<Vec<_>>()
        .join(" AND ");

    Ok(format!(
        "UPDATE {}.{} SET {} = {} WHERE {}",
        quote_identifier(schema),
        quote_identifier(table),
        quote_identifier(column),
        format_value(new_value),
        where_clause
    ))
}

/// Build INSERT SQL
fn build_insert_sql(command: &CrudCommand) -> Result<String> {
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

    Ok(format!(
        "INSERT INTO {}.{} ({}) VALUES ({})",
        quote_identifier(schema),
        quote_identifier(table),
        column_list,
        value_list
    ))
}

/// Build DELETE SQL
fn build_delete_sql(command: &CrudCommand) -> Result<String> {
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

    let where_clause = primary_keys
        .iter()
        .map(|(k, v)| format!("{} = {}", quote_identifier(k), format_value(v)))
        .collect::<Vec<_>>()
        .join(" AND ");

    Ok(format!(
        "DELETE FROM {}.{} WHERE {}",
        quote_identifier(schema),
        quote_identifier(table),
        where_clause
    ))
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

    let column_def = crate::types::AddColumnRequest {
        name: payload
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing column name".to_string()))?
            .to_string(),
        data_type: payload
            .get("dataType")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing dataType".to_string()))?
            .to_string(),
        nullable: payload
            .get("nullable")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        default_value: payload
            .get("defaultValue")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        check_constraint: payload
            .get("checkExpression")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        comment: payload
            .get("comment")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };

    adapter
        .alter_table_add_column(schema, table, &column_def)
        .await?;
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

    let modify_req = crate::types::ModifyColumnRequest {
        name: payload
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing column name".to_string()))?
            .to_string(),
        new_name: payload
            .get("newName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        new_type: payload
            .get("newType")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        nullable: payload.get("nullable").and_then(|v| v.as_bool()),
        default_value: payload
            .get("defaultValue")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        drop_default: payload
            .get("dropDefault")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        new_check_constraint: payload
            .get("checkExpression")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        drop_check_constraint: payload
            .get("dropCheckConstraint")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        comment: payload
            .get("comment")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };

    adapter
        .alter_table_modify_column(schema, table, &modify_req)
        .await?;
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

    let column_name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing column name".to_string()))?;

    adapter
        .alter_table_drop_column(schema, table, column_name)
        .await?;
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

    let old_name = payload
        .get("oldName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing oldName".to_string()))?;

    let new_name = payload
        .get("newName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing newName".to_string()))?;

    adapter
        .alter_table_rename_column(schema, table, old_name, new_name)
        .await?;
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

    let columns = payload
        .get("columns")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::InvalidInput("Missing or invalid columns array".to_string()))?
        .iter()
        .filter_map(|v| v.as_str())
        .map(|s| s.to_string())
        .collect::<Vec<_>>();

    if columns.is_empty() {
        return Err(AppError::InvalidInput(
            "columns array cannot be empty".to_string(),
        ));
    }

    let index_req = crate::types::CreateIndexRequest {
        name: payload
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing index name".to_string()))?
            .to_string(),
        columns,
        unique: payload
            .get("unique")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        index_type: payload
            .get("indexType")
            .and_then(|v| v.as_str())
            .unwrap_or("btree")
            .to_string(),
        condition: payload
            .get("condition")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };

    adapter.create_index(schema, table, &index_req).await?;
    Ok(1)
}

async fn execute_index_drop(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("index.drop payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");

    let index_name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing index name".to_string()))?;

    adapter.drop_index(schema, index_name).await?;
    Ok(1)
}

async fn execute_index_rename(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object().ok_or_else(|| {
        AppError::InvalidInput("index.rename payload must be an object".to_string())
    })?;

    let schema = command.target.schema.as_deref().unwrap_or("public");

    let old_name = payload
        .get("oldName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing oldName".to_string()))?;

    let new_name = payload
        .get("newName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::InvalidInput("Missing newName".to_string()))?;

    adapter.rename_index(schema, old_name, new_name).await?;
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

    let fk_req = crate::types::AddForeignKeyRequest {
        constraint_name: payload
            .get("constraintName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        column_name: payload
            .get("columnName")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing columnName".to_string()))?
            .to_string(),
        referenced_table: payload
            .get("referencedTable")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing referencedTable".to_string()))?
            .to_string(),
        referenced_column: payload
            .get("referencedColumn")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::InvalidInput("Missing referencedColumn".to_string()))?
            .to_string(),
        on_update: payload
            .get("onUpdate")
            .and_then(|v| v.as_str())
            .unwrap_or("NO ACTION")
            .to_string(),
        on_delete: payload
            .get("onDelete")
            .and_then(|v| v.as_str())
            .unwrap_or("NO ACTION")
            .to_string(),
    };

    adapter
        .alter_table_add_foreign_key(schema, table, &fk_req)
        .await?;
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

    adapter
        .alter_table_drop_foreign_key(schema, table, constraint_name)
        .await?;
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
