//! MongoDB adapter implementation
//!
//! Implements document database operations for MongoDB using the official
//! mongodb Rust driver.

use async_trait::async_trait;
use bson::{doc, Bson, Document};
use futures::TryStreamExt;
use mongodb::{
    options::{ClientOptions, IndexOptions, ValidationAction, ValidationLevel},
    results::CollectionSpecification,
    Client, Database, IndexModel,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Stats for a document field: (count, non_null_count, types, sample_values)
type FieldStats = (u64, u64, HashSet<String>, Vec<Value>);
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::core::capabilities::*;
use crate::error::AppError;
use crate::types::ConnectionProfile;

/// MongoDB database adapter
pub struct MongoDbAdapter {
    client: Arc<RwLock<Option<Client>>>,
    database: Arc<RwLock<Option<Database>>>,
    database_name: Arc<RwLock<String>>,
    connected: Arc<RwLock<bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoCursorToken {
    pub last_id: Value,
    #[serde(default)]
    pub last_sort_values: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentPage {
    pub documents: Vec<Value>,
    pub next_cursor: Option<MongoCursorToken>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoFieldStat {
    pub path: String,
    pub occurrences: u64,
    pub null_count: u64,
    pub types: Vec<String>,
    pub sample_values: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoSchemaSample {
    pub sample_size: u64,
    pub scanned_count: u64,
    pub fields: Vec<MongoFieldStat>,
}

impl MongoDbAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(RwLock::new(None)),
            database: Arc::new(RwLock::new(None)),
            database_name: Arc::new(RwLock::new(String::new())),
            connected: Arc::new(RwLock::new(false)),
        }
    }

    /// URL-encode a string for use in connection strings
    fn url_encode(s: &str) -> String {
        let mut result = String::with_capacity(s.len() * 3);
        for c in s.chars() {
            match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => result.push(c),
                _ => {
                    for byte in c.to_string().bytes() {
                        result.push_str(&format!("%{:02X}", byte));
                    }
                }
            }
        }
        result
    }

    /// Build MongoDB connection string from profile
    fn build_connection_string(profile: &ConnectionProfile) -> String {
        // Check for custom connection string in options
        if let Some(conn_str) = profile.options.get("connection_string") {
            if !conn_str.is_empty() {
                return conn_str.clone();
            }
        }

        let auth = if !profile.username.is_empty() {
            if let Some(password) = &profile.password {
                format!(
                    "{}:{}@",
                    Self::url_encode(&profile.username),
                    Self::url_encode(password)
                )
            } else {
                format!("{}@", Self::url_encode(&profile.username))
            }
        } else {
            String::new()
        };

        let db = if profile.database.is_empty() {
            "admin"
        } else {
            &profile.database
        };

        // Check for SRV mode
        let is_srv = profile
            .options
            .get("srv")
            .map(|v| v == "true")
            .unwrap_or(false);

        let protocol = if is_srv { "mongodb+srv" } else { "mongodb" };

        // Build options string
        let mut opts = Vec::new();

        if let Some(auth_source) = profile.options.get("authSource") {
            opts.push(format!("authSource={}", auth_source));
        }

        if let Some(replica_set) = profile.options.get("replicaSet") {
            opts.push(format!("replicaSet={}", replica_set));
        }

        if let Some(app_name) = profile.options.get("appName") {
            opts.push(format!("appName={}", app_name));
        }

        // Direct connection for single-node testing
        if profile
            .options
            .get("directConnection")
            .map(|v| v == "true")
            .unwrap_or(false)
        {
            opts.push("directConnection=true".to_string());
        }

        let options_str = if opts.is_empty() {
            String::new()
        } else {
            format!("?{}", opts.join("&"))
        };

        if is_srv {
            format!(
                "{}://{}{}/{}{}",
                protocol, auth, profile.host, db, options_str
            )
        } else {
            format!(
                "{}://{}{}:{}/{}{}",
                protocol, auth, profile.host, profile.port, db, options_str
            )
        }
    }

    /// Get the current database reference
    pub async fn get_database(&self) -> Option<Database> {
        self.database.read().await.clone()
    }

    /// Get the current client reference
    pub async fn get_client(&self) -> Option<Client> {
        self.client.read().await.clone()
    }

    /// Get current database name
    pub async fn get_database_name(&self) -> String {
        self.database_name.read().await.clone()
    }

    /// Connect to MongoDB using a connection profile
    pub async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        let conn_str = Self::build_connection_string(profile);

        // Add connection timeout to prevent indefinite hangs
        let mut client_options = ClientOptions::parse(&conn_str)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to parse MongoDB URI: {}", e)))?;

        // Set server selection and connection timeouts
        client_options.connect_timeout = Some(std::time::Duration::from_secs(15));
        client_options.server_selection_timeout = Some(std::time::Duration::from_secs(15));

        let client = Client::with_options(client_options).map_err(|e| {
            AppError::DatabaseError(format!("Failed to create MongoDB client: {}", e))
        })?;

        // Verify connection with ping (timeout already configured above)
        client
            .database("admin")
            .run_command(bson::doc! { "ping": 1 })
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to ping MongoDB: {}", e)))?;

        let db_name = if profile.database.is_empty() {
            "test".to_string()
        } else {
            profile.database.clone()
        };
        let database = client.database(&db_name);

        *self.client.write().await = Some(client);
        *self.database.write().await = Some(database);
        *self.database_name.write().await = db_name;
        *self.connected.write().await = true;

        Ok(())
    }

    /// Disconnect from MongoDB
    pub async fn disconnect(&self) -> Result<(), AppError> {
        // Take the client to properly shut it down
        let client = self.client.write().await.take();
        if let Some(c) = client {
            // shutdown() closes all idle sockets and waits for in-use sockets to be returned
            c.shutdown().await;
        }
        *self.database.write().await = None;
        *self.connected.write().await = false;
        Ok(())
    }

    /// Switch to a different database
    pub async fn use_database(&self, db_name: &str) -> Result<(), AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let database = c.database(db_name);
                *self.database.write().await = Some(database);
                *self.database_name.write().await = db_name.to_string();
                Ok(())
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Resolve which database to use: explicit override or the adapter's current database.
    /// Returns a lightweight `Database` handle without modifying adapter state.
    pub async fn resolve_db(&self, db_override: Option<&str>) -> Result<Database, AppError> {
        match db_override {
            Some(name) => {
                let client = self.client.read().await;
                match client.as_ref() {
                    Some(c) => Ok(c.database(name)),
                    None => Err(AppError::DatabaseError("Not connected".to_string())),
                }
            }
            None => {
                let db = self.database.read().await;
                db.clone()
                    .ok_or_else(|| AppError::DatabaseError("No database selected".to_string()))
            }
        }
    }

    /// List collections on a specific database (does not modify adapter state).
    pub async fn list_collections_on_db(
        &self,
        database: &Database,
    ) -> Result<Vec<CollectionInfo>, AppError> {
        let collections = database
            .list_collection_names()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to list collections: {}", e)))?;

        let mut result = Vec::new();
        for name in collections {
            let stats = database.run_command(doc! { "collStats": &name }).await.ok();

            let (doc_count, size_bytes) = match stats {
                Some(s) => (
                    s.get_i64("count").ok().map(|c| c as u64),
                    s.get_i64("size").ok().map(|s| s as u64),
                ),
                None => (None, None),
            };

            result.push(CollectionInfo {
                name,
                doc_count,
                size_bytes,
            });
        }

        Ok(result)
    }

    fn json_to_index_options(options: Option<&Value>) -> Result<Option<IndexOptions>, AppError> {
        options
            .map(|value| {
                let mut normalized = value.clone();
                if let Some(object) = normalized.as_object_mut() {
                    if let Some(default_language) = object.remove("defaultLanguage") {
                        object.insert("default_language".to_string(), default_language);
                    }
                    if let Some(language_override) = object.remove("languageOverride") {
                        object.insert("language_override".to_string(), language_override);
                    }
                }

                serde_json::from_value::<IndexOptions>(normalized).map_err(|e| {
                    AppError::InvalidInput(format!("Invalid index options: {}", e))
                })
            })
            .transpose()
    }

    fn serialize_index_model(index: IndexModel) -> Result<Value, AppError> {
        let mut value = serde_json::to_value(index).map_err(|e| {
            AppError::ParseError(format!("Failed to serialize index model: {}", e))
        })?;
        let object = value.as_object_mut().ok_or_else(|| {
            AppError::ParseError("Serialized index model was not an object".to_string())
        })?;
        if let Some(keys) = object.remove("key") {
            object.insert("keys".to_string(), keys);
        }
        Ok(value)
    }

    fn serialize_collection_specification(
        spec: &CollectionSpecification,
        stats: Option<crate::core::capabilities::MongoCollectionStatsSummary>,
    ) -> Result<crate::core::capabilities::MongoCollectionMetadata, AppError> {
        let options = serde_json::to_value(&spec.options).map_err(|e| {
            AppError::ParseError(format!(
                "Failed to serialize collection options: {}",
                e
            ))
        })?;

        let validator = spec
            .options
            .validator
            .clone()
            .map(Self::bson_doc_to_json);

        Ok(crate::core::capabilities::MongoCollectionMetadata {
            name: spec.name.clone(),
            options,
            validator,
            validation_level: spec.options.validation_level.clone(),
            validation_action: spec.options.validation_action.clone(),
            stats,
        })
    }

    fn extract_u64(document: &Document, key: &str) -> Option<u64> {
        match document.get(key) {
            Some(Bson::Int32(value)) => (*value).try_into().ok(),
            Some(Bson::Int64(value)) => (*value).try_into().ok(),
            Some(Bson::Double(value)) if *value >= 0.0 => Some(*value as u64),
            _ => None,
        }
    }

    fn summarize_collection_stats(
        stats: &Document,
    ) -> crate::core::capabilities::MongoCollectionStatsSummary {
        crate::core::capabilities::MongoCollectionStatsSummary {
            count: Self::extract_u64(stats, "count"),
            size: Self::extract_u64(stats, "size"),
            avg_obj_size: Self::extract_u64(stats, "avgObjSize"),
            storage_size: Self::extract_u64(stats, "storageSize"),
            total_index_size: Self::extract_u64(stats, "totalIndexSize"),
            index_count: Self::extract_u64(stats, "nindexes")
                .or_else(|| Self::extract_u64(stats, "indexCount")),
        }
    }

    fn build_validation_command(
        collection: &str,
        validator: Option<Value>,
        validation_level: Option<ValidationLevel>,
        validation_action: Option<ValidationAction>,
    ) -> Result<Document, AppError> {
        let mut command = doc! { "collMod": collection };

        if let Some(validator_value) = validator {
            command.insert("validator", Self::json_to_bson(&validator_value)?);
        }

        if let Some(level) = validation_level {
            command.insert(
                "validationLevel",
                bson::to_bson(&level).map_err(|e| {
                    AppError::ParseError(format!(
                        "Failed to serialize validation level: {}",
                        e
                    ))
                })?,
            );
        }

        if let Some(action) = validation_action {
            command.insert(
                "validationAction",
                bson::to_bson(&action).map_err(|e| {
                    AppError::ParseError(format!(
                        "Failed to serialize validation action: {}",
                        e
                    ))
                })?,
            );
        }

        Ok(command)
    }

    fn build_explain_command(
        collection: &str,
        mode: &crate::core::capabilities::MongoExplainMode,
        filter: Option<Value>,
        sort: Option<Value>,
        projection: Option<Value>,
        skip: Option<u64>,
        limit: Option<u64>,
        pipeline: Option<Vec<Value>>,
    ) -> Result<Document, AppError> {
        let inner = match mode {
            crate::core::capabilities::MongoExplainMode::Find => {
                let mut command = doc! { "find": collection };

                if let Some(filter_value) = filter {
                    command.insert("filter", Self::json_to_bson(&filter_value)?);
                }
                if let Some(sort_value) = sort {
                    command.insert("sort", Self::json_to_bson_doc(&sort_value)?);
                }
                if let Some(projection_value) = projection {
                    command.insert("projection", Self::json_to_bson_doc(&projection_value)?);
                }
                if let Some(skip_value) = skip {
                    command.insert("skip", skip_value as i64);
                }
                if let Some(limit_value) = limit {
                    command.insert("limit", limit_value as i64);
                }

                command
            }
            crate::core::capabilities::MongoExplainMode::Aggregate => {
                let pipeline_docs = pipeline
                    .unwrap_or_default()
                    .into_iter()
                    .map(|stage| Ok(Bson::Document(Self::json_to_bson_doc(&stage)?)))
                    .collect::<Result<Vec<_>, AppError>>()?;

                doc! {
                    "aggregate": collection,
                    "pipeline": pipeline_docs,
                    "cursor": {}
                }
            }
        };

        Ok(doc! { "explain": inner })
    }

    /// Run a command on a specific database (does not modify adapter state).
    pub async fn run_command_on_db(
        &self,
        database: &Database,
        command: Value,
    ) -> Result<Value, AppError> {
        let cmd_doc = Self::json_to_bson_doc(&command)?;
        let result = database
            .run_command(cmd_doc)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Command failed: {}", e)))?;
        Ok(Self::bson_doc_to_json(result))
    }

    /// Insert a document on a specific database (does not modify adapter state).
    pub async fn insert_document_on_db(
        &self,
        database: &Database,
        collection: &str,
        document: Value,
    ) -> Result<InsertResult, AppError> {
        let coll = database.collection::<Document>(collection);
        let doc = Self::json_to_bson_doc(&document)?;

        let result = coll
            .insert_one(doc)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Insert failed: {}", e)))?;

        Ok(InsertResult {
            inserted_id: result.inserted_id.to_string(),
        })
    }
}

impl Default for MongoDbAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BaseCapability for MongoDbAdapter {
    async fn connect(&self, profile: &ConnectionProfile) -> Result<(), AppError> {
        MongoDbAdapter::connect(self, profile).await
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        MongoDbAdapter::disconnect(self).await
    }

    async fn test_connection(&self) -> Result<CapabilityTestResult, AppError> {
        let client = self.client.read().await;

        match client.as_ref() {
            Some(c) => {
                let start = Instant::now();

                let result = c
                    .database("admin")
                    .run_command(bson::doc! { "ping": 1 })
                    .await;

                let latency = start.elapsed().as_millis() as u64;

                match result {
                    Ok(_) => {
                        // Get server version
                        let build_info = c
                            .database("admin")
                            .run_command(bson::doc! { "buildInfo": 1 })
                            .await
                            .ok();

                        let version = build_info
                            .and_then(|doc| doc.get_str("version").ok().map(|s| s.to_string()));

                        Ok(CapabilityTestResult {
                            success: true,
                            message: "Connection successful".to_string(),
                            latency_ms: Some(latency),
                            server_version: version,
                        })
                    }
                    Err(e) => Ok(CapabilityTestResult {
                        success: false,
                        message: format!("Ping failed: {}", e),
                        latency_ms: Some(latency),
                        server_version: None,
                    }),
                }
            }
            None => Ok(CapabilityTestResult {
                success: false,
                message: "Not connected".to_string(),
                latency_ms: None,
                server_version: None,
            }),
        }
    }

    fn is_connected(&self) -> bool {
        // Use try_read to avoid blocking - if lock is held, assume connected
        self.connected
            .try_read()
            .map(|guard| *guard)
            .unwrap_or(false)
    }

    fn get_capabilities(&self) -> Vec<AdapterCapability> {
        vec![AdapterCapability::DocumentQueryable]
    }
}

// ============ DocumentQueryable Implementation ============

impl MongoDbAdapter {
    /// Convert JSON Value to BSON Document
    fn json_to_bson_doc(value: &Value) -> Result<Document, AppError> {
        match value {
            Value::Object(map) => {
                let mut doc = Document::new();
                for (k, v) in map {
                    doc.insert(k.clone(), Self::json_to_bson(v)?);
                }
                Ok(doc)
            }
            _ => Err(AppError::InvalidInput("Expected JSON object".to_string())),
        }
    }

    /// Convert JSON Value to BSON Value
    fn json_to_bson(value: &Value) -> Result<bson::Bson, AppError> {
        match value {
            Value::Null => Ok(bson::Bson::Null),
            Value::Bool(b) => Ok(bson::Bson::Boolean(*b)),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Ok(bson::Bson::Int64(i))
                } else if let Some(f) = n.as_f64() {
                    Ok(bson::Bson::Double(f))
                } else {
                    Err(AppError::InvalidInput("Invalid number".to_string()))
                }
            }
            Value::String(s) => {
                // Try to parse as ObjectId if it looks like one
                if s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                    if let Ok(oid) = bson::oid::ObjectId::parse_str(s) {
                        return Ok(bson::Bson::ObjectId(oid));
                    }
                }
                Ok(bson::Bson::String(s.clone()))
            }
            Value::Array(arr) => {
                let bson_arr: Result<Vec<bson::Bson>, AppError> =
                    arr.iter().map(Self::json_to_bson).collect();
                Ok(bson::Bson::Array(bson_arr?))
            }
            Value::Object(map) => {
                let mut doc = Document::new();
                for (k, v) in map {
                    doc.insert(k.clone(), Self::json_to_bson(v)?);
                }
                Ok(bson::Bson::Document(doc))
            }
        }
    }

    /// Convert BSON Document to JSON Value
    fn bson_doc_to_json(doc: Document) -> Value {
        let mut map = serde_json::Map::new();
        for (k, v) in doc {
            map.insert(k, Self::bson_to_json(v));
        }
        Value::Object(map)
    }

    /// Convert BSON Value to JSON Value
    fn bson_to_json(bson: bson::Bson) -> Value {
        match bson {
            bson::Bson::Null => Value::Null,
            bson::Bson::Boolean(b) => Value::Bool(b),
            bson::Bson::Int32(i) => Value::Number(i.into()),
            bson::Bson::Int64(i) => Value::Number(i.into()),
            bson::Bson::Double(f) => serde_json::Number::from_f64(f)
                .map(Value::Number)
                .unwrap_or(Value::Null),
            bson::Bson::String(s) => Value::String(s),
            bson::Bson::ObjectId(oid) => Value::String(oid.to_hex()),
            bson::Bson::Array(arr) => {
                Value::Array(arr.into_iter().map(Self::bson_to_json).collect())
            }
            bson::Bson::Document(doc) => Self::bson_doc_to_json(doc),
            bson::Bson::DateTime(dt) => Value::String(dt.to_string()),
            bson::Bson::Binary(bin) => Value::String(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &bin.bytes,
            )),
            bson::Bson::Timestamp(ts) => {
                Value::Number((ts.time as i64 * 1000 + ts.increment as i64).into())
            }
            bson::Bson::RegularExpression(re) => {
                Value::String(format!("/{}/{}", re.pattern, re.options))
            }
            bson::Bson::Decimal128(d) => Value::String(d.to_string()),
            _ => Value::String(format!("{:?}", bson)),
        }
    }

    fn json_path_get<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
        let mut current = value;
        for segment in path.split('.') {
            if let Ok(index) = segment.parse::<usize>() {
                current = current.as_array()?.get(index)?;
            } else {
                current = current.as_object()?.get(segment)?;
            }
        }
        Some(current)
    }

    fn parse_sort_pairs(sort: Option<&Value>) -> Result<Vec<(String, i32)>, AppError> {
        let mut sort_pairs: Vec<(String, i32)> = Vec::new();

        if let Some(sort_value) = sort {
            let sort_map = sort_value
                .as_object()
                .ok_or_else(|| AppError::InvalidInput("sort must be a JSON object".to_string()))?;

            for (field, direction_value) in sort_map {
                let direction = match direction_value {
                    Value::Number(n) if n.as_i64() == Some(-1) => -1,
                    Value::Number(_) => 1,
                    Value::String(s) if s.eq_ignore_ascii_case("desc") => -1,
                    Value::String(s) if s.eq_ignore_ascii_case("asc") => 1,
                    _ => {
                        return Err(AppError::InvalidInput(format!(
                            "Unsupported sort direction for field '{}'",
                            field
                        )));
                    }
                };
                sort_pairs.push((field.clone(), direction));
            }
        }

        if sort_pairs.is_empty() {
            sort_pairs.push(("_id".to_string(), 1));
        } else if !sort_pairs.iter().any(|(field, _)| field == "_id") {
            let fallback_direction = sort_pairs.first().map(|(_, dir)| *dir).unwrap_or(1);
            sort_pairs.push(("_id".to_string(), fallback_direction));
        }

        Ok(sort_pairs)
    }

    fn sort_pairs_to_doc(sort_pairs: &[(String, i32)]) -> Document {
        let mut sort_doc = Document::new();
        for (field, direction) in sort_pairs {
            sort_doc.insert(field, Bson::Int32(*direction));
        }
        sort_doc
    }

    fn cursor_value_for_field<'a>(cursor: &'a MongoCursorToken, field: &str) -> Option<&'a Value> {
        if field == "_id" {
            return Some(&cursor.last_id);
        }
        cursor.last_sort_values.get(field)
    }

    fn build_cursor_filter(
        base_filter: Document,
        cursor: Option<&MongoCursorToken>,
        sort_pairs: &[(String, i32)],
    ) -> Result<Document, AppError> {
        let Some(cursor_token) = cursor else {
            return Ok(base_filter);
        };

        let mut or_clauses: Vec<Bson> = Vec::new();

        'branch: for (idx, (field, direction)) in sort_pairs.iter().enumerate() {
            let Some(cursor_value) = Self::cursor_value_for_field(cursor_token, field) else {
                continue;
            };
            let cursor_bson = Self::json_to_bson(cursor_value)?;

            let mut branch = Document::new();
            for (prev_field, _) in sort_pairs.iter().take(idx) {
                let Some(prev_value) = Self::cursor_value_for_field(cursor_token, prev_field)
                else {
                    // If a prior sort field is missing from the cursor token,
                    // this branch cannot express strict tuple ordering safely.
                    continue 'branch;
                };
                branch.insert(prev_field, Self::json_to_bson(prev_value)?);
            }

            let op = if *direction >= 0 { "$gt" } else { "$lt" };
            branch.insert(field, Bson::Document(doc! { op: cursor_bson }));
            or_clauses.push(Bson::Document(branch));
        }

        if or_clauses.is_empty() {
            return Ok(base_filter);
        }

        let or_doc = doc! { "$or": Bson::Array(or_clauses) };
        if base_filter.is_empty() {
            Ok(or_doc)
        } else {
            Ok(doc! {
                "$and": Bson::Array(vec![
                    Bson::Document(base_filter),
                    Bson::Document(or_doc),
                ])
            })
        }
    }

    fn build_next_cursor(
        last_document: &Value,
        sort_pairs: &[(String, i32)],
    ) -> Option<MongoCursorToken> {
        let last_id = Self::json_path_get(last_document, "_id")?.clone();
        let mut sort_values = HashMap::new();

        for (field, _) in sort_pairs {
            let value = Self::json_path_get(last_document, field)
                .cloned()
                .unwrap_or(Value::Null);
            sort_values.insert(field.clone(), value);
        }

        Some(MongoCursorToken {
            last_id,
            last_sort_values: sort_values,
        })
    }

    fn json_type_label(value: &Value) -> String {
        match value {
            Value::Null => "null".to_string(),
            Value::Bool(_) => "boolean".to_string(),
            Value::Number(_) => "number".to_string(),
            Value::String(_) => "string".to_string(),
            Value::Array(_) => "array".to_string(),
            Value::Object(_) => "object".to_string(),
        }
    }

    fn compact_sample_value(value: &Value) -> Value {
        match value {
            Value::Object(map) => Value::String(format!("{{{} keys}}", map.len())),
            Value::Array(arr) => Value::String(format!("[{} items]", arr.len())),
            _ => value.clone(),
        }
    }

    fn collect_field_stats(
        value: &Value,
        path: &str,
        depth: u8,
        max_depth: u8,
        stats: &mut HashMap<String, FieldStats>,
    ) {
        if depth > max_depth {
            return;
        }

        if !path.is_empty() {
            let entry = stats
                .entry(path.to_string())
                .or_insert_with(|| (0, 0, HashSet::new(), Vec::new()));

            entry.0 += 1;
            if value.is_null() {
                entry.1 += 1;
            }

            entry.2.insert(Self::json_type_label(value));
            if entry.3.len() < 3 {
                entry.3.push(Self::compact_sample_value(value));
            }
        }

        if depth == max_depth {
            return;
        }

        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    let child_path = if path.is_empty() {
                        key.clone()
                    } else {
                        format!("{}.{}", path, key)
                    };
                    Self::collect_field_stats(child, &child_path, depth + 1, max_depth, stats);
                }
            }
            Value::Array(arr) => {
                // Sample up to 5 elements per array path to avoid exploding recursion.
                for child in arr.iter().take(5) {
                    let child_path = if path.is_empty() {
                        "[]".to_string()
                    } else {
                        format!("{}[]", path)
                    };
                    Self::collect_field_stats(child, &child_path, depth + 1, max_depth, stats);
                }
            }
            _ => {}
        }
    }

    pub async fn find_documents_page(
        &self,
        collection: &str,
        filter: Value,
        mut options: FindOptions,
        cursor: Option<MongoCursorToken>,
    ) -> Result<MongoDocumentPage, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let coll = database.collection::<Document>(collection);
                let base_filter = Self::json_to_bson_doc(&filter)?;

                let sort_pairs = Self::parse_sort_pairs(options.sort.as_ref())?;
                let sort_doc = Self::sort_pairs_to_doc(&sort_pairs);
                let effective_limit = options.limit.unwrap_or(100).clamp(1, 1000);
                let query_filter =
                    Self::build_cursor_filter(base_filter, cursor.as_ref(), &sort_pairs)?;

                let mut find_options = mongodb::options::FindOptions::default();
                find_options.limit = Some((effective_limit + 1) as i64);
                find_options.sort = Some(sort_doc);
                if let Some(proj_value) = options.projection.take() {
                    find_options.projection = Some(Self::json_to_bson_doc(&proj_value)?);
                }

                let mut cursor_stream = coll
                    .find(query_filter)
                    .with_options(find_options)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Find page failed: {}", e)))?;

                let mut docs: Vec<Document> = Vec::new();
                while let Some(doc) = cursor_stream
                    .try_next()
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Cursor error: {}", e)))?
                {
                    docs.push(doc);
                }

                let has_more = docs.len() as u64 > effective_limit;
                if has_more {
                    docs.pop();
                }

                let json_documents: Vec<Value> =
                    docs.into_iter().map(Self::bson_doc_to_json).collect();

                let next_cursor = if has_more {
                    json_documents
                        .last()
                        .and_then(|doc| Self::build_next_cursor(doc, &sort_pairs))
                } else {
                    None
                };

                Ok(MongoDocumentPage {
                    documents: json_documents,
                    next_cursor,
                    has_more,
                })
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    pub async fn sample_collection_schema(
        &self,
        collection: &str,
        filter: Option<Value>,
        sample_size: u64,
        max_depth: u8,
    ) -> Result<MongoSchemaSample, AppError> {
        let sanitized_sample_size = sample_size.clamp(10, 2000);
        let docs = self
            .find_documents(
                collection,
                filter.unwrap_or_else(|| Value::Object(serde_json::Map::new())),
                FindOptions {
                    limit: Some(sanitized_sample_size),
                    ..FindOptions::default()
                },
            )
            .await?;

        let mut stats: HashMap<String, (u64, u64, HashSet<String>, Vec<Value>)> = HashMap::new();
        for doc in &docs {
            Self::collect_field_stats(doc, "", 0, max_depth, &mut stats);
        }

        let mut fields: Vec<MongoFieldStat> = stats
            .into_iter()
            .map(|(path, (occurrences, null_count, types, sample_values))| {
                let mut type_list: Vec<String> = types.into_iter().collect();
                type_list.sort();
                MongoFieldStat {
                    path,
                    occurrences,
                    null_count,
                    types: type_list,
                    sample_values,
                }
            })
            .collect();

        fields.sort_by(|a, b| {
            b.occurrences
                .cmp(&a.occurrences)
                .then_with(|| a.path.cmp(&b.path))
        });

        Ok(MongoSchemaSample {
            sample_size: sanitized_sample_size,
            scanned_count: docs.len() as u64,
            fields,
        })
    }

    /// List all collections in the current database
    pub async fn list_collections(&self) -> Result<Vec<CollectionInfo>, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let collections = database.list_collection_names().await.map_err(|e| {
                    AppError::DatabaseError(format!("Failed to list collections: {}", e))
                })?;

                let mut result = Vec::new();
                for name in collections {
                    // Get stats for each collection
                    let stats = database.run_command(doc! { "collStats": &name }).await.ok();

                    let (doc_count, size_bytes) = match stats {
                        Some(s) => (
                            s.get_i64("count").ok().map(|c| c as u64),
                            s.get_i64("size").ok().map(|c| c as u64),
                        ),
                        None => (None, None),
                    };

                    result.push(CollectionInfo {
                        name,
                        doc_count,
                        size_bytes,
                    });
                }
                Ok(result)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Find documents in a collection
    pub async fn find_documents(
        &self,
        collection: &str,
        filter: Value,
        options: FindOptions,
    ) -> Result<Vec<Value>, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let coll = database.collection::<Document>(collection);
                let filter_doc = Self::json_to_bson_doc(&filter)?;

                let mut find_options = mongodb::options::FindOptions::default();
                find_options.skip = options.skip;
                find_options.limit = options.limit.map(|l| l as i64);

                if let Some(sort_value) = options.sort {
                    find_options.sort = Some(Self::json_to_bson_doc(&sort_value)?);
                }

                if let Some(proj_value) = options.projection {
                    find_options.projection = Some(Self::json_to_bson_doc(&proj_value)?);
                }

                let mut cursor = coll
                    .find(filter_doc)
                    .with_options(find_options)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Find failed: {}", e)))?;

                let mut results = Vec::new();
                while let Some(doc) = cursor
                    .try_next()
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Cursor error: {}", e)))?
                {
                    results.push(Self::bson_doc_to_json(doc));
                }

                Ok(results)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Insert a single document
    pub async fn insert_document(
        &self,
        collection: &str,
        document: Value,
    ) -> Result<InsertResult, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let coll = database.collection::<Document>(collection);
                let doc = Self::json_to_bson_doc(&document)?;

                let result = coll
                    .insert_one(doc)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Insert failed: {}", e)))?;

                Ok(InsertResult {
                    inserted_id: result.inserted_id.to_string(),
                })
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Insert multiple documents
    pub async fn insert_documents(
        &self,
        collection: &str,
        documents: Vec<Value>,
    ) -> Result<InsertManyResult, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let coll = database.collection::<Document>(collection);
                let docs: Result<Vec<Document>, AppError> =
                    documents.iter().map(Self::json_to_bson_doc).collect();

                let result = coll
                    .insert_many(docs?)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Insert many failed: {}", e)))?;

                Ok(InsertManyResult {
                    inserted_ids: result
                        .inserted_ids
                        .values()
                        .map(|id| id.to_string())
                        .collect(),
                    inserted_count: result.inserted_ids.len() as u64,
                })
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Update a single document
    pub async fn update_document(
        &self,
        collection: &str,
        filter: Value,
        update: Value,
    ) -> Result<UpdateResult, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let coll = database.collection::<Document>(collection);
                let filter_doc = Self::json_to_bson_doc(&filter)?;
                let update_doc = Self::json_to_bson_doc(&update)?;

                let result = coll
                    .update_one(filter_doc, update_doc)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Update failed: {}", e)))?;

                Ok(UpdateResult {
                    matched_count: result.matched_count,
                    modified_count: result.modified_count,
                })
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Delete a single document
    pub async fn delete_document(
        &self,
        collection: &str,
        filter: Value,
    ) -> Result<DeleteResult, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let coll = database.collection::<Document>(collection);
                let filter_doc = Self::json_to_bson_doc(&filter)?;

                let result = coll
                    .delete_one(filter_doc)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Delete failed: {}", e)))?;

                Ok(DeleteResult {
                    deleted_count: result.deleted_count,
                })
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Run an aggregation pipeline
    pub async fn aggregate(
        &self,
        collection: &str,
        pipeline: Vec<Value>,
    ) -> Result<Vec<Value>, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let coll = database.collection::<Document>(collection);
                let pipeline_docs: Result<Vec<Document>, AppError> =
                    pipeline.iter().map(Self::json_to_bson_doc).collect();

                let mut cursor = coll
                    .aggregate(pipeline_docs?)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Aggregation failed: {}", e)))?;

                let mut results = Vec::new();
                while let Some(doc) = cursor
                    .try_next()
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Cursor error: {}", e)))?
                {
                    results.push(Self::bson_doc_to_json(doc));
                }

                Ok(results)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Count documents in a collection
    pub async fn count_documents(
        &self,
        collection: &str,
        filter: Option<Value>,
    ) -> Result<u64, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let coll = database.collection::<Document>(collection);
                let filter_doc = match filter {
                    Some(f) => Self::json_to_bson_doc(&f)?,
                    None => Document::new(),
                };

                let count = coll
                    .count_documents(filter_doc)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Count failed: {}", e)))?;

                Ok(count)
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// Run a raw command
    pub async fn run_command(&self, command: Value) -> Result<Value, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                let cmd_doc = Self::json_to_bson_doc(&command)?;
                let result = database
                    .run_command(cmd_doc)
                    .await
                    .map_err(|e| AppError::DatabaseError(format!("Command failed: {}", e)))?;

                Ok(Self::bson_doc_to_json(result))
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// List all databases
    pub async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
        let client = self.client.read().await;
        match client.as_ref() {
            Some(c) => {
                let dbs = c.list_database_names().await.map_err(|e| {
                    AppError::DatabaseError(format!("Failed to list databases: {}", e))
                })?;

                Ok(dbs.into_iter().map(|name| DatabaseInfo { name }).collect())
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    /// List indexes for a collection
    pub async fn list_indexes(&self, collection: &str) -> Result<Vec<Value>, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => self.list_indexes_on_db(database, collection).await,
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    pub async fn list_indexes_on_db(
        &self,
        database: &Database,
        collection: &str,
    ) -> Result<Vec<Value>, AppError> {
        let coll = database.collection::<Document>(collection);
        let mut cursor = coll
            .list_indexes()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to list indexes: {}", e)))?;

        let mut indexes = Vec::new();
        while let Some(index) = cursor
            .try_next()
            .await
            .map_err(|e| AppError::DatabaseError(format!("Cursor error: {}", e)))?
        {
            indexes.push(Self::serialize_index_model(index)?);
        }
        Ok(indexes)
    }

    /// Create an index on a collection
    pub async fn create_index(
        &self,
        collection: &str,
        keys: Value,
        options: Option<Value>,
    ) -> Result<String, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => self
                .create_index_on_db(database, collection, keys, options)
                .await,
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    pub async fn create_index_on_db(
        &self,
        database: &Database,
        collection: &str,
        keys: Value,
        options: Option<Value>,
    ) -> Result<String, AppError> {
        let coll = database.collection::<Document>(collection);
        let keys_doc = Self::json_to_bson_doc(&keys)?;
        let index_options = Self::json_to_index_options(options.as_ref())?;
        let index_model = IndexModel::builder()
            .keys(keys_doc)
            .options(index_options)
            .build();

        let result = coll
            .create_index(index_model)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to create index: {}", e)))?;

        Ok(result.index_name)
    }

    /// Drop an index from a collection
    pub async fn drop_index(&self, collection: &str, index_name: &str) -> Result<(), AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => self.drop_index_on_db(database, collection, index_name).await,
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    pub async fn drop_index_on_db(
        &self,
        database: &Database,
        collection: &str,
        index_name: &str,
    ) -> Result<(), AppError> {
        let coll = database.collection::<Document>(collection);
        coll.drop_index(index_name)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Failed to drop index: {}", e)))?;
        Ok(())
    }

    pub async fn get_collection_metadata(
        &self,
        collection: &str,
    ) -> Result<crate::core::capabilities::MongoCollectionMetadata, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => self.get_collection_metadata_on_db(database, collection).await,
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    pub async fn get_collection_metadata_on_db(
        &self,
        database: &Database,
        collection: &str,
    ) -> Result<crate::core::capabilities::MongoCollectionMetadata, AppError> {
        let mut cursor = database
            .list_collections()
            .filter(doc! { "name": collection })
            .await
            .map_err(|e| {
                AppError::DatabaseError(format!(
                    "Failed to fetch collection metadata for '{}': {}",
                    collection, e
                ))
            })?;

        let spec = cursor
            .try_next()
            .await
            .map_err(|e| {
                AppError::DatabaseError(format!(
                    "Failed to iterate collection metadata for '{}': {}",
                    collection, e
                ))
            })?
            .ok_or_else(|| {
                AppError::DatabaseError(format!("Collection '{}' was not found", collection))
            })?;

        let stats = database
            .run_command(doc! { "collStats": collection })
            .await
            .ok()
            .map(|doc| Self::summarize_collection_stats(&doc));

        Self::serialize_collection_specification(&spec, stats)
    }

    pub async fn update_collection_validation(
        &self,
        collection: &str,
        validator: Option<Value>,
        validation_level: Option<ValidationLevel>,
        validation_action: Option<ValidationAction>,
    ) -> Result<Value, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                self.update_collection_validation_on_db(
                    database,
                    collection,
                    validator,
                    validation_level,
                    validation_action,
                )
                .await
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    pub async fn update_collection_validation_on_db(
        &self,
        database: &Database,
        collection: &str,
        validator: Option<Value>,
        validation_level: Option<ValidationLevel>,
        validation_action: Option<ValidationAction>,
    ) -> Result<Value, AppError> {
        let command = Self::build_validation_command(
            collection,
            validator,
            validation_level,
            validation_action,
        )?;
        let result = database
            .run_command(command)
            .await
            .map_err(|e| AppError::DatabaseError(format!("collMod failed: {}", e)))?;
        Ok(Self::bson_doc_to_json(result))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn explain_collection_operation(
        &self,
        collection: &str,
        mode: crate::core::capabilities::MongoExplainMode,
        filter: Option<Value>,
        sort: Option<Value>,
        projection: Option<Value>,
        skip: Option<u64>,
        limit: Option<u64>,
        pipeline: Option<Vec<Value>>,
    ) -> Result<Value, AppError> {
        let db = self.database.read().await;
        match db.as_ref() {
            Some(database) => {
                self.explain_collection_operation_on_db(
                    database,
                    collection,
                    mode,
                    filter,
                    sort,
                    projection,
                    skip,
                    limit,
                    pipeline,
                )
                .await
            }
            None => Err(AppError::DatabaseError("Not connected".to_string())),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn explain_collection_operation_on_db(
        &self,
        database: &Database,
        collection: &str,
        mode: crate::core::capabilities::MongoExplainMode,
        filter: Option<Value>,
        sort: Option<Value>,
        projection: Option<Value>,
        skip: Option<u64>,
        limit: Option<u64>,
        pipeline: Option<Vec<Value>>,
    ) -> Result<Value, AppError> {
        let command = Self::build_explain_command(
            collection,
            &mode,
            filter,
            sort,
            projection,
            skip,
            limit,
            pipeline,
        )?;
        let result = database
            .run_command(command)
            .await
            .map_err(|e| AppError::DatabaseError(format!("Explain failed: {}", e)))?;
        Ok(Self::bson_doc_to_json(result))
    }
}

#[async_trait]
impl DocumentQueryable for MongoDbAdapter {
    async fn find_documents(
        &self,
        collection: &str,
        filter: Value,
        options: FindOptions,
    ) -> Result<Vec<Value>, AppError> {
        self.find_documents(collection, filter, options).await
    }

    async fn insert_document(
        &self,
        collection: &str,
        doc: Value,
    ) -> Result<InsertResult, AppError> {
        self.insert_document(collection, doc).await
    }

    async fn insert_documents(
        &self,
        collection: &str,
        docs: Vec<Value>,
    ) -> Result<InsertManyResult, AppError> {
        self.insert_documents(collection, docs).await
    }

    async fn update_document(
        &self,
        collection: &str,
        filter: Value,
        update: Value,
    ) -> Result<UpdateResult, AppError> {
        self.update_document(collection, filter, update).await
    }

    async fn delete_document(
        &self,
        collection: &str,
        filter: Value,
    ) -> Result<DeleteResult, AppError> {
        self.delete_document(collection, filter).await
    }

    async fn aggregate(
        &self,
        collection: &str,
        pipeline: Vec<Value>,
    ) -> Result<Vec<Value>, AppError> {
        self.aggregate(collection, pipeline).await
    }

    async fn count_documents(
        &self,
        collection: &str,
        filter: Option<Value>,
    ) -> Result<u64, AppError> {
        self.count_documents(collection, filter).await
    }

    async fn list_collections(&self) -> Result<Vec<CollectionInfo>, AppError> {
        self.list_collections().await
    }

    async fn run_command(&self, command: Value) -> Result<Value, AppError> {
        self.run_command(command).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::options::{IndexOptions, ValidationAction, ValidationLevel};

    #[test]
    fn test_new_adapter() {
        let adapter = MongoDbAdapter::new();
        assert!(!adapter.is_connected());
    }

    #[test]
    fn test_capabilities() {
        let adapter = MongoDbAdapter::new();
        let caps = adapter.get_capabilities();
        assert!(caps.contains(&AdapterCapability::DocumentQueryable));
    }

    #[test]
    fn test_build_connection_string_basic() {
        use std::collections::HashMap;

        let profile = ConnectionProfile {
            id: "test".to_string(),
            name: "test".to_string(),
            db_type: crate::types::DbType::MongoDB,
            host: "localhost".to_string(),
            port: 27017,
            database: "testdb".to_string(),
            username: String::new(),
            password: None,
            ssl_mode: None,
            ssl_config: None,
            ssh_tunnel: None,
            bastion: None,
            options: HashMap::new(),
            group: None,
            safe_mode: None,
        };

        let conn_str = MongoDbAdapter::build_connection_string(&profile);
        assert_eq!(conn_str, "mongodb://localhost:27017/testdb");
    }

    #[test]
    fn test_build_connection_string_with_auth() {
        use std::collections::HashMap;

        let profile = ConnectionProfile {
            id: "test".to_string(),
            name: "test".to_string(),
            db_type: crate::types::DbType::MongoDB,
            host: "localhost".to_string(),
            port: 27017,
            database: "testdb".to_string(),
            username: "user".to_string(),
            password: Some("pass".to_string()),
            ssl_mode: None,
            ssl_config: None,
            ssh_tunnel: None,
            bastion: None,
            options: HashMap::new(),
            group: None,
            safe_mode: None,
        };

        let conn_str = MongoDbAdapter::build_connection_string(&profile);
        assert_eq!(conn_str, "mongodb://user:pass@localhost:27017/testdb");
    }

    #[test]
    fn test_build_srv_connection_string_no_port() {
        use std::collections::HashMap;

        let mut options = HashMap::new();
        options.insert("srv".to_string(), "true".to_string());

        let profile = ConnectionProfile {
            id: "test".to_string(),
            name: "test".to_string(),
            db_type: crate::types::DbType::MongoDB,
            host: "cluster0.mongodb.net".to_string(),
            port: 27017, // port should be ignored for SRV
            database: "mydb".to_string(),
            username: String::new(),
            password: None,
            ssl_mode: None,
            ssl_config: None,
            ssh_tunnel: None,
            bastion: None,
            options,
            group: None,
            safe_mode: None,
        };

        let conn_str = MongoDbAdapter::build_connection_string(&profile);
        assert!(
            conn_str.starts_with("mongodb+srv://"),
            "SRV connection should use mongodb+srv:// protocol, got: {}",
            conn_str
        );
        assert!(
            !conn_str.contains(":27017"),
            "SRV connection must NOT include port, got: {}",
            conn_str
        );
        assert_eq!(conn_str, "mongodb+srv://cluster0.mongodb.net/mydb");
    }

    #[test]
    fn test_build_srv_connection_string_with_auth_no_port() {
        use std::collections::HashMap;

        let mut options = HashMap::new();
        options.insert("srv".to_string(), "true".to_string());

        let profile = ConnectionProfile {
            id: "test".to_string(),
            name: "test".to_string(),
            db_type: crate::types::DbType::MongoDB,
            host: "cluster0.mongodb.net".to_string(),
            port: 27017,
            database: "mydb".to_string(),
            username: "admin".to_string(),
            password: Some("secret".to_string()),
            ssl_mode: None,
            ssl_config: None,
            ssh_tunnel: None,
            bastion: None,
            options,
            group: None,
            safe_mode: None,
        };

        let conn_str = MongoDbAdapter::build_connection_string(&profile);
        assert!(
            conn_str.starts_with("mongodb+srv://"),
            "SRV connection should use mongodb+srv:// protocol"
        );
        assert!(
            !conn_str.contains(":27017"),
            "SRV connection must NOT include port, got: {}",
            conn_str
        );
        assert_eq!(
            conn_str,
            "mongodb+srv://admin:secret@cluster0.mongodb.net/mydb"
        );
    }

    #[test]
    fn test_json_to_index_options_preserves_rich_options() {
        let options = serde_json::json!({
            "name": "idx_status_createdAt",
            "unique": true,
            "sparse": false,
            "expireAfterSeconds": 3600,
            "defaultLanguage": "english",
            "languageOverride": "lang",
            "weights": { "title": 5 },
            "partialFilterExpression": { "status": "active" }
        });

        let parsed = MongoDbAdapter::json_to_index_options(Some(&options))
            .unwrap()
            .expect("expected parsed options");
        let serialized = serde_json::to_value(parsed).unwrap();

        assert_eq!(serialized["name"], "idx_status_createdAt");
        assert_eq!(serialized["unique"], true);
        assert_eq!(serialized["expireAfterSeconds"], 3600);
        assert_eq!(serialized["default_language"], "english");
        assert_eq!(serialized["language_override"], "lang");
        assert_eq!(serialized["weights"]["title"], 5);
        assert_eq!(
            serialized["partialFilterExpression"]["status"],
            "active"
        );
    }

    #[test]
    fn test_serialize_index_model_renames_key_to_keys() {
        let index = IndexModel::builder()
            .keys(doc! { "status": 1, "title": "text" })
            .options(Some(
                IndexOptions::builder()
                    .name(Some("idx_status_title_text".to_string()))
                    .unique(true)
                    .expire_after(std::time::Duration::from_secs(900))
                    .build(),
            ))
            .build();

        let serialized = MongoDbAdapter::serialize_index_model(index).unwrap();

        assert_eq!(serialized["keys"]["status"], 1);
        assert_eq!(serialized["keys"]["title"], "text");
        assert_eq!(serialized["name"], "idx_status_title_text");
        assert_eq!(serialized["unique"], true);
        assert_eq!(serialized["expireAfterSeconds"], 900);
        assert!(serialized.get("key").is_none());
    }

    #[test]
    fn test_build_validation_command_includes_schema_and_policy() {
        let command = MongoDbAdapter::build_validation_command(
            "users",
            Some(serde_json::json!({
                "$jsonSchema": {
                    "bsonType": "object",
                    "required": ["status"]
                }
            })),
            Some(ValidationLevel::Strict),
            Some(ValidationAction::Error),
        )
        .unwrap();

        assert_eq!(command.get_str("collMod").unwrap(), "users");
        assert!(command.get_document("validator").is_ok());
        assert_eq!(command.get_str("validationLevel").unwrap(), "strict");
        assert_eq!(command.get_str("validationAction").unwrap(), "error");
    }

    #[test]
    fn test_build_explain_command_for_aggregate_uses_pipeline() {
        let command = MongoDbAdapter::build_explain_command(
            "users",
            &crate::core::capabilities::MongoExplainMode::Aggregate,
            None,
            None,
            None,
            None,
            None,
            Some(vec![serde_json::json!({ "$match": { "status": "active" } })]),
        )
        .unwrap();

        let explain = command.get_document("explain").unwrap();
        assert_eq!(explain.get_str("aggregate").unwrap(), "users");
        assert!(explain.get_array("pipeline").is_ok());
        assert!(explain.get_document("cursor").is_ok());
    }
}
