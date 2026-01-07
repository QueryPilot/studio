//! Schema metadata cache for SQL completion and validation.
//!
//! Uses DashMap for concurrent access and TTL-based invalidation.

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Cache key for schema lookups.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct CacheKey {
    pub connection_id: String,
    pub schema: String,
}

impl CacheKey {
    pub fn new(connection_id: impl Into<String>, schema: impl Into<String>) -> Self {
        Self {
            connection_id: connection_id.into(),
            schema: schema.into(),
        }
    }
}

/// Table type enum.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TableType {
    Table,
    View,
    MaterializedView,
    Foreign,
    Partitioned,
}

/// Table metadata.
#[derive(Debug, Clone, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    pub table_type: TableType,
    pub comment: Option<String>,
    pub row_count: Option<i64>,
}

/// Column metadata.
#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub comment: Option<String>,
    pub enum_values: Option<Vec<String>>,
    pub ordinal: i32,
    pub precision: Option<i32>,
    pub scale: Option<i32>,
}

/// View metadata.
#[derive(Debug, Clone, Serialize)]
pub struct ViewInfo {
    pub name: String,
    pub schema: Option<String>,
    pub definition: Option<String>,
}

/// Foreign key metadata.
#[derive(Debug, Clone, Serialize)]
pub struct ForeignKeyInfo {
    pub constraint_name: String,
    pub source_table: String,
    pub source_schema: Option<String>,
    pub source_columns: Vec<String>,
    pub target_table: String,
    pub target_schema: Option<String>,
    pub target_columns: Vec<String>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

/// Enum type metadata.
#[derive(Debug, Clone, Serialize)]
pub struct EnumInfo {
    pub name: String,
    pub values: Vec<String>,
}

/// Parameter mode for functions.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ParamMode {
    In,
    Out,
    InOut,
    Variadic,
}

/// Function parameter.
#[derive(Debug, Clone, Serialize)]
pub struct FunctionParam {
    pub name: Option<String>,
    pub data_type: String,
    pub mode: ParamMode,
    pub default_value: Option<String>,
}

/// Function metadata.
#[derive(Debug, Clone, Serialize)]
pub struct FunctionInfo {
    pub name: String,
    pub schema: Option<String>,
    pub parameters: Vec<FunctionParam>,
    pub return_type: Option<String>,
    pub description: Option<String>,
}

/// Cached schema data.
#[derive(Debug, Clone, Default)]
pub struct CachedSchema {
    pub tables: Vec<TableInfo>,
    pub columns: DashMap<String, Vec<ColumnInfo>>,
    pub views: Vec<ViewInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub enums: Vec<EnumInfo>,
    pub functions: Vec<FunctionInfo>,
}

impl CachedSchema {
    /// Get foreign keys where the given table is the source (references other tables).
    pub fn get_foreign_keys(&self, table: &str) -> Vec<&ForeignKeyInfo> {
        self.foreign_keys
            .iter()
            .filter(|fk| fk.source_table.eq_ignore_ascii_case(table))
            .collect()
    }

    /// Get foreign keys where the given table is the target (referenced by other tables).
    pub fn get_referencing_keys(&self, table: &str) -> Vec<&ForeignKeyInfo> {
        self.foreign_keys
            .iter()
            .filter(|fk| fk.target_table.eq_ignore_ascii_case(table))
            .collect()
    }

    /// Get columns for a table.
    pub fn get_columns(&self, table: &str) -> Option<Vec<ColumnInfo>> {
        // Try exact match first
        if let Some(cols) = self.columns.get(table) {
            return Some(cols.clone());
        }
        // Try case-insensitive match
        for entry in self.columns.iter() {
            if entry.key().eq_ignore_ascii_case(table) {
                return Some(entry.value().clone());
            }
        }
        None
    }
}

/// Builder for CachedSchema.
pub struct CachedSchemaBuilder {
    schema: CachedSchema,
}

impl CachedSchemaBuilder {
    pub fn new() -> Self {
        Self {
            schema: CachedSchema::default(),
        }
    }

    pub fn add_table(mut self, table: TableInfo) -> Self {
        self.schema.tables.push(table);
        self
    }

    pub fn add_tables(mut self, tables: Vec<TableInfo>) -> Self {
        self.schema.tables.extend(tables);
        self
    }

    pub fn add_columns(self, table: &str, columns: Vec<ColumnInfo>) -> Self {
        self.schema.columns.insert(table.to_string(), columns);
        self
    }

    pub fn add_view(mut self, view: ViewInfo) -> Self {
        self.schema.views.push(view);
        self
    }

    pub fn add_foreign_key(mut self, fk: ForeignKeyInfo) -> Self {
        self.schema.foreign_keys.push(fk);
        self
    }

    pub fn add_enum(mut self, e: EnumInfo) -> Self {
        self.schema.enums.push(e);
        self
    }

    pub fn add_function(mut self, func: FunctionInfo) -> Self {
        self.schema.functions.push(func);
        self
    }

    pub fn build(self) -> CachedSchema {
        self.schema
    }
}

impl Default for CachedSchemaBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Cache entry with TTL.
struct CacheEntry {
    data: CachedSchema,
    created_at: Instant,
}

impl CacheEntry {
    fn is_expired(&self, ttl: Duration) -> bool {
        self.created_at.elapsed() > ttl
    }
}

/// Cache statistics.
#[derive(Debug, Clone, Serialize)]
pub struct CacheStats {
    pub total_entries: usize,
    pub hits: u64,
    pub misses: u64,
}

/// Schema store with concurrent access and TTL.
pub struct SchemaStore {
    cache: DashMap<CacheKey, CacheEntry>,
    ttl: Duration,
    hits: std::sync::atomic::AtomicU64,
    misses: std::sync::atomic::AtomicU64,
}

impl SchemaStore {
    pub fn new() -> Self {
        Self {
            cache: DashMap::new(),
            ttl: Duration::from_secs(30),
            hits: std::sync::atomic::AtomicU64::new(0),
            misses: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            cache: DashMap::new(),
            ttl,
            hits: std::sync::atomic::AtomicU64::new(0),
            misses: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub fn get(&self, key: &CacheKey) -> Option<CachedSchema> {
        if let Some(entry) = self.cache.get(key) {
            if !entry.is_expired(self.ttl) {
                self.hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                return Some(entry.data.clone());
            }
            drop(entry);
            self.cache.remove(key);
        }
        self.misses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        None
    }

    pub fn put(&self, key: CacheKey, schema: CachedSchema) {
        self.cache.insert(key, CacheEntry {
            data: schema,
            created_at: Instant::now(),
        });
    }

    pub fn invalidate(&self, connection_id: &str, schema: Option<&str>) {
        self.cache.retain(|k, _| {
            if k.connection_id != connection_id {
                return true;
            }
            if let Some(s) = schema {
                k.schema != s
            } else {
                false
            }
        });
    }

    pub fn invalidate_all(&self) {
        self.cache.clear();
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats {
            total_entries: self.cache.len(),
            hits: self.hits.load(std::sync::atomic::Ordering::Relaxed),
            misses: self.misses.load(std::sync::atomic::Ordering::Relaxed),
        }
    }
}

impl Default for SchemaStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_put_get() {
        let store = SchemaStore::new();
        let key = CacheKey::new("conn-1", "public");
        let schema = CachedSchemaBuilder::new()
            .add_table(TableInfo {
                name: "users".to_string(),
                schema: Some("public".to_string()),
                table_type: TableType::Table,
                comment: None,
                row_count: None,
            })
            .build();

        store.put(key.clone(), schema);
        assert!(store.get(&key).is_some());
    }

    #[test]
    fn test_cache_invalidation() {
        let store = SchemaStore::new();
        let key = CacheKey::new("conn-1", "public");
        store.put(key.clone(), CachedSchema::default());

        store.invalidate("conn-1", None);
        assert!(store.get(&key).is_none());
    }

    #[test]
    fn test_cache_stats() {
        let store = SchemaStore::new();
        let key = CacheKey::new("conn-1", "public");

        store.get(&key); // miss
        store.put(key.clone(), CachedSchema::default());
        store.get(&key); // hit

        let stats = store.stats();
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 1);
    }
}
