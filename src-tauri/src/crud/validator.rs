use crate::error::{AppError, Result};
use crate::types::{CrudCommand, CrudTransaction};

const DATA_OPERATIONS: [&str; 3] = ["data.insert", "data.update", "data.delete"];

pub fn validate_transaction(transaction: &CrudTransaction) -> Result<()> {
    if transaction.commands.is_empty() {
        return Err(AppError::InvalidInput(
            "CRUD transaction must include at least one command".into(),
        ));
    }

    for command in &transaction.commands {
        validate_command(command)?;
    }

    Ok(())
}

fn validate_command(command: &CrudCommand) -> Result<()> {
    if command.operation_type.trim().is_empty() {
        return Err(AppError::InvalidInput("Command operation_type cannot be empty".into()));
    }

    if DATA_OPERATIONS.contains(&command.operation_type.as_str()) {
        if command.target.table.is_none() {
            return Err(AppError::InvalidInput(format!(
                "Command {} requires a target table",
                command.operation_type
            )));
        }
    }

    Ok(())
}

