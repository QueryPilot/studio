use async_trait::async_trait;
use bb8::{Pool, RunError};
use bb8_tiberius::ConnectionManager;
use serde_json::Value;
use std::time::{Duration, Instant};
use tiberius::{AuthMethod, EncryptionLevel, Query, Row};
use uuid::Uuid;

use crate::database::value_converter_mssql::MssqlValueConverter;
use crate::error::AppError;

use super::{
    ColumnMeta, ConnectionConfig, DbAdapter, DbObjectKind, ExecuteResult, FunctionMeta,
    QueryCursor, QueryOptions, QueryPage, TableMeta, TransactionId,
};

pub struct MssqlAdapter {
    pool: Pool<ConnectionManager>,
    config: ConnectionConfig,
}

impl MssqlAdapter {
    pub async fn new(config: ConnectionConfig) -> Result<Self, AppError> {
        // Use the Config from tiberius directly, which is re-exported by bb8_tiberius
        let mut tiberius_config = tiberius::Config::new();

        tiberius_config.host(&config.host);
        tiberius_config.port(config.port);
        tiberius_config.database(&config.database);

        // Handle authentication
        // Note: Tiberius doesn't have built-in Windows authentication
        // For now, we only support SQL Server authentication
        tiberius_config.authentication(AuthMethod::sql_server(
            &config.username,
            config.password.as_deref().unwrap_or(""),
        ));

        // Handle encryption
        if config.encrypt.unwrap_or(false) {
            tiberius_config.encryption(EncryptionLevel::Required);
        } else {
            tiberius_config.encryption(EncryptionLevel::Off);
        }

        // Trust server certificate
        if config.trust_server_certificate.unwrap_or(false) {
            tiberius_config.trust_cert();
        }

        // Instance name
        if let Some(instance) = &config.instance_name {
            tiberius_config.instance_name(instance);
        }

        let mgr = ConnectionManager::build(tiberius_config)
            .map_err(|e| AppError::Database(format!("Failed to create connection manager: {}", e)))?;

        let pool = Pool::builder()
            .max_size(config.max_connections)
            .min_idle(Some(config.min_connections))
            .connection_timeout(Duration::from_secs(config.connection_timeout))
            .idle_timeout(Some(Duration::from_secs(config.idle_timeout)))
            .max_lifetime(Some(Duration::from_secs(config.max_lifetime)))
            .build(mgr)
            .await
            .map_err(|e| AppError::Database(format!("Failed to create connection pool: {}", e)))?;

        Ok(Self { pool, config })
    }

    async fn execute_query(&self, sql: &str) -> Result<Vec<Row>, AppError> {
        let mut conn = self.pool.get().await.map_err(|e| match e {
            RunError::User(e) => AppError::Database(format!("Connection error: {}", e)),
            RunError::TimedOut => AppError::Database("Connection timeout".to_string()),
        })?;

        let stream = Query::new(sql)
            .query(&mut **conn)
            .await
            .map_err(|e| AppError::Database(format!("Query execution failed: {}", e)))?;

        stream
            .into_results()
            .await
            .map_err(|e| AppError::Database(format!("Failed to fetch results: {}", e)))?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::Database("No results returned".to_string()))
    }
}

#[async_trait]
impl DbAdapter for MssqlAdapter {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn ping(&self) -> Result<Duration, AppError> {
        let start = Instant::now();
        self.execute_query("SELECT 1").await?;
        Ok(start.elapsed())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        // Connection pool handles cleanup
        Ok(())
    }

    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let rows = self.execute_query(
            "SELECT name FROM sys.databases 
             WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
             ORDER BY name"
        ).await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| row.get::<&str, _>(0).map(String::from))
            .collect())
    }

    async fn list_schemas(&self, _database: &str) -> Result<Vec<String>, AppError> {
        let rows = self.execute_query(
            "SELECT schema_name 
             FROM information_schema.schemata 
             WHERE schema_name NOT IN ('sys', 'information_schema', 'guest')
             ORDER BY schema_name"
        ).await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| row.get::<&str, _>(0).map(String::from))
            .collect())
    }

    async fn list_tables(&self, _database: &str, schema: &str) -> Result<Vec<TableMeta>, AppError> {
        let query = format!(
            "SELECT 
                TABLE_SCHEMA,
                TABLE_NAME,
                TABLE_TYPE,
                (SELECT SUM(row_count) 
                 FROM sys.dm_db_partition_stats 
                 WHERE object_id = OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME) 
                   AND index_id IN (0, 1)) as row_count,
                (SELECT SUM(reserved_page_count) * 8192
                 FROM sys.dm_db_partition_stats
                 WHERE object_id = OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME)) as size_bytes
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = '{}'
             ORDER BY TABLE_NAME",
            schema
        );

        let rows = self.execute_query(&query).await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let table_type = row.get::<&str, _>(2).unwrap_or("BASE TABLE");
                TableMeta {
                    schema: row.get::<&str, _>(0).unwrap_or("").to_string(),
                    name: row.get::<&str, _>(1).unwrap_or("").to_string(),
                    kind: if table_type.contains("VIEW") {
                        DbObjectKind::View
                    } else {
                        DbObjectKind::Table
                    },
                    row_estimate: row.get::<i64, _>(3),
                    size_bytes: row.get::<i64, _>(4),
                }
            })
            .collect())
    }

    async fn list_functions(&self, _database: &str, schema: &str) -> Result<Vec<FunctionMeta>, AppError> {
        let query = format!(
            "SELECT 
                ROUTINE_SCHEMA,
                ROUTINE_NAME,
                DATA_TYPE,
                PARAMETER_NAME,
                PARAMETER_MODE,
                DTD_IDENTIFIER
             FROM INFORMATION_SCHEMA.ROUTINES r
             LEFT JOIN INFORMATION_SCHEMA.PARAMETERS p 
                ON r.ROUTINE_NAME = p.SPECIFIC_NAME
             WHERE ROUTINE_SCHEMA = '{}' 
               AND ROUTINE_TYPE = 'FUNCTION'
             ORDER BY ROUTINE_NAME, ORDINAL_POSITION",
            schema
        );

        let rows = self.execute_query(&query).await?;

        let mut functions = std::collections::HashMap::new();

        for row in rows {
            let schema = row.get::<&str, _>(0).unwrap_or("").to_string();
            let name = row.get::<&str, _>(1).unwrap_or("").to_string();
            let return_type = row.get::<&str, _>(2).unwrap_or("").to_string();
            let param_name = row.get::<&str, _>(3).map(String::from);
            let param_type = row.get::<&str, _>(5).map(String::from);

            let entry = functions.entry(name.clone()).or_insert_with(|| FunctionMeta {
                schema: schema.clone(),
                name,
                return_type,
                arguments: Vec::new(),
            });

            if let (Some(pname), Some(ptype)) = (param_name, param_type) {
                entry.arguments.push(format!("{} {}", pname, ptype));
            }
        }

        Ok(functions.into_values().collect())
    }

    async fn table_columns(&self, _database: &str, schema: &str, table: &str) -> Result<Vec<ColumnMeta>, AppError> {
        let query = format!(
            "SELECT 
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT,
                c.ORDINAL_POSITION,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_PRECISION,
                c.NUMERIC_SCALE,
                COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') as is_identity,
                COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsComputed') as is_computed,
                CASE WHEN tc.CONSTRAINT_TYPE = 'PRIMARY KEY' THEN 1 ELSE 0 END as is_pk,
                CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as is_fk,
                CASE WHEN c.DATA_TYPE = 'hierarchyid' THEN 1 ELSE 0 END as is_hierarchyid,
                CASE WHEN c.DATA_TYPE IN ('geography', 'geometry') THEN 1 ELSE 0 END as is_spatial
             FROM INFORMATION_SCHEMA.COLUMNS c
             LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                ON c.TABLE_SCHEMA = kcu.TABLE_SCHEMA 
                AND c.TABLE_NAME = kcu.TABLE_NAME 
                AND c.COLUMN_NAME = kcu.COLUMN_NAME
             LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
             LEFT JOIN (
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
                WHERE TABLE_SCHEMA = '{}' 
                  AND TABLE_NAME = '{}' 
                  AND CONSTRAINT_NAME IN (
                    SELECT CONSTRAINT_NAME 
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
                    WHERE CONSTRAINT_TYPE = 'FOREIGN KEY'
                  )
             ) fk ON c.COLUMN_NAME = fk.COLUMN_NAME
             WHERE c.TABLE_SCHEMA = '{}' AND c.TABLE_NAME = '{}'
             ORDER BY c.ORDINAL_POSITION",
            schema, table, schema, table
        );

        let rows = self.execute_query(&query).await?;

        Ok(rows
            .into_iter()
            .map(|row| ColumnMeta {
                name: row.get::<&str, _>(0).unwrap_or("").to_string(),
                db_type: row.get::<&str, _>(1).unwrap_or("").to_string(),
                nullable: row.get::<&str, _>(2).unwrap_or("NO") == "YES",
                default: row.get::<&str, _>(3).map(String::from),
                ordinal: row.get::<i32, _>(4).unwrap_or(0),
                precision: row.get::<i32, _>(6),
                scale: row.get::<i32, _>(7),
                is_pk: row.get::<i32, _>(10).unwrap_or(0) == 1,
                is_fk: row.get::<i32, _>(11).unwrap_or(0) == 1,
                is_identity: Some(row.get::<i32, _>(8).unwrap_or(0) == 1),
                is_computed: Some(row.get::<i32, _>(9).unwrap_or(0) == 1),
                is_hierarchyid: Some(row.get::<i32, _>(12).unwrap_or(0) == 1),
                is_spatial: Some(row.get::<i32, _>(13).unwrap_or(0) == 1),
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
            })
            .collect())
    }

    async fn estimate_count(&self, _database: &str, schema: &str, table: &str) -> Result<i64, AppError> {
        let query = format!(
            "SELECT SUM(row_count) 
             FROM sys.dm_db_partition_stats 
             WHERE object_id = OBJECT_ID('{}.{}') 
               AND index_id IN (0, 1)",
            schema, table
        );

        let rows = self.execute_query(&query).await?;

        Ok(rows
            .into_iter()
            .next()
            .and_then(|row| row.get::<i64, _>(0))
            .unwrap_or(0))
    }

    async fn begin_query(&self, sql: &str, _params: Option<Vec<Value>>, opts: QueryOptions) -> Result<QueryCursor, AppError> {
        let mut conn = self.pool.get().await.map_err(|e| match e {
            RunError::User(e) => AppError::Database(format!("Connection error: {}", e)),
            RunError::TimedOut => AppError::Database("Connection timeout".to_string()),
        })?;

        let stream = Query::new(sql)
            .query(&mut **conn)
            .await
            .map_err(|e| AppError::Database(format!("Query execution failed: {}", e)))?;

        let columns = stream
            .columns()
            .ok_or_else(|| AppError::Database("No columns returned".to_string()))?
            .iter()
            .enumerate()
            .map(|(i, col)| ColumnMeta {
                name: col.name().to_string(),
                db_type: format!("{:?}", col.column_type()),
                nullable: true, // MSSQL doesn't provide this info easily
                default: None,
                is_pk: false,
                is_fk: false,
                ordinal: i as i32,
                precision: None,
                scale: None,
                is_identity: None,
                is_computed: None,
                is_hierarchyid: None,
                is_spatial: None,
                is_json: None,
                enum_values: None,
                set_values: None,
                is_virtual: None,
            })
            .collect::<Vec<_>>();

        let converter = MssqlValueConverter::new();
        let rows_result = stream.into_results().await
            .map_err(|e| AppError::Database(format!("Failed to fetch results: {}", e)))?;

        let mut all_rows = Vec::new();
        if let Some(rows) = rows_result.into_iter().next() {
            for row in rows.into_iter().take(opts.page_size) {
                let mut json_row = Vec::new();
                for (i, col) in columns.iter().enumerate() {
                    let value = converter.convert_row_value(&row, i, &col.db_type)?;
                    json_row.push(value);
                }
                all_rows.push(json_row);
            }
        }

        let is_complete = all_rows.len() < opts.page_size;

        Ok(QueryCursor {
            id: Uuid::new_v4().to_string(),
            sql: sql.to_string(),
            columns,
            rows: all_rows,
            page_size: opts.page_size,
            current_page: 0,
            total_rows: None,
            is_complete,
            created_at: Some(Instant::now()),
        })
    }

    async fn fetch_page(&self, cursor: &mut QueryCursor, page: usize, page_size: usize) -> Result<QueryPage, AppError> {
        // For now, MSSQL adapter returns all data in begin_query
        // Future enhancement: implement true cursor support
        let start = page * page_size;
        let end = std::cmp::min(start + page_size, cursor.rows.len());

        Ok(QueryPage {
            rows: cursor.rows[start..end].to_vec(),
            page,
            is_complete: end >= cursor.rows.len(),
        })
    }

    async fn close_cursor(&self, _cursor_id: &str) -> Result<(), AppError> {
        // Cursor cleanup handled by Rust's ownership
        Ok(())
    }

    async fn execute(&self, sql: &str, _params: Option<Vec<Value>>) -> Result<ExecuteResult, AppError> {
        let start = Instant::now();
        
        let mut conn = self.pool.get().await.map_err(|e| match e {
            RunError::User(e) => AppError::Database(format!("Connection error: {}", e)),
            RunError::TimedOut => AppError::Database("Connection timeout".to_string()),
        })?;

        let result = Query::new(sql)
            .execute(&mut **conn)
            .await
            .map_err(|e| AppError::Database(format!("Execution failed: {}", e)))?;

        let rows_affected = result.rows_affected().first().copied().unwrap_or(0);

        Ok(ExecuteResult {
            rows_affected,
            last_insert_id: None, // MSSQL uses SCOPE_IDENTITY() for this
            execution_time_ms: start.elapsed().as_millis() as f64,
        })
    }

    async fn begin_transaction(&self) -> Result<TransactionId, AppError> {
        Err(AppError::Database("Transactions not yet implemented for MSSQL".to_string()))
    }

    async fn commit(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        Err(AppError::Database("Transactions not yet implemented for MSSQL".to_string()))
    }

    async fn rollback(&self, _tx_id: TransactionId) -> Result<(), AppError> {
        Err(AppError::Database("Transactions not yet implemented for MSSQL".to_string()))
    }

    async fn server_version(&self) -> Result<String, AppError> {
        let rows = self.execute_query("SELECT @@VERSION").await?;

        Ok(rows
            .into_iter()
            .next()
            .and_then(|row| row.get::<&str, _>(0).map(String::from))
            .unwrap_or_else(|| "Unknown".to_string()))
    }
}