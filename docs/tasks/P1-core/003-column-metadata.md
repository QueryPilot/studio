# P1-003: Enhanced Column Metadata

## Priority
P1 - Core Feature

## Dependencies
None - Independent foundation for data grid

## Estimated Effort
4-5 hours

## Problem Statement
Current column metadata is basic, missing foreign key references, check constraints, and precision/scale information. Users can't see relationships or validation rules, leading to data entry errors.

## Acceptance Criteria
- [ ] Fetch complete column metadata including FK references
- [ ] Display check constraints in column tooltips
- [ ] Show precision/scale for numeric columns
- [ ] Visual indicators for PK/FK columns
- [ ] Link to referenced tables from FK columns
- [ ] Column metadata caching to avoid repeated queries

## Implementation Notes

### Backend (Rust)
```rust
// src-tauri/src/database/metadata.rs
use sqlx::{Row, postgres::PgRow};

#[derive(Serialize, Deserialize, Clone)]
pub struct EnhancedColumnMeta {
    pub name: String,
    pub db_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_pk: bool,
    pub is_fk: bool,
    pub fk_reference: Option<ForeignKeyRef>,
    pub check_constraint: Option<String>,
    pub ordinal: i32,
    pub precision: Option<i32>,
    pub scale: Option<i32>,
    pub character_maximum_length: Option<i32>,
    pub is_unique: bool,
    pub is_indexed: bool,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ForeignKeyRef {
    pub constraint_name: String,
    pub referenced_schema: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_delete: String,
    pub on_update: String,
}

impl PostgresAdapter {
    pub async fn fetch_enhanced_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<EnhancedColumnMeta>, AppError> {
        // Parallel queries for different metadata aspects
        let (basic, pks, fks, checks, indexes, comments) = tokio::join!(
            self.fetch_basic_columns(schema, table),
            self.fetch_primary_keys(schema, table),
            self.fetch_foreign_keys(schema, table),
            self.fetch_check_constraints(schema, table),
            self.fetch_indexes(schema, table),
            self.fetch_column_comments(schema, table),
        );
        
        // Combine all metadata
        let mut columns_map = HashMap::new();
        
        for row in basic? {
            let col = EnhancedColumnMeta {
                name: row.get("column_name"),
                db_type: row.get("data_type"),
                nullable: row.get::<String, _>("is_nullable") == "YES",
                default: row.get("column_default"),
                is_pk: false,
                is_fk: false,
                fk_reference: None,
                check_constraint: None,
                ordinal: row.get("ordinal_position"),
                precision: row.get("numeric_precision"),
                scale: row.get("numeric_scale"),
                character_maximum_length: row.get("character_maximum_length"),
                is_unique: false,
                is_indexed: false,
                comment: None,
            };
            columns_map.insert(col.name.clone(), col);
        }
        
        // Add PK information
        for pk_col in pks? {
            if let Some(col) = columns_map.get_mut(&pk_col) {
                col.is_pk = true;
                col.is_unique = true;  // PKs are always unique
            }
        }
        
        // Add FK references
        for fk_row in fks? {
            let col_name: String = fk_row.get("column_name");
            if let Some(col) = columns_map.get_mut(&col_name) {
                col.is_fk = true;
                col.fk_reference = Some(ForeignKeyRef {
                    constraint_name: fk_row.get("constraint_name"),
                    referenced_schema: fk_row.get("referenced_schema"),
                    referenced_table: fk_row.get("referenced_table"),
                    referenced_column: fk_row.get("referenced_column"),
                    on_delete: fk_row.get("delete_rule"),
                    on_update: fk_row.get("update_rule"),
                });
            }
        }
        
        // Add check constraints
        for check_row in checks? {
            let col_name: String = check_row.get("column_name");
            if let Some(col) = columns_map.get_mut(&col_name) {
                col.check_constraint = Some(check_row.get("check_clause"));
            }
        }
        
        // Add index information
        for idx_col in indexes? {
            if let Some(col) = columns_map.get_mut(&idx_col) {
                col.is_indexed = true;
            }
        }
        
        // Add comments
        for (col_name, comment) in comments? {
            if let Some(col) = columns_map.get_mut(&col_name) {
                col.comment = Some(comment);
            }
        }
        
        // Sort by ordinal and return
        let mut columns: Vec<_> = columns_map.into_values().collect();
        columns.sort_by_key(|c| c.ordinal);
        
        Ok(columns)
    }
    
    async fn fetch_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<PgRow>, AppError> {
        let sql = r#"
            SELECT 
                kcu.column_name,
                kcu.constraint_name,
                ccu.table_schema AS referenced_schema,
                ccu.table_name AS referenced_table,
                ccu.column_name AS referenced_column,
                rc.delete_rule,
                rc.update_rule
            FROM information_schema.key_column_usage kcu
            JOIN information_schema.table_constraints tc
                ON kcu.constraint_name = tc.constraint_name
                AND kcu.table_schema = tc.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints rc
                ON rc.constraint_name = tc.constraint_name
                AND rc.constraint_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
                AND kcu.table_schema = $1
                AND kcu.table_name = $2
        "#;
        
        sqlx::query(sql)
            .bind(schema)
            .bind(table)
            .fetch_all(&**self.pool)
            .await
            .map_err(AppError::from_sqlx)
    }
    
    async fn fetch_check_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<PgRow>, AppError> {
        let sql = r#"
            SELECT 
                a.attname AS column_name,
                pg_get_constraintdef(con.oid) AS check_clause
            FROM pg_constraint con
            JOIN pg_attribute a ON a.attnum = ANY(con.conkey)
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE con.contype = 'c'
                AND n.nspname = $1
                AND c.relname = $2
        "#;
        
        sqlx::query(sql)
            .bind(schema)
            .bind(table)
            .fetch_all(&**self.pool)
            .await
            .map_err(AppError::from_sqlx)
    }
}
```

### Frontend Display (React/TypeScript)
```typescript
// src/components/DataViewer/ColumnHeader.tsx
interface ColumnHeaderProps {
  column: EnhancedColumnMeta;
  width: number;
  onResize: (width: number) => void;
  onNavigateToReference?: (table: string) => void;
}

export function ColumnHeader({ 
  column, 
  width, 
  onResize,
  onNavigateToReference 
}: ColumnHeaderProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 px-2 py-1">
            {/* Column type indicators */}
            {column.is_pk && (
              <Key className="h-3 w-3 text-yellow-500" />
            )}
            {column.is_fk && (
              <Link2 className="h-3 w-3 text-blue-500" />
            )}
            {column.is_unique && !column.is_pk && (
              <Fingerprint className="h-3 w-3 text-purple-500" />
            )}
            {column.is_indexed && (
              <Zap className="h-3 w-3 text-green-500" />
            )}
            
            {/* Column name */}
            <span className="truncate font-medium">
              {column.name}
            </span>
            
            {/* Nullable indicator */}
            {column.nullable && (
              <span className="text-xs text-muted-foreground">?</span>
            )}
          </div>
        </TooltipTrigger>
        
        <TooltipContent className="max-w-sm">
          <div className="space-y-2 text-sm">
            {/* Type information */}
            <div>
              <span className="font-semibold">Type:</span> {column.db_type}
              {column.precision && column.scale && (
                <span> ({column.precision},{column.scale})</span>
              )}
              {column.character_maximum_length && (
                <span> ({column.character_maximum_length})</span>
              )}
            </div>
            
            {/* Default value */}
            {column.default && (
              <div>
                <span className="font-semibold">Default:</span> {column.default}
              </div>
            )}
            
            {/* Foreign key reference */}
            {column.fk_reference && (
              <div className="border-t pt-2">
                <div className="font-semibold">Foreign Key Reference:</div>
                <button
                  className="text-blue-500 hover:underline"
                  onClick={() => onNavigateToReference?.(
                    `${column.fk_reference.referenced_schema}.${column.fk_reference.referenced_table}`
                  )}
                >
                  {column.fk_reference.referenced_table}.{column.fk_reference.referenced_column}
                </button>
                <div className="text-xs">
                  ON DELETE: {column.fk_reference.on_delete}
                  <br />
                  ON UPDATE: {column.fk_reference.on_update}
                </div>
              </div>
            )}
            
            {/* Check constraint */}
            {column.check_constraint && (
              <div className="border-t pt-2">
                <div className="font-semibold">Check Constraint:</div>
                <code className="text-xs bg-muted p-1 rounded">
                  {column.check_constraint}
                </code>
              </div>
            )}
            
            {/* Column comment */}
            {column.comment && (
              <div className="border-t pt-2 italic">
                {column.comment}
              </div>
            )}
            
            {/* Metadata badges */}
            <div className="flex gap-2 pt-2">
              {column.is_pk && (
                <Badge variant="outline" className="text-xs">Primary Key</Badge>
              )}
              {column.is_unique && !column.is_pk && (
                <Badge variant="outline" className="text-xs">Unique</Badge>
              )}
              {column.is_indexed && (
                <Badge variant="outline" className="text-xs">Indexed</Badge>
              )}
              {!column.nullable && (
                <Badge variant="outline" className="text-xs">Required</Badge>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// src/services/metadataCache.ts
class MetadataCache {
  private cache = new Map<string, {
    data: EnhancedColumnMeta[];
    timestamp: number;
  }>();
  
  private ttl = 10 * 60 * 1000; // 10 minutes
  
  async getColumns(
    connectionId: string,
    schema: string,
    table: string
  ): Promise<EnhancedColumnMeta[]> {
    const key = `${connectionId}:${schema}.${table}`;
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }
    
    // Fetch from backend
    const columns = await invoke('db_get_columns', {
      connectionId,
      schema,
      table,
    });
    
    // Cache the result
    this.cache.set(key, {
      data: columns,
      timestamp: Date.now(),
    });
    
    return columns;
  }
  
  invalidate(connectionId: string, schema?: string, table?: string) {
    if (!schema) {
      // Clear all for connection
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${connectionId}:`)) {
          this.cache.delete(key);
        }
      }
    } else if (!table) {
      // Clear all for schema
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${connectionId}:${schema}.`)) {
          this.cache.delete(key);
        }
      }
    } else {
      // Clear specific table
      this.cache.delete(`${connectionId}:${schema}.${table}`);
    }
  }
}

export const metadataCache = new MetadataCache();
```

## Files to Modify
- Create `src-tauri/src/database/metadata.rs` - Enhanced metadata fetching
- Update `src-tauri/src/commands/database.rs` - Add metadata command
- Create `src/components/DataViewer/ColumnHeader.tsx` - Rich column header
- Create `src/services/metadataCache.ts` - Client-side cache
- Update `src/types/database.ts` - Add EnhancedColumnMeta type
- Update `src/components/DataViewer/VirtualDataGrid.tsx` - Use new headers

## Testing Requirements
1. **Unit Tests**
   - Test metadata combination logic
   - Test cache TTL and invalidation
   - Test FK reference parsing

2. **Integration Tests**
   - Create table with all constraint types
   - Verify metadata accuracy
   - Test navigation to referenced tables

3. **Manual Testing**
   - Test with complex schemas
   - Verify tooltips show all info
   - Test cache performance

## Success Metrics
- Complete metadata loaded in < 500ms
- Cache hit rate > 90%
- All constraints visible in UI
- Navigation to FK references works

## Notes
- Consider batch fetching for multiple tables
- May need different queries per database type
- Future: Show index statistics