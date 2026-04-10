use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use duckdb::core::LogicalTypeId;
use duckdb::types::{Value as DuckValue, ValueRef};
use duckdb::{params, params_from_iter, AccessMode, Config, Connection, OptionalExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::core::capabilities::{
    AdapterCapability, BaseCapability, CapabilityColumnMeta, CapabilityQueryResult,
    CapabilityTestResult, SqlQueryable,
};
use crate::error::{AppError, Result};
use crate::types::*;

const DUCKDB_METADATA_SCHEMA_VERSION: i32 = 1;
const MAX_SAFE_JS_INTEGER_I64: i64 = 9_007_199_254_740_991;
const MAX_SAFE_JS_INTEGER_U64: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbColumnDefinition {
    pub name: String,
    pub duckdb_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbAddFileRequest {
    pub file_path: String,
    pub target_schema: Option<String>,
    pub target_name: String,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbReplaceManagedObjectRequest {
    pub target_schema: String,
    pub target_name: String,
    pub object_kind: String,
    pub source_id: String,
    pub source_kind: String,
    pub source_connection_id: Option<String>,
    pub source_spec: JsonValue,
    pub columns: Vec<DuckDbColumnDefinition>,
    pub rows: Vec<Vec<JsonValue>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbManagedObjectSummary {
    pub target_schema: String,
    pub target_name: String,
    pub object_kind: String,
    pub source_id: String,
    pub source_kind: String,
    pub source_connection_id: Option<String>,
    pub last_refresh_at: Option<String>,
    pub last_refresh_status: Option<String>,
    pub last_row_count: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbManagedObjectLineage {
    pub target_schema: String,
    pub target_name: String,
    pub object_kind: String,
    pub source_id: String,
    pub source_kind: String,
    pub source_connection_id: Option<String>,
    pub source_spec: JsonValue,
    pub last_refresh_status: Option<String>,
    pub last_refresh_at: Option<String>,
    pub last_row_count: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbExtensionInfo {
    pub extension_name: String,
    pub loaded: bool,
    pub installed: bool,
    pub description: Option<String>,
    pub install_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbExportRequest {
    pub source: DuckDbExportSource,
    pub destination: String,
    pub format: String,
    pub options: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DuckDbExportSource {
    Query(String),
    Table { schema: String, name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbExportResult {
    pub rows_exported: i64,
    pub destination: String,
    pub format: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DuckDbFileFormat {
    Csv,
    Parquet,
    Json,
}

#[derive(Clone, Copy)]
struct ManagedSourceContext<'a> {
    source_id: &'a str,
    source_kind: &'a str,
    source_connection_id: Option<&'a str>,
    source_spec: &'a JsonValue,
}

#[derive(Clone, Copy)]
struct ManagedObjectTarget<'a> {
    target_schema: &'a str,
    target_name: &'a str,
    object_kind: &'a str,
}

pub struct DuckDbAdapter {
    pub(crate) connection: Arc<Mutex<Option<Connection>>>,
    pub(crate) db_path: Arc<Mutex<Option<PathBuf>>>,
}

impl DuckDbAdapter {
    pub fn new() -> Self {
        Self {
            connection: Arc::new(Mutex::new(None)),
            db_path: Arc::new(Mutex::new(None)),
        }
    }

    async fn is_conn_open(&self) -> bool {
        self.connection.lock().await.is_some()
    }

    pub(crate) async fn execute_blocking<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.connection.clone();

        tokio::task::spawn_blocking(move || {
            let guard = conn.blocking_lock();
            let conn = guard
                .as_ref()
                .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;
            f(conn)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
    }

    pub(crate) fn bootstrap_connection(conn: &Connection) -> Result<()> {
        for stmt in ["LOAD json", "LOAD parquet"] {
            if let Err(error) = conn.execute_batch(stmt) {
                tracing::warn!("DuckDB bootstrap skipped `{}`: {}", stmt, error);
            }
        }

        conn.execute_batch(
            r#"
            CREATE SCHEMA IF NOT EXISTS querypilot_meta;

            CREATE TABLE IF NOT EXISTS querypilot_meta.schema_version (
              version INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS querypilot_meta.managed_sources (
              source_id TEXT PRIMARY KEY,
              source_kind TEXT NOT NULL,
              source_connection_id TEXT,
              source_spec JSON,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS querypilot_meta.managed_objects (
              target_schema TEXT NOT NULL,
              target_name TEXT NOT NULL,
              source_id TEXT,
              object_kind TEXT NOT NULL,
              last_refresh_at TIMESTAMP,
              last_refresh_status TEXT,
              last_row_count BIGINT,
              last_error TEXT,
              PRIMARY KEY(target_schema, target_name)
            );

            CREATE TABLE IF NOT EXISTS querypilot_meta.refresh_runs (
              run_id TEXT PRIMARY KEY,
              target_schema TEXT NOT NULL,
              target_name TEXT NOT NULL,
              started_at TIMESTAMP NOT NULL,
              finished_at TIMESTAMP,
              status TEXT NOT NULL,
              row_count BIGINT,
              error TEXT
            );
            "#,
        )
        .map_err(|e| AppError::DatabaseError(format!("DuckDB bootstrap failed: {}", e)))?;

        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM querypilot_meta.schema_version",
                [],
                |row| row.get(0),
            )
            .map_err(|e| {
                AppError::DatabaseError(format!("Failed to read schema version: {}", e))
            })?;

        if version_count == 0 {
            conn.execute(
                "INSERT INTO querypilot_meta.schema_version(version) VALUES (?)",
                [DUCKDB_METADATA_SCHEMA_VERSION],
            )
            .map_err(|e| {
                AppError::DatabaseError(format!("Failed to initialize schema version: {}", e))
            })?;
        } else {
            let current_version: i32 = conn
                .query_row(
                    "SELECT version FROM querypilot_meta.schema_version LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| {
                    AppError::DatabaseError(format!("Failed to fetch schema version: {}", e))
                })?;

            if current_version < DUCKDB_METADATA_SCHEMA_VERSION {
                conn.execute(
                    "UPDATE querypilot_meta.schema_version SET version = ?",
                    [DUCKDB_METADATA_SCHEMA_VERSION],
                )
                .map_err(|e| {
                    AppError::DatabaseError(format!("Failed to migrate schema version: {}", e))
                })?;
            }
        }

        Ok(())
    }

    fn ensure_httpfs_loaded(conn: &Connection, path: &str) -> Result<()> {
        let lower = path.to_ascii_lowercase();
        if lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("s3://")
        {
            conn.execute_batch("INSTALL httpfs; LOAD httpfs")
                .map_err(|e| {
                    AppError::DatabaseError(format!(
                        "Failed to load DuckDB httpfs extension: {}",
                        e
                    ))
                })?;
        }
        Ok(())
    }

    fn normalize_schema(schema: Option<String>) -> String {
        let trimmed = schema
            .unwrap_or_else(|| "main".to_string())
            .trim()
            .to_string();
        if trimmed.is_empty() {
            "main".to_string()
        } else {
            trimmed
        }
    }

    fn validate_identifier(identifier: &str, label: &str) -> Result<()> {
        if identifier.trim().is_empty() {
            return Err(AppError::InvalidInput(format!(
                "{} must not be empty",
                label
            )));
        }
        Ok(())
    }

    fn validate_type_name(type_name: &str) -> Result<()> {
        let trimmed = type_name.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput(
                "DuckDB type must not be empty".to_string(),
            ));
        }
        if trimmed.contains(';') || trimmed.contains("--") || trimmed.contains("/*") {
            return Err(AppError::InvalidInput(format!(
                "Unsafe DuckDB type expression: {}",
                trimmed
            )));
        }
        Ok(())
    }

    fn quote_identifier(identifier: &str) -> String {
        format!("\"{}\"", identifier.replace('"', "\"\""))
    }

    fn quote_string_literal(value: &str) -> String {
        format!("'{}'", value.replace('\'', "''"))
    }

    fn qualified_name(schema: &str, name: &str) -> String {
        format!(
            "{}.{}",
            Self::quote_identifier(schema),
            Self::quote_identifier(name)
        )
    }

    fn temp_table_name(prefix: &str) -> String {
        format!("{}_{}", prefix, Uuid::new_v4().simple())
    }

    fn detect_file_format(path: &str) -> Result<DuckDbFileFormat> {
        let lower = path.to_ascii_lowercase();
        if lower.ends_with(".parquet") {
            Ok(DuckDbFileFormat::Parquet)
        } else if lower.ends_with(".csv") || lower.ends_with(".tsv") {
            Ok(DuckDbFileFormat::Csv)
        } else if lower.ends_with(".json")
            || lower.ends_with(".jsonl")
            || lower.ends_with(".ndjson")
        {
            Ok(DuckDbFileFormat::Json)
        } else {
            Err(AppError::Unsupported(format!(
                "Unsupported DuckDB scratchpad import format for `{}`",
                path
            )))
        }
    }

    fn file_format_name(format: DuckDbFileFormat) -> &'static str {
        match format {
            DuckDbFileFormat::Csv => "csv",
            DuckDbFileFormat::Parquet => "parquet",
            DuckDbFileFormat::Json => "json",
        }
    }

    fn file_scan_sql(path: &str, format: DuckDbFileFormat) -> String {
        let literal = Self::quote_string_literal(path);
        match format {
            DuckDbFileFormat::Csv => format!("SELECT * FROM read_csv_auto({literal})"),
            DuckDbFileFormat::Parquet => format!("SELECT * FROM read_parquet({literal})"),
            DuckDbFileFormat::Json => format!("SELECT * FROM read_json_auto({literal})"),
        }
    }

    fn create_temp_table_for_rows(
        conn: &Connection,
        temp_name: &str,
        columns: &[DuckDbColumnDefinition],
    ) -> Result<()> {
        let column_sql = columns
            .iter()
            .map(|column| {
                Self::validate_identifier(&column.name, "Column name")?;
                Self::validate_type_name(&column.duckdb_type)?;
                Ok(format!(
                    "{} {}",
                    Self::quote_identifier(&column.name),
                    column.duckdb_type.trim()
                ))
            })
            .collect::<Result<Vec<_>>>()?
            .join(", ");

        let sql = format!(
            "CREATE TEMP TABLE {} ({})",
            Self::quote_identifier(temp_name),
            column_sql
        );
        conn.execute_batch(&sql)
            .map_err(|e| AppError::DatabaseError(format!("Failed to create staging table: {}", e)))
    }

    fn insert_rows_into_temp(
        conn: &Connection,
        temp_name: &str,
        columns: &[DuckDbColumnDefinition],
        rows: &[Vec<JsonValue>],
    ) -> Result<()> {
        let column_list = columns
            .iter()
            .map(|column| Self::quote_identifier(&column.name))
            .collect::<Vec<_>>()
            .join(", ");
        let cast_list = columns
            .iter()
            .map(|column| {
                Self::validate_type_name(&column.duckdb_type)?;
                Ok(format!("CAST(? AS {})", column.duckdb_type.trim()))
            })
            .collect::<Result<Vec<_>>>()?
            .join(", ");

        let insert_sql = format!(
            "INSERT INTO {} ({}) VALUES ({})",
            Self::quote_identifier(temp_name),
            column_list,
            cast_list
        );
        let mut stmt = conn.prepare(&insert_sql).map_err(|e| {
            AppError::DatabaseError(format!("Failed to prepare staging insert: {}", e))
        })?;

        for row in rows {
            if row.len() != columns.len() {
                return Err(AppError::InvalidInput(format!(
                    "Row column count {} does not match target schema column count {}",
                    row.len(),
                    columns.len()
                )));
            }

            let values = row
                .iter()
                .map(Self::json_to_duckdb_value)
                .collect::<Result<Vec<_>>>()?;

            stmt.execute(params_from_iter(values.iter())).map_err(|e| {
                AppError::DatabaseError(format!(
                    "Failed to insert staging row into `{}`: {}",
                    temp_name, e
                ))
            })?;
        }

        Ok(())
    }

    fn json_to_duckdb_value(value: &JsonValue) -> Result<DuckValue> {
        Ok(match value {
            JsonValue::Null => DuckValue::Null,
            JsonValue::Bool(boolean) => DuckValue::Boolean(*boolean),
            JsonValue::Number(number) => {
                if let Some(int) = number.as_i64() {
                    DuckValue::BigInt(int)
                } else if let Some(uint) = number.as_u64() {
                    DuckValue::UBigInt(uint)
                } else if let Some(float) = number.as_f64() {
                    DuckValue::Double(float)
                } else {
                    DuckValue::Text(number.to_string())
                }
            }
            JsonValue::String(string) => DuckValue::Text(string.clone()),
            JsonValue::Array(_) | JsonValue::Object(_) => DuckValue::Text(
                serde_json::to_string(value)
                    .map_err(|e| AppError::Internal(format!("JSON serialization failed: {}", e)))?,
            ),
        })
    }

    fn row_count_for_table(conn: &Connection, table_name: &str) -> Result<i64> {
        let sql = format!(
            "SELECT COUNT(*) FROM {}",
            Self::quote_identifier(table_name)
        );
        conn.query_row(&sql, [], |row| row.get(0))
            .map_err(|e| AppError::DatabaseError(format!("Failed to count staging rows: {}", e)))
    }

    fn upsert_managed_source(
        conn: &Connection,
        source_id: &str,
        source_kind: &str,
        source_connection_id: Option<&str>,
        source_spec: &JsonValue,
    ) -> Result<()> {
        conn.execute(
            "DELETE FROM querypilot_meta.managed_sources WHERE source_id = ?",
            params![source_id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to clear managed source: {}", e)))?;

        conn.execute(
            r#"
            INSERT INTO querypilot_meta.managed_sources (
              source_id,
              source_kind,
              source_connection_id,
              source_spec
            ) VALUES (?, ?, ?, CAST(? AS JSON))
            "#,
            params![
                source_id,
                source_kind,
                source_connection_id,
                source_spec.to_string()
            ],
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to upsert managed source: {}", e)))?;
        Ok(())
    }

    fn start_refresh_run(
        conn: &Connection,
        run_id: &str,
        target_schema: &str,
        target_name: &str,
    ) -> Result<()> {
        conn.execute(
            r#"
            INSERT INTO querypilot_meta.refresh_runs (
              run_id,
              target_schema,
              target_name,
              started_at,
              status
            ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'running')
            "#,
            params![run_id, target_schema, target_name],
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to insert refresh run: {}", e)))?;
        Ok(())
    }

    fn mark_refresh_success(
        conn: &Connection,
        run_id: &str,
        target_schema: &str,
        target_name: &str,
        source_id: &str,
        object_kind: &str,
        row_count: i64,
    ) -> Result<()> {
        conn.execute(
            "DELETE FROM querypilot_meta.managed_objects WHERE target_schema = ? AND target_name = ?",
            params![target_schema, target_name],
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to clear managed object: {}", e)))?;

        conn.execute(
            r#"
            INSERT INTO querypilot_meta.managed_objects (
              target_schema,
              target_name,
              source_id,
              object_kind,
              last_refresh_at,
              last_refresh_status,
              last_row_count,
              last_error
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'success', ?, NULL)
            "#,
            params![
                target_schema,
                target_name,
                source_id,
                object_kind,
                row_count
            ],
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to upsert managed object: {}", e)))?;

        conn.execute(
            r#"
            UPDATE querypilot_meta.refresh_runs
            SET finished_at = CURRENT_TIMESTAMP,
                status = 'success',
                row_count = ?,
                error = NULL
            WHERE run_id = ?
            "#,
            params![row_count, run_id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to update refresh run: {}", e)))?;
        Ok(())
    }

    fn mark_refresh_failure(
        conn: &Connection,
        run_id: &str,
        target: ManagedObjectTarget<'_>,
        source: ManagedSourceContext<'_>,
        error_message: &str,
    ) -> Result<()> {
        let updated = conn
            .execute(
                r#"
                UPDATE querypilot_meta.managed_objects
                SET last_refresh_at = CURRENT_TIMESTAMP,
                    last_refresh_status = 'failed',
                    last_error = ?
                WHERE target_schema = ? AND target_name = ?
                "#,
                params![error_message, target.target_schema, target.target_name],
            )
            .map_err(|e| {
                AppError::DatabaseError(format!("Failed to update failed managed object: {}", e))
            })?;

        if updated == 0 {
            Self::upsert_managed_source(
                conn,
                source.source_id,
                source.source_kind,
                source.source_connection_id,
                source.source_spec,
            )?;

            conn.execute(
                r#"
                INSERT INTO querypilot_meta.managed_objects (
                  target_schema,
                  target_name,
                  source_id,
                  object_kind,
                  last_refresh_at,
                  last_refresh_status,
                  last_row_count,
                  last_error
                ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'failed', NULL, ?)
                "#,
                params![
                    target.target_schema,
                    target.target_name,
                    source.source_id,
                    target.object_kind,
                    error_message
                ],
            )
            .map_err(|e| {
                AppError::DatabaseError(format!("Failed to store failure status: {}", e))
            })?;
        }

        conn.execute(
            r#"
            UPDATE querypilot_meta.refresh_runs
            SET finished_at = CURRENT_TIMESTAMP,
                status = 'failed',
                error = ?
            WHERE run_id = ?
            "#,
            params![error_message, run_id],
        )
        .map_err(|e| AppError::DatabaseError(format!("Failed to mark refresh failure: {}", e)))?;
        Ok(())
    }

    fn replace_target_from_temp(
        conn: &Connection,
        temp_table: &str,
        target: ManagedObjectTarget<'_>,
        source: ManagedSourceContext<'_>,
        run_id: &str,
        row_count: i64,
    ) -> Result<()> {
        let target_qualified = Self::qualified_name(target.target_schema, target.target_name);
        let temp_qualified = Self::quote_identifier(temp_table);

        conn.execute_batch("BEGIN TRANSACTION")
            .map_err(|e| AppError::DatabaseError(format!("Failed to begin transaction: {}", e)))?;

        let result = (|| {
            let ensure_schema_sql = format!(
                "CREATE SCHEMA IF NOT EXISTS {}",
                Self::quote_identifier(target.target_schema)
            );
            conn.execute_batch(&ensure_schema_sql).map_err(|e| {
                AppError::DatabaseError(format!("Failed to ensure target schema exists: {}", e))
            })?;

            let replace_sql = format!(
                "CREATE OR REPLACE TABLE {} AS SELECT * FROM {}",
                target_qualified, temp_qualified
            );
            conn.execute_batch(&replace_sql).map_err(|e| {
                AppError::DatabaseError(format!("Failed to replace DuckDB target table: {}", e))
            })?;

            Self::upsert_managed_source(
                conn,
                source.source_id,
                source.source_kind,
                source.source_connection_id,
                source.source_spec,
            )?;

            Self::mark_refresh_success(
                conn,
                run_id,
                target.target_schema,
                target.target_name,
                source.source_id,
                target.object_kind,
                row_count,
            )?;

            conn.execute_batch("COMMIT").map_err(|e| {
                AppError::DatabaseError(format!("Failed to commit refresh transaction: {}", e))
            })?;
            Ok(())
        })();

        if let Err(error) = result {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(error);
        }

        Ok(())
    }

    fn load_file_to_temp(
        conn: &Connection,
        file_path: &str,
        temp_name: &str,
    ) -> Result<(DuckDbFileFormat, i64)> {
        Self::ensure_httpfs_loaded(conn, file_path)?;
        let format = Self::detect_file_format(file_path)?;
        let scan_sql = Self::file_scan_sql(file_path, format);
        let create_sql = format!(
            "CREATE TEMP TABLE {} AS {}",
            Self::quote_identifier(temp_name),
            scan_sql
        );
        conn.execute_batch(&create_sql)
            .map_err(|e| AppError::DatabaseError(format!("Failed to import source file: {}", e)))?;
        let row_count = Self::row_count_for_table(conn, temp_name)?;
        Ok((format, row_count))
    }

    fn drop_temp_table(conn: &Connection, temp_name: &str) {
        let _ = conn.execute_batch(&format!(
            "DROP TABLE IF EXISTS {}",
            Self::quote_identifier(temp_name)
        ));
    }

    fn fetch_managed_object_summary(
        conn: &Connection,
        target_schema: &str,
        target_name: &str,
    ) -> Result<DuckDbManagedObjectSummary> {
        conn.query_row(
            r#"
            SELECT
              mo.target_schema,
              mo.target_name,
              mo.object_kind,
              COALESCE(mo.source_id, '') AS source_id,
              COALESCE(ms.source_kind, '') AS source_kind,
              ms.source_connection_id,
              CAST(mo.last_refresh_at AS TEXT),
              mo.last_refresh_status,
              mo.last_row_count,
              mo.last_error
            FROM querypilot_meta.managed_objects mo
            LEFT JOIN querypilot_meta.managed_sources ms
              ON ms.source_id = mo.source_id
            WHERE mo.target_schema = ? AND mo.target_name = ?
            "#,
            params![target_schema, target_name],
            |row| {
                Ok(DuckDbManagedObjectSummary {
                    target_schema: row.get(0)?,
                    target_name: row.get(1)?,
                    object_kind: row.get(2)?,
                    source_id: row.get(3)?,
                    source_kind: row.get(4)?,
                    source_connection_id: row.get(5)?,
                    last_refresh_at: row.get(6)?,
                    last_refresh_status: row.get(7)?,
                    last_row_count: row.get(8)?,
                    last_error: row.get(9)?,
                })
            },
        )
        .map_err(|e| {
            AppError::DatabaseError(format!("Failed to fetch managed object summary: {}", e))
        })
    }

    fn fetch_managed_object_lineage(
        conn: &Connection,
        target_schema: &str,
        target_name: &str,
    ) -> Result<Option<DuckDbManagedObjectLineage>> {
        conn.query_row(
            r#"
            SELECT
              mo.target_schema,
              mo.target_name,
              mo.object_kind,
              COALESCE(mo.source_id, '') AS source_id,
              COALESCE(ms.source_kind, '') AS source_kind,
              ms.source_connection_id,
              CAST(ms.source_spec AS TEXT),
              mo.last_refresh_status,
              CAST(mo.last_refresh_at AS TEXT),
              mo.last_row_count,
              mo.last_error
            FROM querypilot_meta.managed_objects mo
            LEFT JOIN querypilot_meta.managed_sources ms
              ON ms.source_id = mo.source_id
            WHERE mo.target_schema = ? AND mo.target_name = ?
            "#,
            params![target_schema, target_name],
            |row| {
                let source_spec_text: Option<String> = row.get(6)?;
                let source_spec = source_spec_text
                    .as_deref()
                    .map(serde_json::from_str::<JsonValue>)
                    .transpose()
                    .map_err(|e| duckdb::Error::ToSqlConversionFailure(Box::new(e)))?
                    .unwrap_or(JsonValue::Null);

                Ok(DuckDbManagedObjectLineage {
                    target_schema: row.get(0)?,
                    target_name: row.get(1)?,
                    object_kind: row.get(2)?,
                    source_id: row.get(3)?,
                    source_kind: row.get(4)?,
                    source_connection_id: row.get(5)?,
                    source_spec,
                    last_refresh_status: row.get(7)?,
                    last_refresh_at: row.get(8)?,
                    last_row_count: row.get(9)?,
                    last_error: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|e| {
            AppError::DatabaseError(format!("Failed to fetch managed object lineage: {}", e))
        })
    }

    pub async fn add_file(
        &self,
        request: DuckDbAddFileRequest,
    ) -> Result<DuckDbManagedObjectSummary> {
        self.execute_blocking(move |conn| {
            Self::validate_identifier(&request.target_name, "Target name")?;
            let target_schema = Self::normalize_schema(request.target_schema);
            Self::validate_identifier(&target_schema, "Target schema")?;

            let source_id = request
                .source_id
                .unwrap_or_else(|| format!("file:{}", Uuid::new_v4()));
            let run_id = Uuid::new_v4().to_string();
            let temp_name = Self::temp_table_name("qp_file_stage");

            let source_spec = json!({
                "filePath": request.file_path,
                "format": Self::file_format_name(Self::detect_file_format(&request.file_path)?),
                "mode": "persist_table",
            });

            Self::start_refresh_run(conn, &run_id, &target_schema, &request.target_name)?;

            let import_result = Self::load_file_to_temp(conn, &request.file_path, &temp_name);
            let row_count = match import_result {
                Ok((_format, row_count)) => row_count,
                Err(error) => {
                    let message = error.to_string();
                    let _ = Self::mark_refresh_failure(
                        conn,
                        &run_id,
                        ManagedObjectTarget {
                            target_schema: &target_schema,
                            target_name: &request.target_name,
                            object_kind: "file_import",
                        },
                        ManagedSourceContext {
                            source_id: &source_id,
                            source_kind: "file",
                            source_connection_id: None,
                            source_spec: &source_spec,
                        },
                        &message,
                    );
                    return Err(error);
                }
            };

            let replace_result = Self::replace_target_from_temp(
                conn,
                &temp_name,
                ManagedObjectTarget {
                    target_schema: &target_schema,
                    target_name: &request.target_name,
                    object_kind: "file_import",
                },
                ManagedSourceContext {
                    source_id: &source_id,
                    source_kind: "file",
                    source_connection_id: None,
                    source_spec: &source_spec,
                },
                &run_id,
                row_count,
            );
            Self::drop_temp_table(conn, &temp_name);

            if let Err(error) = replace_result {
                let message = error.to_string();
                let _ = Self::mark_refresh_failure(
                    conn,
                    &run_id,
                    ManagedObjectTarget {
                        target_schema: &target_schema,
                        target_name: &request.target_name,
                        object_kind: "file_import",
                    },
                    ManagedSourceContext {
                        source_id: &source_id,
                        source_kind: "file",
                        source_connection_id: None,
                        source_spec: &source_spec,
                    },
                    &message,
                );
                return Err(error);
            }

            Self::fetch_managed_object_summary(conn, &target_schema, &request.target_name)
        })
        .await
    }

    pub async fn replace_managed_object(
        &self,
        request: DuckDbReplaceManagedObjectRequest,
    ) -> Result<DuckDbManagedObjectSummary> {
        self.execute_blocking(move |conn| {
            Self::validate_identifier(&request.target_schema, "Target schema")?;
            Self::validate_identifier(&request.target_name, "Target name")?;
            if request.columns.is_empty() {
                return Err(AppError::InvalidInput(
                    "Managed object replace requires at least one column".to_string(),
                ));
            }

            let run_id = Uuid::new_v4().to_string();
            let temp_name = Self::temp_table_name("qp_rows_stage");

            Self::start_refresh_run(conn, &run_id, &request.target_schema, &request.target_name)?;

            let stage_result = (|| {
                Self::create_temp_table_for_rows(conn, &temp_name, &request.columns)?;
                Self::insert_rows_into_temp(conn, &temp_name, &request.columns, &request.rows)?;
                Self::row_count_for_table(conn, &temp_name)
            })();

            let row_count = match stage_result {
                Ok(row_count) => row_count,
                Err(error) => {
                    Self::drop_temp_table(conn, &temp_name);
                    let message = error.to_string();
                    let _ = Self::mark_refresh_failure(
                        conn,
                        &run_id,
                        ManagedObjectTarget {
                            target_schema: &request.target_schema,
                            target_name: &request.target_name,
                            object_kind: &request.object_kind,
                        },
                        ManagedSourceContext {
                            source_id: &request.source_id,
                            source_kind: &request.source_kind,
                            source_connection_id: request.source_connection_id.as_deref(),
                            source_spec: &request.source_spec,
                        },
                        &message,
                    );
                    return Err(error);
                }
            };

            let replace_result = Self::replace_target_from_temp(
                conn,
                &temp_name,
                ManagedObjectTarget {
                    target_schema: &request.target_schema,
                    target_name: &request.target_name,
                    object_kind: &request.object_kind,
                },
                ManagedSourceContext {
                    source_id: &request.source_id,
                    source_kind: &request.source_kind,
                    source_connection_id: request.source_connection_id.as_deref(),
                    source_spec: &request.source_spec,
                },
                &run_id,
                row_count,
            );
            Self::drop_temp_table(conn, &temp_name);

            if let Err(error) = replace_result {
                let message = error.to_string();
                let _ = Self::mark_refresh_failure(
                    conn,
                    &run_id,
                    ManagedObjectTarget {
                        target_schema: &request.target_schema,
                        target_name: &request.target_name,
                        object_kind: &request.object_kind,
                    },
                    ManagedSourceContext {
                        source_id: &request.source_id,
                        source_kind: &request.source_kind,
                        source_connection_id: request.source_connection_id.as_deref(),
                        source_spec: &request.source_spec,
                    },
                    &message,
                );
                return Err(error);
            }

            Self::fetch_managed_object_summary(conn, &request.target_schema, &request.target_name)
        })
        .await
    }

    pub async fn list_managed_objects(&self) -> Result<Vec<DuckDbManagedObjectSummary>> {
        self.execute_blocking(|conn| {
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT
                      mo.target_schema,
                      mo.target_name,
                      mo.object_kind,
                      COALESCE(mo.source_id, '') AS source_id,
                      COALESCE(ms.source_kind, '') AS source_kind,
                      ms.source_connection_id,
                      CAST(mo.last_refresh_at AS TEXT),
                      mo.last_refresh_status,
                      mo.last_row_count,
                      mo.last_error
                    FROM querypilot_meta.managed_objects mo
                    LEFT JOIN querypilot_meta.managed_sources ms
                      ON ms.source_id = mo.source_id
                    ORDER BY mo.target_schema, mo.target_name
                    "#,
                )
                .map_err(|e| {
                    AppError::DatabaseError(format!(
                        "Failed to prepare managed objects query: {}",
                        e
                    ))
                })?;

            let mut rows = stmt.query([]).map_err(|e| {
                AppError::DatabaseError(format!("Failed to query managed objects: {}", e))
            })?;

            let mut managed = Vec::new();
            while let Some(row) = rows.next().map_err(|e| {
                AppError::DatabaseError(format!("Failed to fetch managed object row: {}", e))
            })? {
                managed.push(DuckDbManagedObjectSummary {
                    target_schema: row.get(0).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read target schema: {}", e))
                    })?,
                    target_name: row.get(1).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read target name: {}", e))
                    })?,
                    object_kind: row.get(2).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read object kind: {}", e))
                    })?,
                    source_id: row.get(3).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read source id: {}", e))
                    })?,
                    source_kind: row.get(4).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read source kind: {}", e))
                    })?,
                    source_connection_id: row.get(5).map_err(|e| {
                        AppError::DatabaseError(format!(
                            "Failed to read source connection id: {}",
                            e
                        ))
                    })?,
                    last_refresh_at: row.get(6).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read refresh timestamp: {}", e))
                    })?,
                    last_refresh_status: row.get(7).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read refresh status: {}", e))
                    })?,
                    last_row_count: row.get(8).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read row count: {}", e))
                    })?,
                    last_error: row.get(9).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read refresh error: {}", e))
                    })?,
                });
            }

            Ok(managed)
        })
        .await
    }

    pub async fn get_object_lineage(
        &self,
        target_schema: String,
        target_name: String,
    ) -> Result<Option<DuckDbManagedObjectLineage>> {
        self.execute_blocking(move |conn| {
            Self::fetch_managed_object_lineage(conn, &target_schema, &target_name)
        })
        .await
    }

    pub async fn list_extensions(&self) -> Result<Vec<DuckDbExtensionInfo>> {
        self.execute_blocking(|conn| {
            let mut stmt = conn.prepare(
                "SELECT extension_name, loaded, installed, description, install_path FROM duckdb_extensions() ORDER BY extension_name"
            ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let mut rows = stmt.query([]).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let mut extensions = Vec::new();
            while let Some(row) = rows.next().map_err(|e| AppError::DatabaseError(e.to_string()))? {
                extensions.push(DuckDbExtensionInfo {
                    extension_name: row.get(0).map_err(|e| AppError::DatabaseError(e.to_string()))?,
                    loaded: row.get(1).map_err(|e| AppError::DatabaseError(e.to_string()))?,
                    installed: row.get(2).map_err(|e| AppError::DatabaseError(e.to_string()))?,
                    description: row.get(3).ok(),
                    install_path: row.get(4).ok(),
                });
            }
            Ok(extensions)
        }).await
    }

    pub async fn install_extension(&self, name: &str) -> Result<()> {
        if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err(AppError::InvalidInput(format!(
                "Invalid extension name: {}. Only alphanumeric characters and underscores allowed.",
                name
            )));
        }
        let name = name.to_string();
        self.execute_blocking(move |conn| {
            conn.execute_batch(&format!("INSTALL '{}'; LOAD '{}';", name, name))
                .map_err(|e| {
                    AppError::DatabaseError(format!("Failed to install extension: {}", e))
                })?;
            Ok(())
        })
        .await
    }

    pub async fn load_extension(&self, name: &str) -> Result<()> {
        if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err(AppError::InvalidInput(format!(
                "Invalid extension name: {}. Only alphanumeric characters and underscores allowed.",
                name
            )));
        }
        let name = name.to_string();
        self.execute_blocking(move |conn| {
            conn.execute_batch(&format!("LOAD '{}'", name))
                .map_err(|e| {
                    AppError::DatabaseError(format!("Failed to load extension: {}", e))
                })?;
            Ok(())
        })
        .await
    }

    fn is_multi_statement(sql: &str) -> bool {
        let trimmed = sql.trim();
        let mut in_single_quote = false;
        let mut in_double_quote = false;
        let mut semicolons = 0;
        let mut chars = trimmed.chars().peekable();

        while let Some(ch) = chars.next() {
            match ch {
                '\'' if !in_double_quote => {
                    in_single_quote = !in_single_quote;
                }
                '"' if !in_single_quote => {
                    in_double_quote = !in_double_quote;
                }
                ';' if !in_single_quote && !in_double_quote => {
                    semicolons += 1;
                }
                '-' if !in_single_quote && !in_double_quote => {
                    if chars.peek() == Some(&'-') {
                        for c in chars.by_ref() {
                            if c == '\n' {
                                break;
                            }
                        }
                    }
                }
                '/' if !in_single_quote && !in_double_quote => {
                    if chars.peek() == Some(&'*') {
                        chars.next();
                        let mut prev = ' ';
                        for c in chars.by_ref() {
                            if prev == '*' && c == '/' {
                                break;
                            }
                            prev = c;
                        }
                    }
                }
                '$' if !in_single_quote && !in_double_quote => {
                    if chars.peek() == Some(&'$') {
                        chars.next(); // consume second $
                                      // Skip until matching $$
                        loop {
                            match chars.next() {
                                Some('$') if chars.peek() == Some(&'$') => {
                                    chars.next(); // consume second $
                                    break;
                                }
                                Some(_) => continue,
                                None => break, // unterminated dollar quote
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if semicolons > 1 {
            return true;
        }

        let upper = trimmed.to_uppercase();
        let first_word = upper.split_whitespace().next().unwrap_or("");
        first_word == "BEGIN" || first_word == "START"
    }

    fn column_type_name(stmt: &duckdb::Statement<'_>, index: usize) -> String {
        let logical_type = stmt.column_logical_type(index);
        match logical_type.id() {
            LogicalTypeId::Boolean => "BOOLEAN".to_string(),
            LogicalTypeId::Tinyint => "TINYINT".to_string(),
            LogicalTypeId::Smallint => "SMALLINT".to_string(),
            LogicalTypeId::Integer | LogicalTypeId::IntegerLiteral => "INTEGER".to_string(),
            LogicalTypeId::Bigint => "BIGINT".to_string(),
            LogicalTypeId::UTinyint => "UTINYINT".to_string(),
            LogicalTypeId::USmallint => "USMALLINT".to_string(),
            LogicalTypeId::UInteger => "UINTEGER".to_string(),
            LogicalTypeId::UBigint => "UBIGINT".to_string(),
            LogicalTypeId::Hugeint => "HUGEINT".to_string(),
            LogicalTypeId::UHugeint => "UHUGEINT".to_string(),
            LogicalTypeId::Float => "FLOAT".to_string(),
            LogicalTypeId::Double => "DOUBLE".to_string(),
            LogicalTypeId::Decimal => {
                let width = logical_type.decimal_width();
                let scale = logical_type.decimal_scale();
                if width > 0 {
                    format!("DECIMAL({}, {})", width, scale)
                } else {
                    "DECIMAL".to_string()
                }
            }
            LogicalTypeId::Timestamp => "TIMESTAMP".to_string(),
            LogicalTypeId::TimestampS => "TIMESTAMP_S".to_string(),
            LogicalTypeId::TimestampMs => "TIMESTAMP_MS".to_string(),
            LogicalTypeId::TimestampNs => "TIMESTAMP_NS".to_string(),
            LogicalTypeId::TimestampTZ => "TIMESTAMPTZ".to_string(),
            LogicalTypeId::Date => "DATE".to_string(),
            LogicalTypeId::Time | LogicalTypeId::TimeNs => "TIME".to_string(),
            LogicalTypeId::TimeTZ => "TIMETZ".to_string(),
            LogicalTypeId::Interval => "INTERVAL".to_string(),
            LogicalTypeId::Varchar | LogicalTypeId::StringLiteral => "VARCHAR".to_string(),
            LogicalTypeId::Blob => "BLOB".to_string(),
            LogicalTypeId::Uuid => "UUID".to_string(),
            LogicalTypeId::Enum => "ENUM".to_string(),
            LogicalTypeId::List => "LIST".to_string(),
            LogicalTypeId::Struct => "STRUCT".to_string(),
            LogicalTypeId::Map => "MAP".to_string(),
            LogicalTypeId::Array => "ARRAY".to_string(),
            LogicalTypeId::Union => "UNION".to_string(),
            LogicalTypeId::Bit => "BIT".to_string(),
            LogicalTypeId::Bignum => "BIGNUM".to_string(),
            LogicalTypeId::SqlNull => "NULL".to_string(),
            LogicalTypeId::Any => "ANY".to_string(),
            LogicalTypeId::Invalid => "INVALID".to_string(),
            LogicalTypeId::Unsupported => format!("{:?}", stmt.column_type(index)).to_uppercase(),
            _ => format!("{:?}", stmt.column_type(index)).to_uppercase(),
        }
    }

    fn value_ref_to_json(value: ValueRef<'_>) -> JsonValue {
        match value {
            ValueRef::Null => JsonValue::Null,
            ValueRef::Boolean(v) => JsonValue::Bool(v),
            ValueRef::TinyInt(v) => JsonValue::Number(JsonNumber::from(v)),
            ValueRef::SmallInt(v) => JsonValue::Number(JsonNumber::from(v)),
            ValueRef::Int(v) => JsonValue::Number(JsonNumber::from(v)),
            ValueRef::BigInt(v) => {
                if !(-MAX_SAFE_JS_INTEGER_I64..=MAX_SAFE_JS_INTEGER_I64).contains(&v) {
                    JsonValue::String(v.to_string())
                } else {
                    JsonValue::Number(JsonNumber::from(v))
                }
            }
            ValueRef::UTinyInt(v) => JsonValue::Number(JsonNumber::from(v)),
            ValueRef::USmallInt(v) => JsonValue::Number(JsonNumber::from(v)),
            ValueRef::UInt(v) => JsonValue::Number(JsonNumber::from(v)),
            ValueRef::UBigInt(v) => {
                if v > MAX_SAFE_JS_INTEGER_U64 {
                    JsonValue::String(v.to_string())
                } else {
                    JsonValue::Number(JsonNumber::from(v))
                }
            }
            ValueRef::Float(v) => {
                if v.is_nan() {
                    JsonValue::String("NaN".to_string())
                } else if v.is_infinite() {
                    JsonValue::String(if v > 0.0 { "Infinity" } else { "-Infinity" }.to_string())
                } else {
                    JsonNumber::from_f64(v as f64)
                        .map(JsonValue::Number)
                        .unwrap_or(JsonValue::Null)
                }
            }
            ValueRef::Double(v) => {
                if v.is_nan() {
                    JsonValue::String("NaN".to_string())
                } else if v.is_infinite() {
                    JsonValue::String(if v > 0.0 { "Infinity" } else { "-Infinity" }.to_string())
                } else {
                    JsonNumber::from_f64(v)
                        .map(JsonValue::Number)
                        .unwrap_or(JsonValue::Null)
                }
            }
            ValueRef::HugeInt(v) => JsonValue::String(v.to_string()),
            ValueRef::Decimal(v) => JsonValue::String(v.to_string()),
            ValueRef::Timestamp(unit, value) => {
                JsonValue::Number(JsonNumber::from(unit.to_micros(value)))
            }
            ValueRef::Text(v) => JsonValue::String(String::from_utf8_lossy(v).into_owned()),
            ValueRef::Blob(v) => JsonValue::String(BASE64_STANDARD.encode(v)),
            ValueRef::Date32(v) => JsonValue::Number(JsonNumber::from(v)),
            ValueRef::Time64(unit, value) => {
                JsonValue::Number(JsonNumber::from(unit.to_micros(value)))
            }
            ValueRef::Interval {
                months,
                days,
                nanos,
            } => JsonValue::Object(JsonMap::from_iter([
                (
                    "months".to_string(),
                    JsonValue::Number(JsonNumber::from(months)),
                ),
                (
                    "days".to_string(),
                    JsonValue::Number(JsonNumber::from(days)),
                ),
                (
                    "nanos".to_string(),
                    JsonValue::Number(JsonNumber::from(nanos)),
                ),
            ])),
            complex => {
                let owned = complex.to_owned();
                Self::owned_value_to_json(owned)
            }
        }
    }

    fn owned_value_to_json(value: DuckValue) -> JsonValue {
        match value {
            DuckValue::Null => JsonValue::Null,
            DuckValue::Boolean(v) => JsonValue::Bool(v),
            DuckValue::TinyInt(v) => JsonValue::Number(JsonNumber::from(v)),
            DuckValue::SmallInt(v) => JsonValue::Number(JsonNumber::from(v)),
            DuckValue::Int(v) => JsonValue::Number(JsonNumber::from(v)),
            DuckValue::BigInt(v) => {
                if !(-MAX_SAFE_JS_INTEGER_I64..=MAX_SAFE_JS_INTEGER_I64).contains(&v) {
                    JsonValue::String(v.to_string())
                } else {
                    JsonValue::Number(JsonNumber::from(v))
                }
            }
            DuckValue::UTinyInt(v) => JsonValue::Number(JsonNumber::from(v)),
            DuckValue::USmallInt(v) => JsonValue::Number(JsonNumber::from(v)),
            DuckValue::UInt(v) => JsonValue::Number(JsonNumber::from(v)),
            DuckValue::UBigInt(v) => {
                if v > MAX_SAFE_JS_INTEGER_U64 {
                    JsonValue::String(v.to_string())
                } else {
                    JsonValue::Number(JsonNumber::from(v))
                }
            }
            DuckValue::Float(v) => {
                if v.is_nan() {
                    JsonValue::String("NaN".to_string())
                } else if v.is_infinite() {
                    JsonValue::String(if v > 0.0 { "Infinity" } else { "-Infinity" }.to_string())
                } else {
                    JsonNumber::from_f64(v as f64)
                        .map(JsonValue::Number)
                        .unwrap_or(JsonValue::Null)
                }
            }
            DuckValue::Double(v) => {
                if v.is_nan() {
                    JsonValue::String("NaN".to_string())
                } else if v.is_infinite() {
                    JsonValue::String(if v > 0.0 { "Infinity" } else { "-Infinity" }.to_string())
                } else {
                    JsonNumber::from_f64(v)
                        .map(JsonValue::Number)
                        .unwrap_or(JsonValue::Null)
                }
            }
            DuckValue::HugeInt(v) => JsonValue::String(v.to_string()),
            DuckValue::Decimal(v) => JsonValue::String(v.to_string()),
            DuckValue::Timestamp(unit, v) => JsonValue::Number(JsonNumber::from(unit.to_micros(v))),
            DuckValue::Text(v) => JsonValue::String(v),
            DuckValue::Blob(v) => JsonValue::String(BASE64_STANDARD.encode(v)),
            DuckValue::Date32(v) => JsonValue::Number(JsonNumber::from(v)),
            DuckValue::Time64(unit, v) => JsonValue::Number(JsonNumber::from(unit.to_micros(v))),
            DuckValue::Interval {
                months,
                days,
                nanos,
            } => JsonValue::Object(JsonMap::from_iter([
                (
                    "months".to_string(),
                    JsonValue::Number(JsonNumber::from(months)),
                ),
                (
                    "days".to_string(),
                    JsonValue::Number(JsonNumber::from(days)),
                ),
                (
                    "nanos".to_string(),
                    JsonValue::Number(JsonNumber::from(nanos)),
                ),
            ])),
            DuckValue::Enum(v) => JsonValue::String(v),
            DuckValue::List(items) | DuckValue::Array(items) => {
                JsonValue::Array(items.into_iter().map(Self::owned_value_to_json).collect())
            }
            DuckValue::Struct(fields) => {
                let mut map = JsonMap::new();
                for (key, val) in fields.iter() {
                    map.insert(key.clone(), Self::owned_value_to_json(val.clone()));
                }
                JsonValue::Object(map)
            }
            DuckValue::Map(entries) => {
                let mut map = JsonMap::new();
                for (key, val) in entries.iter() {
                    let key_str = match key {
                        DuckValue::Text(s) => s.clone(),
                        other => format!("{other:?}"),
                    };
                    map.insert(key_str, Self::owned_value_to_json(val.clone()));
                }
                JsonValue::Object(map)
            }
            DuckValue::Union(inner) => Self::owned_value_to_json(*inner),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbSecretInfo {
    pub name: String,
    pub secret_type: String,
    pub provider: String,
    pub scope: Vec<String>,
    pub persistent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbCreateSecretRequest {
    pub name: String,
    pub secret_type: String,
    pub provider: String,
    pub scope: Option<String>,
    pub persistent: bool,
    pub params: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbAttachedDatabase {
    pub database_name: String,
    pub path: String,
    pub db_type: String,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbAttachDatabaseRequest {
    pub path: String,
    pub alias: String,
    pub db_type: Option<String>,
    pub read_only: bool,
}

impl DuckDbAdapter {
    fn validate_attach_alias(alias: &str) -> Result<()> {
        if alias.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Alias must not be empty".to_string(),
            ));
        }
        if !alias
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_')
        {
            return Err(AppError::InvalidInput(format!(
                "Alias '{}' contains invalid characters. Only alphanumeric and underscores allowed.",
                alias
            )));
        }
        Ok(())
    }

    pub async fn attach_database(&self, request: DuckDbAttachDatabaseRequest) -> Result<String> {
        let alias = request.alias.clone();
        self.execute_blocking(move |conn| {
            Self::validate_attach_alias(&request.alias)?;

            let mut sql = format!(
                "ATTACH {} AS {}",
                Self::quote_string_literal(&request.path),
                Self::quote_identifier(&request.alias),
            );

            let mut options = Vec::new();
            if let Some(ref db_type) = request.db_type {
                let upper = db_type.trim().to_uppercase();
                if !["POSTGRES", "MYSQL", "SQLITE", "DUCKDB"].contains(&upper.as_str()) {
                    return Err(AppError::InvalidInput(format!(
                        "Unsupported ATTACH database type: {}",
                        db_type
                    )));
                }
                options.push(format!("TYPE {}", upper));
            }
            if request.read_only {
                options.push("READ_ONLY".to_string());
            }
            if !options.is_empty() {
                sql.push_str(&format!(" ({})", options.join(", ")));
            }

            conn.execute_batch(&sql).map_err(|e| {
                AppError::DatabaseError(format!("Failed to attach database: {}", e))
            })?;

            Ok(request.alias)
        })
        .await
    }

    pub async fn detach_database(&self, alias: String) -> Result<()> {
        self.execute_blocking(move |conn| {
            Self::validate_attach_alias(&alias)?;
            let sql = format!("DETACH {}", Self::quote_identifier(&alias));
            conn.execute_batch(&sql).map_err(|e| {
                AppError::DatabaseError(format!("Failed to detach database: {}", e))
            })?;
            Ok(())
        })
        .await
    }

    pub async fn list_attached_databases(&self) -> Result<Vec<DuckDbAttachedDatabase>> {
        self.execute_blocking(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT database_name, path, type, readonly \
                     FROM duckdb_databases() \
                     WHERE NOT internal \
                     ORDER BY database_name",
                )
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            let mut rows = stmt
                .query([])
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            let mut databases = Vec::new();
            while let Some(row) =
                rows.next()
                    .map_err(|e| AppError::DatabaseError(e.to_string()))?
            {
                databases.push(DuckDbAttachedDatabase {
                    database_name: row
                        .get(0)
                        .map_err(|e| AppError::DatabaseError(e.to_string()))?,
                    path: row
                        .get::<_, Option<String>>(1)
                        .map_err(|e| AppError::DatabaseError(e.to_string()))?
                        .unwrap_or_default(),
                    db_type: row
                        .get::<_, Option<String>>(2)
                        .map_err(|e| AppError::DatabaseError(e.to_string()))?
                        .unwrap_or_default(),
                    read_only: row
                        .get(3)
                        .map_err(|e| AppError::DatabaseError(e.to_string()))?,
                });
            }

            Ok(databases)
        })
        .await
    }
}

impl DuckDbAdapter {
    fn validate_export_format(format: &str) -> Result<()> {
        match format.to_uppercase().as_str() {
            "PARQUET" | "CSV" | "JSON" => Ok(()),
            _ => Err(AppError::InvalidInput(format!(
                "Unsupported export format '{}'. Must be PARQUET, CSV, or JSON.",
                format
            ))),
        }
    }

    fn build_copy_options(format: &str, options: &HashMap<String, String>) -> String {
        let mut parts = vec![format!("FORMAT {}", format.to_uppercase())];
        for (key, value) in options {
            let key_upper = key.to_uppercase();
            let val_trimmed = value.trim();
            if val_trimmed.is_empty() {
                continue;
            }
            match val_trimmed.to_uppercase().as_str() {
                "TRUE" | "FALSE" => parts.push(format!("{} {}", key_upper, val_trimmed)),
                _ => {
                    if val_trimmed.parse::<i64>().is_ok() || val_trimmed.parse::<f64>().is_ok() {
                        parts.push(format!("{} {}", key_upper, val_trimmed));
                    } else {
                        parts.push(format!(
                            "{} {}",
                            key_upper,
                            Self::quote_string_literal(val_trimmed)
                        ));
                    }
                }
            }
        }
        parts.join(", ")
    }

    pub async fn export_data(&self, request: DuckDbExportRequest) -> Result<DuckDbExportResult> {
        self.execute_blocking(move |conn| {
            Self::validate_export_format(&request.format)?;

            if request.destination.trim().is_empty() {
                return Err(AppError::InvalidInput(
                    "Export destination must not be empty".to_string(),
                ));
            }

            Self::ensure_httpfs_loaded(conn, &request.destination)?;

            let source_sql = match &request.source {
                DuckDbExportSource::Query(sql) => {
                    if sql.trim().is_empty() {
                        return Err(AppError::InvalidInput(
                            "Export query must not be empty".to_string(),
                        ));
                    }
                    format!("({})", sql)
                }
                DuckDbExportSource::Table { schema, name } => {
                    Self::validate_identifier(schema, "Schema")?;
                    Self::validate_identifier(name, "Table name")?;
                    Self::qualified_name(schema, name)
                }
            };

            let count_sql = match &request.source {
                DuckDbExportSource::Query(sql) => {
                    format!("SELECT count(*) FROM ({})", sql)
                }
                DuckDbExportSource::Table { schema, name } => {
                    format!("SELECT count(*) FROM {}", Self::qualified_name(schema, name))
                }
            };
            let rows_exported: i64 = conn
                .query_row(&count_sql, [], |row| row.get(0))
                .map_err(|e| {
                    AppError::DatabaseError(format!("Failed to count export rows: {}", e))
                })?;

            let options_str = Self::build_copy_options(&request.format, &request.options);
            let copy_sql = format!(
                "COPY {} TO {} ({})",
                source_sql,
                Self::quote_string_literal(&request.destination),
                options_str
            );

            conn.execute_batch(&copy_sql).map_err(|e| {
                AppError::DatabaseError(format!("COPY TO failed: {}", e))
            })?;

            Ok(DuckDbExportResult {
                rows_exported,
                destination: request.destination,
                format: request.format.to_uppercase(),
            })
        })
        .await
    }
}

impl DuckDbAdapter {
    pub async fn create_secret(&self, request: DuckDbCreateSecretRequest) -> Result<()> {
        self.execute_blocking(move |conn| {
            Self::validate_identifier(&request.name, "Secret name")?;

            let persistence = if request.persistent {
                "PERSISTENT"
            } else {
                "TEMPORARY"
            };

            let mut clauses = Vec::new();
            clauses.push(format!("TYPE {}", request.secret_type));
            clauses.push(format!(
                "PROVIDER {}",
                Self::quote_string_literal(&request.provider)
            ));

            for (key, value) in &request.params {
                if !value.is_empty() {
                    clauses.push(format!("{} {}", key, Self::quote_string_literal(value)));
                }
            }

            if let Some(ref scope) = request.scope {
                if !scope.trim().is_empty() {
                    clauses.push(format!("SCOPE {}", Self::quote_string_literal(scope)));
                }
            }

            let sql = format!(
                "CREATE {} SECRET {} ({})",
                persistence,
                Self::quote_identifier(&request.name),
                clauses.join(", ")
            );

            conn.execute_batch(&sql).map_err(|e| {
                AppError::DatabaseError(format!("Failed to create secret: {}", e))
            })?;

            Ok(())
        })
        .await
    }

    pub async fn list_secrets(&self) -> Result<Vec<DuckDbSecretInfo>> {
        self.execute_blocking(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT name, type, provider, scope, persistent FROM duckdb_secrets()",
                )
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            let mut rows = stmt
                .query([])
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            let mut secrets = Vec::new();
            while let Some(row) =
                rows.next()
                    .map_err(|e| AppError::DatabaseError(e.to_string()))?
            {
                let name: String = row
                    .get(0)
                    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
                let secret_type: String = row
                    .get(1)
                    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
                let provider: String = row
                    .get(2)
                    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

                let scope_ref = row
                    .get_ref(3)
                    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
                let scope = match scope_ref.to_owned() {
                    DuckValue::List(items) | DuckValue::Array(items) => items
                        .into_iter()
                        .filter_map(|v| match v {
                            DuckValue::Text(s) => Some(s),
                            _ => None,
                        })
                        .collect(),
                    DuckValue::Text(s) => vec![s],
                    _ => vec![],
                };

                let persistent: bool = row
                    .get(4)
                    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

                secrets.push(DuckDbSecretInfo {
                    name,
                    secret_type,
                    provider,
                    scope,
                    persistent,
                });
            }

            Ok(secrets)
        })
        .await
    }

    pub async fn drop_secret(&self, name: String, persistent: bool) -> Result<()> {
        self.execute_blocking(move |conn| {
            Self::validate_identifier(&name, "Secret name")?;

            let sql = if persistent {
                format!("DROP PERSISTENT SECRET {}", Self::quote_identifier(&name))
            } else {
                format!("DROP SECRET {}", Self::quote_identifier(&name))
            };

            conn.execute_batch(&sql).map_err(|e| {
                AppError::DatabaseError(format!("Failed to drop secret: {}", e))
            })?;

            Ok(())
        })
        .await
    }
}

impl DuckDbAdapter {
    pub async fn connect_motherduck(&self, profile: &ConnectionProfile) -> Result<()> {
        if self.is_conn_open().await {
            self.disconnect().await?;
        }

        let token = profile
            .password
            .clone()
            .unwrap_or_default();
        let database = profile.database.clone();

        let conn = tokio::task::spawn_blocking(move || {
            let config = Config::default()
                .enable_autoload_extension(true)
                .map_err(|e| {
                    AppError::Internal(format!("Failed to enable DuckDB extension autoload: {}", e))
                })?
                .enable_external_access(true)
                .map_err(|e| {
                    AppError::Internal(format!("Failed to enable DuckDB external access: {}", e))
                })?;

            let conn = Connection::open_in_memory_with_flags(config).map_err(|e| {
                AppError::Internal(format!("Failed to open in-memory DuckDB: {}", e))
            })?;

            conn.execute_batch("INSTALL motherduck; LOAD motherduck;")
                .map_err(|e| {
                    AppError::DatabaseError(format!("Failed to load MotherDuck extension: {}", e))
                })?;

            let set_token_sql = format!(
                "SET motherduck_token = {}",
                Self::quote_string_literal(&token)
            );
            conn.execute_batch(&set_token_sql).map_err(|e| {
                AppError::DatabaseError(format!("Failed to set MotherDuck token: {}", e))
            })?;

            let attach_target = if database.is_empty() {
                "md:".to_string()
            } else {
                format!("md:{}", database)
            };
            let attach_sql = format!(
                "ATTACH {}",
                Self::quote_string_literal(&attach_target)
            );
            conn.execute_batch(&attach_sql).map_err(|e| {
                AppError::DatabaseError(format!("Failed to attach MotherDuck database: {}", e))
            })?;

            Ok::<Connection, AppError>(conn)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))??;

        *self.connection.lock().await = Some(conn);
        *self.db_path.lock().await = None;
        Ok(())
    }
}

impl Default for DuckDbAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseCapability for DuckDbAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<()> {
        if profile.db_type == DbType::MotherDuck {
            return self.connect_motherduck(profile).await;
        }

        if self.is_conn_open().await {
            self.disconnect().await?;
        }

        let read_only = profile
            .options
            .get("read_only")
            .map(|v| v == "true")
            .unwrap_or(false);

        let db_path = PathBuf::from(&profile.database);
        let path = db_path.clone();

        let conn = tokio::task::spawn_blocking(move || {
            let access_mode = if read_only {
                AccessMode::ReadOnly
            } else {
                AccessMode::ReadWrite
            };

            let config = Config::default()
                .access_mode(access_mode)
                .map_err(|e| {
                    AppError::Internal(format!("Failed to set DuckDB access mode: {}", e))
                })?
                .enable_autoload_extension(true)
                .map_err(|e| {
                    AppError::Internal(format!("Failed to enable DuckDB extension autoload: {}", e))
                })?
                .enable_external_access(true)
                .map_err(|e| {
                    AppError::Internal(format!("Failed to enable DuckDB external access: {}", e))
                })?;

            let conn = Connection::open_with_flags(&path, config).map_err(|e| {
                AppError::Internal(format!("Failed to open DuckDB database: {}", e))
            })?;

            if !read_only {
                Self::bootstrap_connection(&conn)?;
            }

            Ok::<Connection, AppError>(conn)
        })
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))??;

        *self.connection.lock().await = Some(conn);
        *self.db_path.lock().await = Some(db_path);
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        let conn = self.connection.lock().await.take();
        if let Some(conn) = conn {
            tokio::task::spawn_blocking(move || {
                drop(conn);
            })
            .await
            .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?;
        }
        *self.db_path.lock().await = None;
        Ok(())
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult> {
        let start = std::time::Instant::now();
        let version = self.execute_blocking(|conn| {
            let version: String = conn
                .query_row("SELECT version()", [], |row| row.get(0))
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;
            Ok(version)
        });

        let version = tokio::time::timeout(std::time::Duration::from_secs(10), version)
            .await
            .map_err(|_| AppError::ConnectionClosed("Connection test timed out".into()))??;

        Ok(CapabilityTestResult {
            success: true,
            message: "Connected to DuckDB database".to_string(),
            latency_ms: Some(start.elapsed().as_millis() as u64),
            server_version: Some(version),
        })
    }

    fn is_connected(&self) -> bool {
        self.connection
            .try_lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![
            AdapterCapability::SqlQueryable,
            AdapterCapability::BackupCapable,
        ]
    }
}

impl DuckDbAdapter {
    /// Execute a query and return results in progressively larger chunks.
    /// Batch sizes ramp up: 16, 64, 256, 1024, 2048 rows per chunk.
    pub async fn execute_query_chunked(
        &self,
        sql: &str,
    ) -> Result<(Vec<CapabilityColumnMeta>, Vec<Vec<Vec<JsonValue>>>)> {
        let sql = sql.to_string();
        self.execute_blocking(move |conn| {
            if Self::is_multi_statement(&sql) {
                conn.execute_batch(&sql)
                    .map_err(|e| AppError::DatabaseError(format!("Batch execute failed: {}", e)))?;
                return Ok((
                    vec![CapabilityColumnMeta {
                        name: "result".to_string(),
                        data_type: "TEXT".to_string(),
                    }],
                    vec![vec![vec![JsonValue::String(
                        "Batch executed successfully".to_string(),
                    )]]],
                ));
            }

            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;
            let mut result_rows = stmt
                .query([])
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;
            let stmt_ref = result_rows
                .as_ref()
                .ok_or_else(|| AppError::DatabaseError("No statement handle".to_string()))?;
            let column_count = stmt_ref.column_count();
            let columns: Vec<CapabilityColumnMeta> = (0..column_count)
                .map(|i| CapabilityColumnMeta {
                    name: stmt_ref
                        .column_name(i)
                        .map_or("?", |name| name.as_str())
                        .to_string(),
                    data_type: Self::column_type_name(stmt_ref, i),
                })
                .collect();

            let batch_sizes = [16, 64, 256, 1024, 2048];
            let mut chunks: Vec<Vec<Vec<JsonValue>>> = Vec::new();
            let mut batch_idx = 0;
            let mut current_chunk: Vec<Vec<JsonValue>> = Vec::new();
            let mut batch_target = batch_sizes[0];

            while let Some(row) = result_rows
                .next()
                .map_err(|e| AppError::DatabaseError(format!("Row fetch failed: {}", e)))?
            {
                let mut converted = Vec::with_capacity(column_count);
                for i in 0..column_count {
                    let value = row.get_ref(i).map_err(|e| {
                        AppError::DatabaseError(format!("Column read failed: {}", e))
                    })?;
                    converted.push(Self::value_ref_to_json(value));
                }
                current_chunk.push(converted);
                if current_chunk.len() >= batch_target {
                    chunks.push(std::mem::take(&mut current_chunk));
                    if batch_idx < batch_sizes.len() - 1 {
                        batch_idx += 1;
                    }
                    batch_target = batch_sizes[batch_idx];
                }
            }
            if !current_chunk.is_empty() {
                chunks.push(current_chunk);
            }

            Ok((columns, chunks))
        })
        .await
    }
}

#[async_trait]
impl SqlQueryable for DuckDbAdapter {
    async fn execute_query(&self, sql: &str) -> Result<CapabilityQueryResult> {
        let sql = sql.to_string();

        self.execute_blocking(move |conn| {
            if Self::is_multi_statement(&sql) {
                conn.execute_batch(&sql)
                    .map_err(|e| AppError::DatabaseError(format!("Batch execute failed: {}", e)))?;

                return Ok(CapabilityQueryResult {
                    columns: vec![CapabilityColumnMeta {
                        name: "result".to_string(),
                        data_type: "TEXT".to_string(),
                    }],
                    rows: vec![vec![JsonValue::String(
                        "Batch executed successfully".to_string(),
                    )]],
                });
            }

            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| AppError::DatabaseError(format!("Prepare failed: {}", e)))?;

            let mut result_rows = stmt
                .query([])
                .map_err(|e| AppError::DatabaseError(format!("Query failed: {}", e)))?;
            let stmt_ref = result_rows.as_ref().ok_or_else(|| {
                AppError::DatabaseError("DuckDB query returned no statement handle".to_string())
            })?;
            let column_count = stmt_ref.column_count();
            let columns: Vec<CapabilityColumnMeta> = (0..column_count)
                .map(|i| CapabilityColumnMeta {
                    name: stmt_ref
                        .column_name(i)
                        .map_or("?", |name| name.as_str())
                        .to_string(),
                    data_type: Self::column_type_name(stmt_ref, i),
                })
                .collect();

            let mut rows = Vec::new();

            while let Some(row) = result_rows
                .next()
                .map_err(|e| AppError::DatabaseError(format!("Row fetch failed: {}", e)))?
            {
                let mut converted = Vec::with_capacity(column_count);
                for i in 0..column_count {
                    let value = row.get_ref(i).map_err(|e| {
                        AppError::DatabaseError(format!("Column read failed: {}", e))
                    })?;
                    converted.push(Self::value_ref_to_json(value));
                }
                rows.push(converted);
            }

            Ok(CapabilityQueryResult { columns, rows })
        })
        .await
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64> {
        let sql = sql.to_string();

        self.execute_blocking(move |conn| {
            if Self::is_multi_statement(&sql) {
                conn.execute_batch(&sql)
                    .map_err(|e| AppError::DatabaseError(format!("Batch execute failed: {}", e)))?;
                Ok(0)
            } else {
                let affected = conn
                    .execute(&sql, [])
                    .map_err(|e| AppError::DatabaseError(format!("Execute failed: {}", e)))?;
                Ok(affected as u64)
            }
        })
        .await
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbAutocompleteSuggestion {
    pub suggestion: String,
    pub suggestion_start: i32,
    pub suggestion_type: Option<String>,
}

impl DuckDbAdapter {
    pub async fn autocomplete(
        &self,
        partial_sql: &str,
    ) -> Result<Vec<DuckDbAutocompleteSuggestion>> {
        let partial_sql = partial_sql.to_string();
        self.execute_blocking(move |conn| {
            let mut stmt = conn
                .prepare("SELECT suggestion, suggestion_start, suggestion_type FROM sql_auto_complete(?)")
                .map_err(|e| {
                    AppError::DatabaseError(format!("Failed to prepare autocomplete: {}", e))
                })?;

            let mut rows = stmt
                .query(params![partial_sql])
                .map_err(|e| {
                    AppError::DatabaseError(format!("Autocomplete query failed: {}", e))
                })?;

            let mut suggestions = Vec::new();
            while let Some(row) = rows.next().map_err(|e| {
                AppError::DatabaseError(format!("Failed to read autocomplete row: {}", e))
            })? {
                suggestions.push(DuckDbAutocompleteSuggestion {
                    suggestion: row.get(0).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read suggestion: {}", e))
                    })?,
                    suggestion_start: row.get(1).map_err(|e| {
                        AppError::DatabaseError(format!("Failed to read suggestion_start: {}", e))
                    })?,
                    suggestion_type: row.get(2).ok(),
                });
            }

            Ok(suggestions)
        })
        .await
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbQueryPlan {
    pub plan_text: String,
    pub plan_json: Option<JsonValue>,
    pub total_time_ms: Option<f64>,
}

impl DuckDbAdapter {
    pub async fn explain_query(&self, sql: &str) -> Result<DuckDbQueryPlan> {
        let sql = sql.to_string();
        self.execute_blocking(move |conn| {
            let explain_sql = if sql.trim_start().to_uppercase().starts_with("EXPLAIN") {
                sql.clone()
            } else {
                format!("EXPLAIN ANALYZE {}", sql)
            };

            let mut stmt = conn
                .prepare(&explain_sql)
                .map_err(|e| AppError::DatabaseError(format!("EXPLAIN prepare failed: {}", e)))?;

            let mut rows = stmt
                .query([])
                .map_err(|e| AppError::DatabaseError(format!("EXPLAIN query failed: {}", e)))?;

            let mut lines = Vec::new();
            while let Some(row) = rows
                .next()
                .map_err(|e| AppError::DatabaseError(format!("EXPLAIN row fetch failed: {}", e)))?
            {
                let value: String = row.get(0).unwrap_or_default();
                lines.push(value);
            }

            let plan_text = lines.join("\n");

            let total_time_ms = plan_text
                .lines()
                .rev()
                .find_map(|line| {
                    let trimmed = line.trim().to_lowercase();
                    if trimmed.starts_with("total time:") || trimmed.starts_with("run time:") {
                        trimmed
                            .split_whitespace()
                            .find_map(|token| token.trim_end_matches('s').parse::<f64>().ok())
                            .map(|secs| secs * 1000.0)
                    } else {
                        None
                    }
                });

            Ok(DuckDbQueryPlan {
                plan_text,
                plan_json: None,
                total_time_ms,
            })
        })
        .await
    }
}

impl DuckDbAdapter {
    /// Perform a lightweight health check on the DuckDB connection.
    pub async fn ping(&self) -> bool {
        self.execute_blocking(|conn| {
            conn.execute_batch("SELECT 1")
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            Ok(true)
        })
        .await
        .unwrap_or(false)
    }
}

#[cfg(test)]
impl DuckDbAdapter {
    pub fn is_multi_statement_pub(sql: &str) -> bool {
        Self::is_multi_statement(sql)
    }
}
