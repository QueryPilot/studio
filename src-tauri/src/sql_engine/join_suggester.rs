//! Smart JOIN condition suggestions based on foreign key relationships.
//!
//! Analyzes schema metadata to suggest JOIN conditions with confidence scoring.

use serde::{Deserialize, Serialize};

use super::parser::TableReference;
use super::schema_store::CachedSchema;

/// A suggested JOIN condition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinSuggestion {
    /// The complete JOIN condition (e.g., "a.user_id = b.id")
    pub condition: String,
    /// Confidence score (0-100)
    pub confidence: u8,
    /// Foreign key constraint name if FK-based
    pub fk_info: Option<String>,
    /// Type of relationship discovered
    pub relationship_type: RelationshipType,
}

/// Type of relationship between tables
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum RelationshipType {
    /// Foreign key from source to target
    ForeignKey,
    /// Foreign key from target to source (reverse)
    ReverseForeignKey,
    /// Matching column names with same types
    MatchingColumns,
    /// Common naming pattern (e.g., table_id)
    NamingConvention,
    /// Primary key to primary key (rare, usually many-to-many)
    PrimaryKeyMatch,
}

/// Suggest JOIN conditions for adding a new table to existing tables in scope.
///
/// Analyzes foreign key relationships, matching column names, and naming conventions
/// to generate ranked suggestions.
pub fn suggest_joins(
    existing_tables: &[TableReference],
    new_table: &str,
    schema: &CachedSchema,
) -> Vec<JoinSuggestion> {
    let mut suggestions = Vec::new();

    for table_ref in existing_tables {
        let existing_table = &table_ref.name;
        let existing_alias = table_ref.alias.as_ref().unwrap_or(existing_table);
        let new_alias = generate_simple_alias(new_table);

        // Check foreign keys from new table to existing
        let fks_from_new = schema.get_foreign_keys(new_table);
        for fk in fks_from_new {
            if fk.target_table.eq_ignore_ascii_case(existing_table) {
                let condition = build_fk_condition(
                    &new_alias,
                    &fk.source_columns,
                    existing_alias,
                    &fk.target_columns,
                );
                suggestions.push(JoinSuggestion {
                    condition,
                    confidence: 100,
                    fk_info: Some(fk.constraint_name.clone()),
                    relationship_type: RelationshipType::ForeignKey,
                });
            }
        }

        // Check reverse FK from existing to new
        let fks_from_existing = schema.get_foreign_keys(existing_table);
        for fk in fks_from_existing {
            if fk.target_table.eq_ignore_ascii_case(new_table) {
                let condition = build_fk_condition(
                    existing_alias,
                    &fk.source_columns,
                    &new_alias,
                    &fk.target_columns,
                );
                suggestions.push(JoinSuggestion {
                    condition,
                    confidence: 95,
                    fk_info: Some(fk.constraint_name.clone()),
                    relationship_type: RelationshipType::ReverseForeignKey,
                });
            }
        }

        // Check for referencing keys (reverse lookup)
        let refs_to_new = schema.get_referencing_keys(new_table);
        for fk in refs_to_new {
            if fk.source_table.eq_ignore_ascii_case(existing_table) {
                let condition = build_fk_condition(
                    existing_alias,
                    &fk.source_columns,
                    &new_alias,
                    &fk.target_columns,
                );
                if !suggestions.iter().any(|s| s.condition == condition) {
                    suggestions.push(JoinSuggestion {
                        condition,
                        confidence: 90,
                        fk_info: Some(fk.constraint_name.clone()),
                        relationship_type: RelationshipType::ReverseForeignKey,
                    });
                }
            }
        }

        // Matching column suggestions (lower confidence)
        if let (Some(existing_cols), Some(new_cols)) = (
            schema.get_columns(existing_table),
            schema.get_columns(new_table),
        ) {
            // Find matching column names
            for existing_col in &existing_cols {
                for new_col in &new_cols {
                    // Skip if already covered by FK
                    if suggestions.iter().any(|s| {
                        s.condition
                            .contains(&format!("{}.{}", new_alias, new_col.name))
                            && s.condition
                                .contains(&format!("{}.{}", existing_alias, existing_col.name))
                    }) {
                        continue;
                    }

                    // Exact name match
                    if existing_col.name.eq_ignore_ascii_case(&new_col.name) {
                        // Primary key matches get higher score
                        let is_pk_match = existing_col.is_primary_key && new_col.is_primary_key;
                        let confidence = if is_pk_match { 85 } else { 70 };
                        let rel_type = if is_pk_match {
                            RelationshipType::PrimaryKeyMatch
                        } else {
                            RelationshipType::MatchingColumns
                        };

                        suggestions.push(JoinSuggestion {
                            condition: format!(
                                "{}.{} = {}.{}",
                                existing_alias, existing_col.name, new_alias, new_col.name
                            ),
                            confidence,
                            fk_info: None,
                            relationship_type: rel_type,
                        });
                    }

                    // Naming convention: table_id pattern
                    let pattern_match = check_naming_convention(
                        existing_table,
                        &existing_col.name,
                        new_table,
                        &new_col.name,
                    );
                    if let Some((left_col, right_col, conf)) = pattern_match {
                        let condition = format!(
                            "{}.{} = {}.{}",
                            existing_alias, left_col, new_alias, right_col
                        );
                        if !suggestions.iter().any(|s| s.condition == condition) {
                            suggestions.push(JoinSuggestion {
                                condition,
                                confidence: conf,
                                fk_info: None,
                                relationship_type: RelationshipType::NamingConvention,
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort by confidence descending
    suggestions.sort_by(|a, b| b.confidence.cmp(&a.confidence));

    // Deduplicate - keep highest confidence for each unique condition
    let mut seen = std::collections::HashSet::new();
    suggestions.retain(|s| seen.insert(s.condition.clone()));

    suggestions
}

/// Build FK-based JOIN condition string
fn build_fk_condition(
    left_alias: &str,
    left_cols: &[String],
    right_alias: &str,
    right_cols: &[String],
) -> String {
    left_cols
        .iter()
        .zip(right_cols.iter())
        .map(|(l, r)| format!("{}.{} = {}.{}", left_alias, l, right_alias, r))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// Generate a simple alias from table name
fn generate_simple_alias(table_name: &str) -> String {
    let parts: Vec<&str> = table_name.split('_').collect();
    if parts.len() > 1 {
        parts
            .iter()
            .filter_map(|p| p.chars().next())
            .collect::<String>()
            .to_lowercase()
    } else {
        table_name
            .chars()
            .next()
            .map(|c| c.to_lowercase().to_string())
            .unwrap_or_default()
    }
}

/// Check for naming convention patterns between tables
/// Returns (left_col, right_col, confidence) if match found
fn check_naming_convention(
    left_table: &str,
    left_col: &str,
    right_table: &str,
    right_col: &str,
) -> Option<(String, String, u8)> {
    let left_table_lower = left_table.to_lowercase();
    let right_table_lower = right_table.to_lowercase();
    let left_col_lower = left_col.to_lowercase();
    let right_col_lower = right_col.to_lowercase();

    // Pattern: left_col = "{right_table}_id" and right_col = "id"
    let expected_fk_name = format!("{}_id", singularize(&right_table_lower));
    if left_col_lower == expected_fk_name && right_col_lower == "id" {
        return Some((left_col.to_string(), right_col.to_string(), 80));
    }

    // Pattern: right_col = "{left_table}_id" and left_col = "id"
    let expected_reverse_fk = format!("{}_id", singularize(&left_table_lower));
    if right_col_lower == expected_reverse_fk && left_col_lower == "id" {
        return Some((left_col.to_string(), right_col.to_string(), 80));
    }

    // Pattern: column ends with _id and table prefix matches
    if left_col_lower.ends_with("_id") {
        let prefix = left_col_lower.trim_end_matches("_id");
        if (right_table_lower == prefix || right_table_lower == format!("{}s", prefix))
            && right_col_lower == "id"
        {
            return Some((left_col.to_string(), right_col.to_string(), 75));
        }
    }

    if right_col_lower.ends_with("_id") {
        let prefix = right_col_lower.trim_end_matches("_id");
        if (left_table_lower == prefix || left_table_lower == format!("{}s", prefix))
            && left_col_lower == "id"
        {
            return Some((left_col.to_string(), right_col.to_string(), 75));
        }
    }

    None
}

/// Simple singularization for common patterns
fn singularize(word: &str) -> String {
    if let Some(stem) = word.strip_suffix("ies") {
        format!("{}y", stem)
    } else if word.ends_with("es")
        && (word.ends_with("ses") || word.ends_with("xes") || word.ends_with("zes"))
    {
        word[..word.len() - 2].to_string()
    } else if word.ends_with('s') && !word.ends_with("ss") && !word.ends_with("us") {
        // Skip words ending in "us" (status, bonus, campus) - they're already singular
        word[..word.len() - 1].to_string()
    } else {
        word.to_string()
    }
}

/// Suggest additional tables to JOIN based on FK relationships
pub fn suggest_joinable_tables(
    current_tables: &[TableReference],
    schema: &CachedSchema,
) -> Vec<JoinableTableSuggestion> {
    let mut suggestions = Vec::new();
    let current_names: Vec<_> = current_tables
        .iter()
        .map(|t| t.name.to_lowercase())
        .collect();

    for table_ref in current_tables {
        // Find FK targets (tables this table references)
        let fks = schema.get_foreign_keys(&table_ref.name);
        for fk in fks {
            if !current_names.contains(&fk.target_table.to_lowercase()) {
                suggestions.push(JoinableTableSuggestion {
                    table_name: fk.target_table.clone(),
                    via_column: fk.source_columns.join(", "),
                    relationship: format!("{} -> {}", table_ref.name, fk.target_table),
                    confidence: 90,
                });
            }
        }

        // Find referencing tables (tables that reference this table)
        let refs = schema.get_referencing_keys(&table_ref.name);
        for fk in refs {
            if !current_names.contains(&fk.source_table.to_lowercase()) {
                suggestions.push(JoinableTableSuggestion {
                    table_name: fk.source_table.clone(),
                    via_column: fk.target_columns.join(", "),
                    relationship: format!("{} <- {}", table_ref.name, fk.source_table),
                    confidence: 85,
                });
            }
        }
    }

    // Deduplicate by table name
    let mut seen = std::collections::HashSet::new();
    suggestions.retain(|s| seen.insert(s.table_name.to_lowercase()));

    suggestions.sort_by(|a, b| b.confidence.cmp(&a.confidence));
    suggestions
}

/// A suggestion for a table that can be JOINed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinableTableSuggestion {
    /// Name of the table that can be joined
    pub table_name: String,
    /// Column(s) that form the relationship
    pub via_column: String,
    /// Description of the relationship
    pub relationship: String,
    /// Confidence score
    pub confidence: u8,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql_engine::schema_store::{
        CachedSchemaBuilder, ColumnInfo, ForeignKeyInfo, TableInfo, TableType,
    };

    fn create_test_schema() -> CachedSchema {
        CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "users".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .add_table(TableInfo {
                name: "orders".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .add_columns(
                "users",
                vec![
                    ColumnInfo {
                        name: "id".to_string(),
                        data_type: "integer".to_string(),
                        nullable: false,
                        is_primary_key: true,
                        is_unique: true,
                        default_value: None,
                        comment: None,
                        enum_values: None,
                        ordinal: 1,
                        precision: None,
                        scale: None,
                    },
                    ColumnInfo {
                        name: "name".to_string(),
                        data_type: "varchar".to_string(),
                        nullable: false,
                        is_primary_key: false,
                        is_unique: false,
                        default_value: None,
                        comment: None,
                        enum_values: None,
                        ordinal: 2,
                        precision: None,
                        scale: None,
                    },
                ],
            )
            .add_columns(
                "orders",
                vec![
                    ColumnInfo {
                        name: "id".to_string(),
                        data_type: "integer".to_string(),
                        nullable: false,
                        is_primary_key: true,
                        is_unique: true,
                        default_value: None,
                        comment: None,
                        enum_values: None,
                        ordinal: 1,
                        precision: None,
                        scale: None,
                    },
                    ColumnInfo {
                        name: "user_id".to_string(),
                        data_type: "integer".to_string(),
                        nullable: false,
                        is_primary_key: false,
                        is_unique: false,
                        default_value: None,
                        comment: None,
                        enum_values: None,
                        ordinal: 2,
                        precision: None,
                        scale: None,
                    },
                ],
            )
            .add_foreign_key(ForeignKeyInfo {
                constraint_name: "fk_orders_users".to_string(),
                source_table: "orders".to_string(),
                source_schema: Some("public".to_string()),
                source_columns: vec!["user_id".to_string()],
                target_table: "users".to_string(),
                target_schema: Some("public".to_string()),
                target_columns: vec!["id".to_string()],
                on_delete: Some("CASCADE".to_string()),
                on_update: None,
            })
            .build()
    }

    #[test]
    fn test_fk_join_suggestion() {
        let schema = create_test_schema();
        let existing = vec![TableReference {
            schema: Some("public".to_string()),
            name: "users".to_string(),
            alias: Some("u".to_string()),
            position: 0,
        }];

        let suggestions = suggest_joins(&existing, "orders", &schema);

        assert!(!suggestions.is_empty());
        let top = &suggestions[0];
        assert!(top.condition.contains("user_id"));
        assert!(top.condition.contains("id"));
        assert!(top.confidence >= 90);
    }

    #[test]
    fn test_singularize() {
        assert_eq!(singularize("users"), "user");
        assert_eq!(singularize("categories"), "category");
        assert_eq!(singularize("boxes"), "box");
        assert_eq!(singularize("status"), "status");
    }

    #[test]
    fn test_naming_convention_detection() {
        let result = check_naming_convention("orders", "user_id", "users", "id");
        assert!(result.is_some());
        let (left, right, conf) = result.unwrap();
        assert_eq!(left, "user_id");
        assert_eq!(right, "id");
        assert!(conf >= 75);
    }
}
