# P2-001: Export Functionality

## Priority
P2 - Enhanced Feature

## Dependencies
- P1-001: Numeric Precision (to preserve data accuracy in exports)
- P0-004: Cursor Management (for streaming large exports)

## Estimated Effort
3-4 hours

## Problem Statement
Users need to export query results and table data to various formats for analysis, sharing, and backup. Currently no export functionality exists.

## Acceptance Criteria
- [ ] Export to CSV with proper escaping and quoting
- [ ] Export to JSON with type preservation
- [ ] Export to SQL INSERT statements
- [ ] Configurable options (headers, delimiters, null handling)
- [ ] Progress indicator for large exports
- [ ] Streaming export for large datasets (no memory overflow)
- [ ] Background export with cancellation support

## Implementation Notes

### Backend (Rust)
```rust
// src-tauri/src/export/mod.rs
use csv::Writer;
use serde_json;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

pub enum ExportFormat {
    Csv(CsvOptions),
    Json(JsonOptions),
    Sql(SqlOptions),
}

pub struct CsvOptions {
    pub delimiter: u8,  // Default: b','
    pub quote: u8,      // Default: b'"'
    pub include_headers: bool,
    pub null_string: String,  // How to represent NULL
}

pub struct ExportJob {
    id: String,
    cursor_id: String,
    format: ExportFormat,
    output_path: PathBuf,
    progress: Arc<RwLock<ExportProgress>>,
    cancel_token: CancellationToken,
}

impl ExportJob {
    pub async fn execute(
        self,
        cursor_manager: &CursorManager,
    ) -> Result<ExportResult, AppError> {
        let cursor = cursor_manager.get(&self.cursor_id)?;
        let mut writer = self.create_writer().await?;
        
        // Write headers if needed
        if self.should_write_headers() {
            self.write_headers(&cursor.columns, &mut writer).await?;
        }
        
        let mut total_rows = 0;
        let mut current_page = cursor.current_page;
        
        loop {
            // Check cancellation
            if self.cancel_token.is_cancelled() {
                return Err(AppError::ExportCancelled);
            }
            
            // Write current page
            for row in &cursor.rows {
                self.write_row(row, &cursor.columns, &mut writer).await?;
                total_rows += 1;
                
                // Update progress
                self.progress.write().await.update(total_rows);
            }
            
            // Fetch next page if not complete
            if cursor.is_complete {
                break;
            }
            
            cursor = cursor_manager.fetch_next(&self.cursor_id).await?;
        }
        
        writer.flush().await?;
        
        Ok(ExportResult {
            total_rows,
            file_path: self.output_path,
            format: self.format,
        })
    }
    
    async fn write_csv_row(
        &self,
        row: &[String],
        columns: &[ColumnMeta],
        writer: &mut Writer<File>,
    ) -> Result<(), AppError> {
        let options = match &self.format {
            ExportFormat::Csv(opts) => opts,
            _ => unreachable!(),
        };
        
        let record: Vec<String> = row.iter().enumerate().map(|(i, value)| {
            if value == "null" {
                options.null_string.clone()
            } else {
                // Handle special types
                match columns[i].db_type.as_str() {
                    "JSON" | "JSONB" => {
                        // Pretty print JSON for readability
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(value) {
                            serde_json::to_string_pretty(&json).unwrap_or(value.clone())
                        } else {
                            value.clone()
                        }
                    }
                    _ => value.clone()
                }
            }
        }).collect();
        
        writer.write_record(&record)?;
        Ok(())
    }
    
    async fn write_sql_row(
        &self,
        row: &[String],
        columns: &[ColumnMeta],
        writer: &mut File,
        table_name: &str,
    ) -> Result<(), AppError> {
        let mut sql = format!("INSERT INTO {} (", table_name);
        
        // Column names
        sql.push_str(&columns.iter()
            .map(|c| format!("\"{}\"", c.name))
            .collect::<Vec<_>>()
            .join(", "));
        
        sql.push_str(") VALUES (");
        
        // Values with proper escaping
        let values: Vec<String> = row.iter().enumerate().map(|(i, value)| {
            if value == "null" {
                "NULL".to_string()
            } else {
                match columns[i].db_type.as_str() {
                    "VARCHAR" | "TEXT" | "CHAR" => {
                        // Escape single quotes
                        format!("'{}'", value.replace('\'', "''"))
                    }
                    "BOOLEAN" | "BOOL" => {
                        value.to_uppercase()
                    }
                    "JSON" | "JSONB" => {
                        format!("'{}'", value.replace('\'', "''"))
                    }
                    _ if columns[i].db_type.contains("INT") || 
                         columns[i].db_type.contains("DECIMAL") => {
                        value.clone()  // Numeric values as-is
                    }
                    _ => format!("'{}'", value.replace('\'', "''"))
                }
            }
        }).collect();
        
        sql.push_str(&values.join(", "));
        sql.push_str(");\n");
        
        writer.write_all(sql.as_bytes()).await?;
        Ok(())
    }
}

// Tauri command
#[tauri::command]
pub async fn db_export(
    cursor_id: String,
    format: ExportFormat,
    output_path: String,
    app_handle: AppHandle,
    registry: State<'_, ConnectionRegistry>,
) -> Result<String, AppError> {
    let job_id = Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    
    let progress = Arc::new(RwLock::new(ExportProgress::new()));
    let progress_clone = progress.clone();
    
    // Spawn progress reporter
    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(100));
        loop {
            interval.tick().await;
            let prog = progress_clone.read().await;
            app_handle_clone.emit_all("export-progress", &prog).ok();
            if prog.is_complete {
                break;
            }
        }
    });
    
    // Execute export
    let job = ExportJob {
        id: job_id.clone(),
        cursor_id,
        format,
        output_path: PathBuf::from(output_path),
        progress,
        cancel_token: cancel_token.clone(),
    };
    
    registry.register_export(job_id.clone(), cancel_token);
    
    tokio::spawn(async move {
        let result = job.execute(&registry.cursor_manager).await;
        app_handle.emit_all("export-complete", &result).ok();
    });
    
    Ok(job_id)
}
```

### Frontend (React/TypeScript)
```typescript
// src/components/ExportDialog.tsx
interface ExportOptions {
  format: 'csv' | 'json' | 'sql';
  csvOptions?: {
    delimiter: string;
    includeHeaders: boolean;
    nullString: string;
  };
  jsonOptions?: {
    pretty: boolean;
    dateFormat: 'iso' | 'unix';
  };
  sqlOptions?: {
    tableName: string;
    includeSchema: boolean;
    transactionWrap: boolean;
  };
}

export function ExportDialog({ 
  cursorId, 
  onClose 
}: { 
  cursorId: string;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'csv',
    csvOptions: {
      delimiter: ',',
      includeHeaders: true,
      nullString: '',
    },
  });
  
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  
  useEffect(() => {
    const unlisten = listen('export-progress', (event) => {
      setProgress(event.payload as ExportProgress);
    });
    
    return () => { unlisten(); };
  }, []);
  
  const handleExport = async () => {
    const filePath = await save({
      filters: [{
        name: options.format.toUpperCase(),
        extensions: [options.format],
      }],
    });
    
    if (!filePath) return;
    
    setExporting(true);
    
    try {
      const jobId = await invoke('db_export', {
        cursorId,
        format: options,
        outputPath: filePath,
      });
      
      // Wait for completion
      const unlisten = await listen('export-complete', (event) => {
        if (event.payload.jobId === jobId) {
          toast.success(`Export complete: ${event.payload.totalRows} rows`);
          onClose();
        }
      });
    } catch (error) {
      toast.error(`Export failed: ${error}`);
    } finally {
      setExporting(false);
    }
  };
  
  return (
    <Dialog open onOpenChange={() => !exporting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Data</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Format selection */}
          <RadioGroup
            value={options.format}
            onValueChange={(format) => setOptions({ ...options, format })}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="csv" id="csv" />
              <Label htmlFor="csv">CSV - Comma Separated Values</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="json" id="json" />
              <Label htmlFor="json">JSON - JavaScript Object Notation</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="sql" id="sql" />
              <Label htmlFor="sql">SQL - INSERT Statements</Label>
            </div>
          </RadioGroup>
          
          {/* Format-specific options */}
          {options.format === 'csv' && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="headers"
                  checked={options.csvOptions?.includeHeaders}
                  onCheckedChange={(checked) => 
                    setOptions({
                      ...options,
                      csvOptions: {
                        ...options.csvOptions!,
                        includeHeaders: checked as boolean,
                      },
                    })
                  }
                />
                <Label htmlFor="headers">Include column headers</Label>
              </div>
              
              <div>
                <Label>Delimiter</Label>
                <Select
                  value={options.csvOptions?.delimiter}
                  onValueChange={(delimiter) =>
                    setOptions({
                      ...options,
                      csvOptions: { ...options.csvOptions!, delimiter },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=",">Comma (,)</SelectItem>
                    <SelectItem value=";">Semicolon (;)</SelectItem>
                    <SelectItem value="\t">Tab</SelectItem>
                    <SelectItem value="|">Pipe (|)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          
          {/* Progress indicator */}
          {progress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Exporting...</span>
                <span>{progress.rowsExported} rows</span>
              </div>
              <Progress value={progress.percentage} />
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

## Files to Modify
- Create `src-tauri/src/export/mod.rs` - Export implementation
- Create `src-tauri/src/export/csv.rs` - CSV specific logic
- Create `src-tauri/src/export/json.rs` - JSON specific logic
- Create `src-tauri/src/export/sql.rs` - SQL specific logic
- Update `src-tauri/src/commands/database.rs` - Add export command
- Create `src/components/ExportDialog.tsx` - Export UI
- Update `src/components/QueryResults.tsx` - Add export button

## Testing Requirements
1. **Unit Tests**
   - Test CSV escaping edge cases
   - Test SQL injection prevention
   - Test JSON formatting

2. **Integration Tests**
   - Export 100k+ rows without memory issues
   - Cancel export mid-process
   - Verify file integrity

3. **Manual Testing**
   - Export to each format
   - Import exported files elsewhere
   - Test with special characters

## Success Metrics
- Export 1M rows without OOM
- Streaming keeps memory < 100MB
- Progress updates every 100ms
- All formats importable by Excel

## Notes
- Consider compression for large exports
- May need batch processing for huge datasets
- Future: Direct cloud upload support