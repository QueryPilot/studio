//! SQL Engine module for Query Pilot.
//!
//! Provides SQL parsing, schema caching, and dialect-specific query generation
//! using sqlparser-rs. This is the foundation for smart editor features:
//!
//! - Real-time SQL parsing with error positions
//! - Schema metadata caching with TTL-based invalidation
//! - Multi-dialect support (PostgreSQL, MySQL, SQLite, SQL Server, Oracle)
//! - Table/column/CTE reference extraction
//!
//! # Architecture
//!
//! ```text
//! Frontend (CodeMirror)
//!     │
//!     ├─→ sql_parse()      → ParsedDocument with statements, errors
//!     ├─→ sql_validate()   → Validation errors (syntax + semantic)
//!     ├─→ sql_complete()   → Context-aware completions
//!     └─→ sql_format()     → Formatted SQL
//!
//! Schema Cache (DashMap + TTL)
//!     │
//!     └─→ Tables, Columns, FKs, Enums, Functions
//! ```
//!
//! # Usage
//!
//! ```rust,ignore
//! use crate::sql_engine::{SqlDialect, parse_document, SchemaStore};
//!
//! // Parse SQL
//! let doc = parse_document("SELECT * FROM users", SqlDialect::PostgreSQL);
//!
//! // Check for errors
//! if doc.errors.is_empty() {
//!     for stmt in &doc.statements {
//!         println!("Tables: {:?}", stmt.tables);
//!     }
//! }
//!
//! // Use schema cache
//! let store = SchemaStore::new();
//! let key = CacheKey::new("conn-123", "mydb", "public");
//! if let Some(schema) = store.get(&key) {
//!     println!("Cached tables: {:?}", schema.tables);
//! }
//! ```

use once_cell::sync::Lazy;

pub mod commands;
pub mod completion;
pub mod cte_inference;
pub mod dialect;
// TODO: formatter has API compat issues with sqlparser 0.52 - fix in separate PR
// pub mod formatter;
pub mod join_suggester;
pub mod parser;
pub mod span;
// NOTE: schema_queries.rs DELETED - TypeScript adapters are single source of truth
// Schema data is pushed from frontend via sql_set_schema command
pub mod refactor;
pub mod schema_store;
pub mod semantic;
pub mod snippets;
pub mod sp_params;
pub mod symbol_finder;
pub mod templates;
pub mod validator;

/// Global schema store for caching schema metadata.
/// Populated by sql_set_schema (push from frontend), used by sql_complete/sql_validate.
/// TypeScript adapters are the SINGLE SOURCE OF TRUTH for introspection queries.
pub static SCHEMA_STORE: Lazy<SchemaStore> = Lazy::new(SchemaStore::new);

// Re-export main types at module level
pub use dialect::SqlDialect;
pub use parser::{
    parse_document, parse_statement, AliasBinding, ColumnReference, CteDefinition, ParseError,
    ParsedDocument, ParsedStatement, TableReference,
};
pub use schema_store::{
    CacheKey, CacheStats, CachedSchema, CachedSchemaBuilder, ColumnInfo, EnumInfo, ForeignKeyInfo,
    FunctionInfo, FunctionParam, ParamMode, SchemaStore, TableInfo, TableType, ViewInfo,
};
pub use validator::{
    validate_document, validate_statement, ErrorSeverity, ErrorSource, SqlError, ValidationResult,
    VersionFeatures,
};
// TODO: formatter has API compat issues with sqlparser 0.52 - fix in separate PR
// pub use formatter::{format_sql, FormatError, FormatOptions};

// Completion engine exports
pub use completion::{
    complete, expand_select_star, generate_alias, CompletionContext, CompletionItem,
    CompletionKind, CompletionRequest, CompletionResult,
};
pub use cte_inference::{
    analyze_cte_select, infer_cte_columns, infer_cte_columns_detailed, CteColumnSource,
    InferredCteColumn,
};
pub use join_suggester::{
    suggest_joinable_tables, suggest_joins, JoinSuggestion, JoinableTableSuggestion,
    RelationshipType,
};
pub use refactor::{
    Refactor, RefactorAction, RefactorKind, RefactorRequest, RefactorResult, TextEdit,
};
pub use snippets::{
    get_all_snippets, get_snippets, get_snippets_by_category, SnippetCategory, SnippetItem,
};
pub use sp_params::{
    generate_function_call, get_builtin_function_help, get_function_overloads,
    get_function_signature, suggest_sp_params, BuiltinFunctionHelp, FunctionOverload,
    ParamSuggestion,
};
pub use span::TextSpan;
pub use symbol_finder::{SymbolFinder, SymbolKind, SymbolReferences};
pub use templates::{
    generate_create_table_template, generate_delete_template, generate_insert_for_columns,
    generate_insert_template, generate_select_template, generate_update_template,
    generate_upsert_template,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_integration_parse_and_extract() {
        let sql = r#"
            WITH active AS (
                SELECT id, name FROM users WHERE active = true
            )
            SELECT a.id, a.name, o.total
            FROM active a
            JOIN orders o ON a.id = o.user_id
            WHERE o.total > 100
        "#;

        let doc = parse_document(sql, SqlDialect::PostgreSQL);

        assert!(doc.errors.is_empty(), "Parse errors: {:?}", doc.errors);
        assert_eq!(doc.statements.len(), 1);

        let stmt = &doc.statements[0];

        // Should find CTE
        assert!(!stmt.ctes.is_empty());
        assert_eq!(stmt.ctes[0].name, "active");

        // Should find tables (active CTE, orders)
        assert!(stmt.tables.len() >= 2);

        // Should find aliases
        assert!(stmt.aliases.iter().any(|a| a.alias == "a"));
        assert!(stmt.aliases.iter().any(|a| a.alias == "o"));
    }

    #[test]
    fn test_dialect_conversion() {
        use crate::types::DbType;

        let pg: SqlDialect = DbType::PostgreSQL.into();
        assert_eq!(pg, SqlDialect::PostgreSQL);

        let mysql: SqlDialect = DbType::MySQL.into();
        assert_eq!(mysql, SqlDialect::MySQL);

        let mariadb: SqlDialect = DbType::MariaDB.into();
        assert_eq!(mariadb, SqlDialect::MySQL); // MariaDB uses MySQL dialect

        let oracle: SqlDialect = DbType::Oracle.into();
        assert_eq!(oracle, SqlDialect::Oracle);
        let duckdb: SqlDialect = DbType::DuckDB.into();
        assert_eq!(duckdb, SqlDialect::DuckDB);
    }

    #[test]
    fn test_schema_store_concurrent() {
        use std::sync::Arc;
        use std::thread;

        let store = Arc::new(SchemaStore::new());
        let mut handles = vec![];

        // Spawn multiple threads writing to cache
        for i in 0..10 {
            let store = Arc::clone(&store);
            handles.push(thread::spawn(move || {
                let key = CacheKey::new(format!("conn-{}", i), "mydb", "public");
                store.put(
                    key.clone(),
                    CachedSchemaBuilder::new()
                        .add_table(TableInfo {
                            name: format!("table_{}", i),
                            schema: Some("public".to_string()),
                            table_type: TableType::Table,
                            comment: None,
                            row_count: None,
                        })
                        .build(),
                );
                store.get(&key).is_some()
            }));
        }

        // All threads should succeed
        for handle in handles {
            assert!(handle.join().unwrap());
        }

        assert_eq!(store.stats().total_entries, 10);
    }
}
