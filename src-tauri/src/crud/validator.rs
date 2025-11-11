use crate::error::{AppError, Result};
use crate::types::{CrudCommand, CrudTransaction};

const DATA_OPERATIONS: [&str; 3] = ["data.insert", "data.update", "data.delete"];

pub fn validate_transaction(transaction: &CrudTransaction) -> Result<()> {
    tracing::debug!(
        "Validating transaction with {} commands",
        transaction.commands.len()
    );

    if transaction.commands.is_empty() {
        tracing::error!("Validation failed: transaction has no commands");
        return Err(AppError::InvalidInput(
            "CRUD transaction must include at least one command".into(),
        ));
    }

    for (idx, command) in transaction.commands.iter().enumerate() {
        tracing::debug!(
            "  Validating command {}: {}",
            idx + 1,
            command.operation_type
        );
        validate_command(command)?;
    }

    tracing::debug!("✅ Transaction validation passed");
    Ok(())
}

fn validate_command(command: &CrudCommand) -> Result<()> {
    if command.operation_type.trim().is_empty() {
        tracing::error!("Command {} has empty operation_type", command.id);
        return Err(AppError::InvalidInput(
            "Command operation_type cannot be empty".into(),
        ));
    }

    if DATA_OPERATIONS.contains(&command.operation_type.as_str()) {
        if command.target.table.is_none() {
            tracing::error!(
                "Command {} ({}) is missing target table",
                command.id,
                command.operation_type
            );
            return Err(AppError::InvalidInput(format!(
                "Command {} requires a target table",
                command.operation_type
            )));
        }
    }

    tracing::debug!("    ✓ Command {} validated", command.id);
    Ok(())
}
