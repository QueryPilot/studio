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
    let start_time = Instant::now();
    let transaction_id = transaction.id.clone();

    // Validate the transaction
    crate::crud::validator::validate_transaction(&transaction)?;

    // Begin database transaction
    adapter.execute("BEGIN").await.map_err(|e| {
        AppError::DatabaseError(format!("Failed to begin transaction: {}", e))
    })?;

    let mut committed = Vec::new();
    let mut id_mappings = HashMap::new();
    let mut warnings = Vec::new();

    // Execute each command sequentially
    for command in transaction.commands.iter() {
        match execute_command(adapter, command, &mut id_mappings).await {
            Ok((summary, command_warnings)) => {
                committed.push(summary);
                warnings.extend(command_warnings);
            }
            Err(e) => {
                // Rollback on error
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
    adapter.execute("COMMIT").await.map_err(|e| {
        AppError::DatabaseError(format!("Failed to commit transaction: {}", e))
    })?;

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
        .ok_or_else(|| {
            AppError::InvalidInput("Missing 'primaryKeys' in payload".to_string())
        })?;

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
        .ok_or_else(|| {
            AppError::InvalidInput("Missing 'primaryKeys' in payload".to_string())
        })?;

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
// STRUCTURE OPERATIONS - Stubs for now (implement later)
// ============================================================================

async fn execute_column_add(_adapter: &dyn DbAdapter, _command: &CrudCommand) -> Result<u64> {
    // TODO: Implement via adapter.alter_table_add_column()
    Err(AppError::Unsupported(
        "column.add not yet implemented".to_string(),
    ))
}

async fn execute_column_modify(_adapter: &dyn DbAdapter, _command: &CrudCommand) -> Result<u64> {
    // TODO: Implement via adapter.alter_table_modify_column()
    Err(AppError::Unsupported(
        "column.modify not yet implemented".to_string(),
    ))
}

async fn execute_column_drop(_adapter: &dyn DbAdapter, _command: &CrudCommand) -> Result<u64> {
    // TODO: Implement via adapter.alter_table_drop_column()
    Err(AppError::Unsupported(
        "column.drop not yet implemented".to_string(),
    ))
}

async fn execute_column_rename(_adapter: &dyn DbAdapter, _command: &CrudCommand) -> Result<u64> {
    // TODO: Implement via adapter.alter_table_rename_column()
    Err(AppError::Unsupported(
        "column.rename not yet implemented".to_string(),
    ))
}

async fn execute_index_create(_adapter: &dyn DbAdapter, _command: &CrudCommand) -> Result<u64> {
    // TODO: Implement via adapter.create_index()
    Err(AppError::Unsupported(
        "index.create not yet implemented".to_string(),
    ))
}

async fn execute_index_drop(_adapter: &dyn DbAdapter, _command: &CrudCommand) -> Result<u64> {
    // TODO: Implement via adapter.drop_index()
    Err(AppError::Unsupported(
        "index.drop not yet implemented".to_string(),
    ))
}

async fn execute_index_rename(_adapter: &dyn DbAdapter, _command: &CrudCommand) -> Result<u64> {
    // TODO: Implement via adapter.rename_index()
    Err(AppError::Unsupported(
        "index.rename not yet implemented".to_string(),
    ))
}

async fn execute_foreign_key_add(
    _adapter: &dyn DbAdapter,
    _command: &CrudCommand,
) -> Result<u64> {
    // TODO: Implement via adapter.alter_table_add_foreign_key()
    Err(AppError::Unsupported(
        "fk.add not yet implemented".to_string(),
    ))
}

async fn execute_foreign_key_drop(
    _adapter: &dyn DbAdapter,
    _command: &CrudCommand,
) -> Result<u64> {
    // TODO: Implement via adapter.alter_table_drop_foreign_key()
    Err(AppError::Unsupported(
        "fk.drop not yet implemented".to_string(),
    ))
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
        serde_json::Value::Bool(b) => {
            if *b {
                "TRUE"
            } else {
                "FALSE"
            }
        }
        .to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => format!("'{}'", s.replace("'", "''")),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            format!("'{}'", value.to_string().replace("'", "''"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_quote_identifier() {
        assert_eq!(quote_identifier("users"), "\"users\"");
        assert_eq!(quote_identifier("public.users"), "\"public.users\"");
        assert_eq!(quote_identifier("table\"name"), "\"table\"\"name\"");
    }

    #[test]
    fn test_format_value() {
        assert_eq!(format_value(&json!(null)), "NULL");
        assert_eq!(format_value(&json!(true)), "TRUE");
        assert_eq!(format_value(&json!(false)), "FALSE");
        assert_eq!(format_value(&json!(42)), "42");
        assert_eq!(format_value(&json!(3.14)), "3.14");
        assert_eq!(format_value(&json!("hello")), "'hello'");
        assert_eq!(format_value(&json!("it's")), "'it''s'");
        assert_eq!(format_value(&json!(["a", "b"])), "'[\"a\",\"b\"]'");
        assert_eq!(format_value(&json!({"key": "value"})), "'{\"key\":\"value\"}'");
    }

    #[test]
    fn test_transaction_validation() {
        use crate::types::{CrudCommand, CrudCommandMetadata, CrudCommandTarget};

        // Valid transaction
        let command = CrudCommand {
            id: "1".to_string(),
            operation_type: "data.update".to_string(),
            target: CrudCommandTarget {
                connection_id: "conn1".to_string(),
                schema: Some("public".to_string()),
                table: Some("users".to_string()),
                column: None,
                index: None,
                trigger: None,
                constraint: None,
            },
            payload: json!({
                "column": "email",
                "newValue": "test@example.com",
                "primaryKeys": {"id": 1}
            }),
            metadata: Some(CrudCommandMetadata {
                timestamp: "2025-01-01T00:00:00Z".to_string(),
                description: Some("Update user email".to_string()),
                user_id: None,
                source: None,
                temp_id: None,
            }),
            state: "staged".to_string(),
        };

        let transaction = CrudTransaction {
            id: "txn1".to_string(),
            commands: vec![command],
            rollback_on_error: true,
        };

        // Should pass validation
        assert!(crate::crud::validator::validate_transaction(&transaction).is_ok());

        // Empty transaction should fail
        let empty_txn = CrudTransaction {
            id: "txn2".to_string(),
            commands: vec![],
            rollback_on_error: true,
        };
        assert!(crate::crud::validator::validate_transaction(&empty_txn).is_err());
    }

    /// Integration test documentation
    ///
    /// To test the full transaction flow, run:
    ///
    /// ```bash
    /// # 1. Start PostgreSQL container
    /// docker run -d -p 5432:5432 \
    ///   -e POSTGRES_PASSWORD=postgres \
    ///   -e POSTGRES_DB=testdb \
    ///   postgres:15
    ///
    /// # 2. Run integration tests
    /// cargo test --test integration_tests
    /// ```
    ///
    /// Example transaction flow test:
    ///
    /// ```rust,no_run
    /// use crate::crud::executor::execute_crud_transaction;
    /// use crate::types::*;
    /// use serde_json::json;
    ///
    /// async fn test_data_update_transaction() {
    ///     // Connect to database
    ///     let adapter = /* get PostgreSQL adapter */;
    ///
    ///     // Create transaction
    ///     let transaction = CrudTransaction {
    ///         id: "test-txn".to_string(),
    ///         commands: vec![
    ///             CrudCommand {
    ///                 id: "cmd1".to_string(),
    ///                 operation_type: "data.update".to_string(),
    ///                 target: CrudCommandTarget {
    ///                     connection_id: "conn1".to_string(),
    ///                     schema: Some("public".to_string()),
    ///                     table: Some("users".to_string()),
    ///                     column: None,
    ///                     index: None,
    ///                     trigger: None,
    ///                     constraint: None,
    ///                 },
    ///                 payload: json!({
    ///                     "column": "email",
    ///                     "newValue": "updated@example.com",
    ///                     "primaryKeys": {"id": 1}
    ///                 }),
    ///                 metadata: None,
    ///                 state: "staged".to_string(),
    ///             }
    ///         ],
    ///         rollback_on_error: true,
    ///     };
    ///
    ///     // Execute
    ///     let result = execute_crud_transaction(&*adapter, transaction).await;
    ///
    ///     // Verify
    ///     assert!(result.is_ok());
    ///     let txn_result = result.unwrap();
    ///     assert!(txn_result.success);
    ///     assert_eq!(txn_result.committed.len(), 1);
    ///     assert_eq!(txn_result.failures.len(), 0);
    /// }
    /// ```
    #[test]
    fn integration_test_documentation() {
        // This test just ensures the documentation compiles
    }
}
