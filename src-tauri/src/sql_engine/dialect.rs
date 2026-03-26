//! SQL Dialect handling for sqlparser-rs integration.

use serde::{Deserialize, Serialize};
use sqlparser::dialect::{
    Dialect, DuckDbDialect, GenericDialect, MsSqlDialect, MySqlDialect, PostgreSqlDialect,
    SQLiteDialect,
};

/// SQL dialect enum matching frontend types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum SqlDialect {
    #[default]
    PostgreSQL,
    MySQL,
    SQLite,
    MsSQL,
    Oracle,
    PlSQL,
    DuckDB,
}

impl SqlDialect {
    /// Convert to sqlparser dialect for parsing.
    pub fn to_sqlparser_dialect(&self) -> Box<dyn Dialect> {
        match self {
            SqlDialect::PostgreSQL => Box::new(PostgreSqlDialect {}),
            SqlDialect::MySQL => Box::new(MySqlDialect {}),
            SqlDialect::SQLite => Box::new(SQLiteDialect {}),
            SqlDialect::MsSQL => Box::new(MsSqlDialect {}),
            SqlDialect::Oracle => Box::new(GenericDialect {}),
            SqlDialect::PlSQL => Box::new(GenericDialect {}),
            SqlDialect::DuckDB => Box::new(DuckDbDialect {}),
        }
    }

    /// Get dialect name as string.
    pub fn name(&self) -> &'static str {
        match self {
            SqlDialect::PostgreSQL => "postgresql",
            SqlDialect::MySQL => "mysql",
            SqlDialect::SQLite => "sqlite",
            SqlDialect::MsSQL => "mssql",
            SqlDialect::Oracle => "oracle",
            SqlDialect::PlSQL => "plsql",
            SqlDialect::DuckDB => "duckdb",
        }
    }
}

impl From<&str> for SqlDialect {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "postgresql" | "postgres" | "pg" => SqlDialect::PostgreSQL,
            "mysql" | "mariadb" => SqlDialect::MySQL,
            "sqlite" => SqlDialect::SQLite,
            "mssql" | "sqlserver" | "transactsql" => SqlDialect::MsSQL,
            "oracle" => SqlDialect::Oracle,
            "plsql" => SqlDialect::PlSQL,
            "plsql" | "oracle" => SqlDialect::PlSQL,
            "duckdb" => SqlDialect::DuckDB,
            _ => SqlDialect::PostgreSQL,
        }
    }
}

// Implement From<DbType> if DbType is available in crate::types
impl From<crate::types::DbType> for SqlDialect {
    fn from(db_type: crate::types::DbType) -> Self {
        match db_type {
            crate::types::DbType::PostgreSQL => SqlDialect::PostgreSQL,
            crate::types::DbType::MySQL | crate::types::DbType::MariaDB => SqlDialect::MySQL,
            crate::types::DbType::SQLite => SqlDialect::SQLite,
            crate::types::DbType::DuckDB => SqlDialect::DuckDB,
            crate::types::DbType::SQLServer => SqlDialect::MsSQL,
            crate::types::DbType::Oracle => SqlDialect::Oracle,
            // Non-SQL databases default to PostgreSQL dialect (they won't use SQL parsing anyway)
            crate::types::DbType::MongoDB | crate::types::DbType::Redis => SqlDialect::PostgreSQL,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dialect_from_str() {
        assert_eq!(SqlDialect::from("postgresql"), SqlDialect::PostgreSQL);
        assert_eq!(SqlDialect::from("postgres"), SqlDialect::PostgreSQL);
        assert_eq!(SqlDialect::from("mysql"), SqlDialect::MySQL);
        assert_eq!(SqlDialect::from("sqlite"), SqlDialect::SQLite);
        assert_eq!(SqlDialect::from("mssql"), SqlDialect::MsSQL);
        assert_eq!(SqlDialect::from("oracle"), SqlDialect::Oracle);
        assert_eq!(SqlDialect::from("unknown"), SqlDialect::PostgreSQL);
    }

    #[test]
    fn test_dialect_name() {
        assert_eq!(SqlDialect::PostgreSQL.name(), "postgresql");
        assert_eq!(SqlDialect::MySQL.name(), "mysql");
        assert_eq!(SqlDialect::Oracle.name(), "oracle");
    }

    #[test]
    fn test_dialect_from_duckdb_db_type() {
        assert_eq!(
            SqlDialect::from(crate::types::DbType::DuckDB),
            SqlDialect::DuckDB
        );
    }

    #[test]
    fn test_dialect_from_str_duckdb() {
        assert_eq!(SqlDialect::from("duckdb"), SqlDialect::DuckDB);
    }
}
