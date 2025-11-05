use crate::error::{AppError, Result};
use crate::types::CrudTransaction;

/// Validate a CRUD transaction before execution
pub fn validate_transaction(transaction: &CrudTransaction) -> Result<()> {
    // Check transaction has commands
    if transaction.commands.is_empty() {
        return Err(AppError::InvalidInput(
            "Transaction must contain at least one command".to_string(),
        ));
    }

    // Validate each command
    for (idx, command) in transaction.commands.iter().enumerate() {
        // Check operation type is valid
        if command.operation_type.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "Command {} has empty operation_type",
                idx
            )));
        }

        // Check target has required fields based on operation type
        if command.operation_type.starts_with("data.") {
            if command.target.table.is_none() {
                return Err(AppError::InvalidInput(format!(
                    "Command {} (data operation) requires table in target",
                    idx
                )));
            }
        }

        // Validate payload is not empty
        if command.payload.is_null() {
            return Err(AppError::InvalidInput(format!(
                "Command {} has null payload",
                idx
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CrudCommand, CrudCommandMetadata, CrudCommandTarget};
    use serde_json::json;

    #[test]
    fn test_empty_transaction() {
        let transaction = CrudTransaction {
            id: "test".to_string(),
            commands: vec![],
            rollback_on_error: true,
        };

        assert!(validate_transaction(&transaction).is_err());
    }

    #[test]
    fn test_valid_data_update() {
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
                description: None,
                user_id: None,
                source: None,
                temp_id: None,
            }),
            state: "staged".to_string(),
        };

        let transaction = CrudTransaction {
            id: "test".to_string(),
            commands: vec![command],
            rollback_on_error: true,
        };

        assert!(validate_transaction(&transaction).is_ok());
    }

    #[test]
    fn test_missing_table() {
        let command = CrudCommand {
            id: "1".to_string(),
            operation_type: "data.update".to_string(),
            target: CrudCommandTarget {
                connection_id: "conn1".to_string(),
                schema: Some("public".to_string()),
                table: None, // Missing!
                column: None,
                index: None,
                trigger: None,
                constraint: None,
            },
            payload: json!({"column": "email"}),
            metadata: None,
            state: "staged".to_string(),
        };

        let transaction = CrudTransaction {
            id: "test".to_string(),
            commands: vec![command],
            rollback_on_error: true,
        };

        assert!(validate_transaction(&transaction).is_err());
    }
}
