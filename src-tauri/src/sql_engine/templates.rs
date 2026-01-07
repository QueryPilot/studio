//! SQL Template generation for common operations.

use super::schema_store::{ColumnInfo, TableInfo};

/// Generate SELECT template for a table.
pub fn generate_select_template(table: &TableInfo, columns: &[ColumnInfo]) -> String {
    let cols = if columns.is_empty() {
        "*".to_string()
    } else {
        columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", ")
    };

    let schema_prefix = table.schema.as_ref()
        .map(|s| format!("{}.", s))
        .unwrap_or_default();

    format!("SELECT {}\nFROM {}{}\nWHERE ", cols, schema_prefix, table.name)
}

/// Generate INSERT template for a table.
pub fn generate_insert_template(table: &TableInfo, columns: &[ColumnInfo]) -> String {
    let schema_prefix = table.schema.as_ref()
        .map(|s| format!("{}.", s))
        .unwrap_or_default();

    if columns.is_empty() {
        return format!("INSERT INTO {}{} () VALUES ()", schema_prefix, table.name);
    }

    let col_names: Vec<_> = columns.iter()
        .filter(|c| !c.is_primary_key || c.default_value.is_none())
        .map(|c| c.name.as_str())
        .collect();

    let placeholders: Vec<_> = col_names.iter().enumerate()
        .map(|(i, _)| format!("${}", i + 1))
        .collect();

    format!(
        "INSERT INTO {}{} ({})\nVALUES ({})",
        schema_prefix, table.name,
        col_names.join(", "),
        placeholders.join(", ")
    )
}

/// Generate INSERT template with specific columns.
pub fn generate_insert_for_columns(
    table: &TableInfo,
    columns: &[&str],
) -> String {
    let schema_prefix = table.schema.as_ref()
        .map(|s| format!("{}.", s))
        .unwrap_or_default();

    let placeholders: Vec<_> = columns.iter().enumerate()
        .map(|(i, _)| format!("${}", i + 1))
        .collect();

    format!(
        "INSERT INTO {}{} ({})\nVALUES ({})",
        schema_prefix, table.name,
        columns.join(", "),
        placeholders.join(", ")
    )
}

/// Generate UPDATE template for a table.
pub fn generate_update_template(table: &TableInfo, columns: &[ColumnInfo]) -> String {
    let schema_prefix = table.schema.as_ref()
        .map(|s| format!("{}.", s))
        .unwrap_or_default();

    let set_clauses: Vec<_> = columns.iter()
        .filter(|c| !c.is_primary_key)
        .enumerate()
        .map(|(i, c)| format!("{} = ${}", c.name, i + 1))
        .collect();

    let pk_cols: Vec<_> = columns.iter()
        .filter(|c| c.is_primary_key)
        .collect();

    let where_clause = if pk_cols.is_empty() {
        "WHERE ".to_string()
    } else {
        let conditions: Vec<_> = pk_cols.iter().enumerate()
            .map(|(i, c)| format!("{} = ${}", c.name, set_clauses.len() + i + 1))
            .collect();
        format!("WHERE {}", conditions.join(" AND "))
    };

    format!(
        "UPDATE {}{}\nSET {}\n{}",
        schema_prefix, table.name,
        set_clauses.join(",\n    "),
        where_clause
    )
}

/// Generate DELETE template for a table.
pub fn generate_delete_template(table: &TableInfo, pk_columns: &[&str]) -> String {
    let schema_prefix = table.schema.as_ref()
        .map(|s| format!("{}.", s))
        .unwrap_or_default();

    let where_clause = if pk_columns.is_empty() {
        "WHERE ".to_string()
    } else {
        let conditions: Vec<_> = pk_columns.iter().enumerate()
            .map(|(i, c)| format!("{} = ${}", c, i + 1))
            .collect();
        format!("WHERE {}", conditions.join(" AND "))
    };

    format!("DELETE FROM {}{}\n{}", schema_prefix, table.name, where_clause)
}

/// Generate UPSERT (INSERT ON CONFLICT) template.
pub fn generate_upsert_template(
    table: &TableInfo,
    columns: &[ColumnInfo],
    conflict_columns: &[&str],
) -> String {
    let schema_prefix = table.schema.as_ref()
        .map(|s| format!("{}.", s))
        .unwrap_or_default();

    let col_names: Vec<_> = columns.iter().map(|c| c.name.as_str()).collect();
    let placeholders: Vec<_> = col_names.iter().enumerate()
        .map(|(i, _)| format!("${}", i + 1))
        .collect();

    let update_cols: Vec<_> = columns.iter()
        .filter(|c| !conflict_columns.contains(&c.name.as_str()))
        .map(|c| format!("{} = EXCLUDED.{}", c.name, c.name))
        .collect();

    format!(
        "INSERT INTO {}{} ({})\nVALUES ({})\nON CONFLICT ({}) DO UPDATE SET\n    {}",
        schema_prefix, table.name,
        col_names.join(", "),
        placeholders.join(", "),
        conflict_columns.join(", "),
        update_cols.join(",\n    ")
    )
}

/// Generate CREATE TABLE template.
pub fn generate_create_table_template(
    table_name: &str,
    schema: Option<&str>,
    columns: &[ColumnInfo],
) -> String {
    let schema_prefix = schema.map(|s| format!("{}.", s)).unwrap_or_default();

    let col_defs: Vec<_> = columns.iter().map(|c| {
        let mut def = format!("{} {}", c.name, c.data_type);
        if c.is_primary_key {
            def.push_str(" PRIMARY KEY");
        }
        if !c.nullable {
            def.push_str(" NOT NULL");
        }
        if let Some(default) = &c.default_value {
            def.push_str(&format!(" DEFAULT {}", default));
        }
        def
    }).collect();

    format!(
        "CREATE TABLE {}{} (\n    {}\n)",
        schema_prefix, table_name,
        col_defs.join(",\n    ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql_engine::schema_store::TableType;

    fn test_table() -> TableInfo {
        TableInfo {
            name: "users".to_string(),
            schema: Some("public".to_string()),
            table_type: TableType::Table,
            comment: None,
            row_count: None,
        }
    }

    fn test_columns() -> Vec<ColumnInfo> {
        vec![
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                nullable: false,
                default_value: Some("nextval('users_id_seq')".to_string()),
                is_primary_key: true,
                is_unique: true,
                comment: None,
                enum_values: None,
                ordinal: 1,
                precision: None,
                scale: None,
            },
            ColumnInfo {
                name: "name".to_string(),
                data_type: "varchar(255)".to_string(),
                nullable: false,
                default_value: None,
                is_primary_key: false,
                is_unique: false,
                comment: None,
                enum_values: None,
                ordinal: 2,
                precision: None,
                scale: None,
            },
        ]
    }

    #[test]
    fn test_select_template() {
        let table = test_table();
        let cols = test_columns();
        let result = generate_select_template(&table, &cols);
        assert!(result.contains("SELECT id, name"));
        assert!(result.contains("FROM public.users"));
    }

    #[test]
    fn test_insert_template() {
        let table = test_table();
        let cols = test_columns();
        let result = generate_insert_template(&table, &cols);
        assert!(result.contains("INSERT INTO public.users"));
        assert!(result.contains("VALUES"));
    }
}
