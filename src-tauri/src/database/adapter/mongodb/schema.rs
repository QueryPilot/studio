use mongodb::{Database, Client, bson::{Document, Bson}};
use futures::{TryStreamExt, StreamExt};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::error::AppError;
use crate::database::adapter::ColumnMeta;

pub struct SchemaInferrer {
    database: Database,
    client: Client,
    // Cache schema for collections to avoid re-scanning
    schema_cache: Arc<RwLock<HashMap<String, Vec<ColumnMeta>>>>,
}

impl SchemaInferrer {
    pub fn new(database: Database, client: Client) -> Self {
        Self { 
            database, 
            client,
            schema_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    pub async fn infer_collection_schema(&self, database_name: &str, collection_name: &str) -> Result<Vec<ColumnMeta>, AppError> {
        // Check cache first
        let cache_key = format!("{}.{}", database_name, collection_name);
        {
            let cache = self.schema_cache.read().await;
            if let Some(cached_schema) = cache.get(&cache_key) {
                return Ok(cached_schema.clone());
            }
        }
        
        let db = if database_name != self.database.name() {
            self.client.database(database_name)
        } else {
            self.database.clone()
        };
        
        let collection = db.collection::<Document>(collection_name);
        
        // Sample documents to infer schema - REDUCED from 1000!
        let sample_size = 10; // Only sample 10 docs for speed
        let cursor = collection.find(None, None).await
            .map_err(|e| AppError::Database(format!("Failed to query collection: {}", e)))?;
        
        let mut field_info: HashMap<String, FieldInfo> = HashMap::new();
        let mut doc_count = 0;
        
        // Process sample documents
        let mut cursor = cursor.take(sample_size);
        while let Ok(Some(doc)) = cursor.try_next().await {
            self.analyze_document(&doc, "", &mut field_info, &mut doc_count);
            doc_count += 1;
        }
        
        // Convert field info to column metadata
        let mut columns: Vec<ColumnMeta> = field_info
            .into_iter()
            .map(|(field_path, info)| self.field_info_to_column_meta(field_path, info, doc_count))
            .collect();
        
        // Sort by field path for consistent ordering
        columns.sort_by(|a, b| a.name.cmp(&b.name));
        
        // Ensure _id is first
        if let Some(id_pos) = columns.iter().position(|c| c.name == "_id") {
            let id_column = columns.remove(id_pos);
            columns.insert(0, id_column);
        }
        
        // Cache the schema
        {
            let mut cache = self.schema_cache.write().await;
            cache.insert(cache_key, columns.clone());
        }
        
        Ok(columns)
    }
    
    fn analyze_document(&self, doc: &Document, prefix: &str, field_info: &mut HashMap<String, FieldInfo>, _doc_count: &mut usize) {
        for (key, value) in doc {
            let field_path = if prefix.is_empty() {
                key.clone()
            } else {
                format!("{}.{}", prefix, key)
            };
            
            // Separate the mutable borrow
            field_info.entry(field_path.clone()).or_insert_with(|| FieldInfo::new()).occurrence_count += 1;
            
            self.analyze_bson_value_for_field(value, &field_path, field_info);
        }
    }
    
    fn analyze_bson_value_for_field(&self, value: &Bson, field_path: &str, field_info: &mut HashMap<String, FieldInfo>) {
        // Clone the field path to avoid borrowing issues
        let field_path_clone = field_path.to_string();
        
        // Handle the analysis without holding multiple mutable borrows
        match value {
            Bson::Null => {
                let field_entry = field_info.get_mut(&field_path_clone).unwrap();
                field_entry.null_count += 1;
                field_entry.types.insert("null".to_string());
            }
            Bson::String(s) => {
                let field_entry = field_info.get_mut(&field_path_clone).unwrap();
                field_entry.types.insert("string".to_string());
                field_entry.max_length = field_entry.max_length.max(s.len());
                
                // Check for special string patterns
                if s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                    field_entry.types.insert("objectId".to_string());
                }
                if self.is_uuid_pattern(s) {
                    field_entry.types.insert("uuid".to_string());
                }
                if self.is_date_pattern(s) {
                    field_entry.types.insert("date_string".to_string());
                }
            }
            Bson::Document(nested_doc) => {
                let field_entry = field_info.get_mut(&field_path_clone).unwrap();
                field_entry.types.insert("document".to_string());
                // Recursively analyze nested document
                self.analyze_document(nested_doc, &field_path_clone, field_info, &mut 0);
            }
            Bson::Array(arr) => {
                let field_entry = field_info.get_mut(&field_path_clone).unwrap();
                field_entry.types.insert("array".to_string());
                field_entry.array_max_length = field_entry.array_max_length.max(arr.len());
                
                // Analyze array elements to determine element type
                for (i, element) in arr.iter().enumerate() {
                    let element_path = format!("{}[{}]", field_path_clone, i);
                    field_info.entry(element_path.clone()).or_insert_with(|| {
                        let mut info = FieldInfo::new();
                        info.is_array_element = true;
                        info
                    });
                    self.analyze_bson_value_for_field(element, &element_path, field_info);
                }
            }
            _ => {
                // Handle all other types simply
                let field_entry = field_info.get_mut(&field_path_clone).unwrap();
                let type_name = match value {
                    Bson::Int32(_) => "int32",
                    Bson::Int64(_) => "int64", 
                    Bson::Double(_) => "double",
                    Bson::Decimal128(_) => "decimal128",
                    Bson::Boolean(_) => "boolean",
                    Bson::DateTime(_) => "date",
                    Bson::ObjectId(_) => "objectId",
                    Bson::Binary(_) => "binary",
                    Bson::RegularExpression(_) => "regex",
                    Bson::JavaScriptCode(_) => "javascript",
                    Bson::JavaScriptCodeWithScope(_) => "javascript_with_scope",
                    Bson::Timestamp(_) => "timestamp",
                    Bson::MinKey => "minKey",
                    Bson::MaxKey => "maxKey",
                    Bson::Undefined => "undefined",
                    Bson::Symbol(_) => "symbol",
                    Bson::DbPointer(_) => "dbPointer",
                    _ => "unknown"
                };
                field_entry.types.insert(type_name.to_string());
            }
        }
    }
    
    
    fn field_info_to_column_meta(&self, field_path: String, info: FieldInfo, total_docs: usize) -> ColumnMeta {
        // Determine the primary type
        let primary_type = self.determine_primary_type(&info.types);
        
        // Calculate nullable percentage
        let nullable = info.null_count > 0 || info.occurrence_count < total_docs;
        
        ColumnMeta {
            name: field_path.clone(),
            db_type: primary_type.clone(),
            nullable,
            default: None,
            is_pk: field_path == "_id", // _id is always primary key in MongoDB
            is_fk: false, // MongoDB doesn't have formal foreign keys
            ordinal: 0, // Will be set based on field order
            precision: None,
            scale: None,
            
            // MSSQL specific
            is_identity: None,
            is_computed: None,
            is_hierarchyid: None,
            is_spatial: None,
            // MySQL/MariaDB specific
            is_json: None,
            enum_values: None,
            set_values: None,
            is_virtual: None,
            // MongoDB-specific metadata
            mg_is_required: Some(!nullable),
            mg_is_sparse_index: Some(false), // TODO: Check if field has sparse index
            mg_index_type: None, // TODO: Determine index type if indexed
            mg_is_text_indexed: Some(false), // TODO: Check if part of text index
            mg_text_weights: None,
            mg_bson_type: Some(primary_type),
            mg_field_path: Some(field_path.clone()),
            mg_is_array_element: Some(info.is_array_element),
            mg_validation_rule: None, // TODO: Extract validation rules if any
            mg_encryption: None, // TODO: Check for field-level encryption
        }
    }
    
    fn determine_primary_type(&self, types: &HashSet<String>) -> String {
        // Priority order for type determination
        let type_priority = vec![
            "objectId", "string", "int64", "int32", "double", "decimal128",
            "boolean", "date", "array", "document", "binary", "regex",
            "javascript", "timestamp", "null"
        ];
        
        for preferred_type in type_priority {
            if types.contains(preferred_type) {
                return preferred_type.to_string();
            }
        }
        
        // If no recognized type found, return the first one or "unknown"
        types.iter().next().cloned().unwrap_or_else(|| "unknown".to_string())
    }
    
    fn is_uuid_pattern(&self, s: &str) -> bool {
        // Simple UUID pattern check (8-4-4-4-12 hex digits)
        if s.len() != 36 {
            return false;
        }
        
        let parts: Vec<&str> = s.split('-').collect();
        if parts.len() != 5 {
            return false;
        }
        
        let expected_lengths = [8, 4, 4, 4, 12];
        for (i, part) in parts.iter().enumerate() {
            if part.len() != expected_lengths[i] || !part.chars().all(|c| c.is_ascii_hexdigit()) {
                return false;
            }
        }
        
        true
    }
    
    fn is_date_pattern(&self, s: &str) -> bool {
        // Check for common date patterns
        chrono::DateTime::parse_from_rfc3339(s).is_ok() ||
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").is_ok() ||
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
    }
}

#[derive(Debug)]
struct FieldInfo {
    types: HashSet<String>,
    occurrence_count: usize,
    null_count: usize,
    max_length: usize,
    array_max_length: usize,
    is_array_element: bool,
}

impl FieldInfo {
    fn new() -> Self {
        Self {
            types: HashSet::new(),
            occurrence_count: 0,
            null_count: 0,
            max_length: 0,
            array_max_length: 0,
            is_array_element: false,
        }
    }
}