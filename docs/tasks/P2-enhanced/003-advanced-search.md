# P2-003: Advanced Search and Filtering

## Priority
P2 - Enhanced Feature

## Dependencies
- P1-002: Virtual Data Grid (filters apply to virtualized data)
- P1-003: Column Metadata (for type-aware filtering)

## Estimated Effort
3-4 hours

## Problem Statement
Users can't efficiently find specific data in large tables. No column-specific filters, regex support, or saved filter presets.

## Acceptance Criteria
- [ ] Column-specific filter inputs in header
- [ ] Type-aware filters (numeric ranges, date ranges, text patterns)
- [ ] Regex support for text columns
- [ ] Multiple filter conditions with AND/OR logic
- [ ] Save and load filter presets
- [ ] Clear visual indication of active filters
- [ ] Server-side filtering for performance

## Implementation Notes

### Filter Types and UI
```typescript
// src/types/filters.ts
export interface ColumnFilter {
  columnName: string;
  operator: FilterOperator;
  value: any;
  value2?: any;  // For BETWEEN operator
  caseSensitive?: boolean;
}

export enum FilterOperator {
  // Text operators
  EQUALS = 'equals',
  NOT_EQUALS = 'not_equals',
  CONTAINS = 'contains',
  NOT_CONTAINS = 'not_contains',
  STARTS_WITH = 'starts_with',
  ENDS_WITH = 'ends_with',
  REGEX = 'regex',
  IS_NULL = 'is_null',
  IS_NOT_NULL = 'is_not_null',
  
  // Numeric operators
  GREATER_THAN = 'gt',
  GREATER_THAN_OR_EQUAL = 'gte',
  LESS_THAN = 'lt',
  LESS_THAN_OR_EQUAL = 'lte',
  BETWEEN = 'between',
  
  // Date operators
  BEFORE = 'before',
  AFTER = 'after',
  DATE_BETWEEN = 'date_between',
  
  // Boolean
  IS_TRUE = 'is_true',
  IS_FALSE = 'is_false',
  
  // Array/JSON operators
  ARRAY_CONTAINS = 'array_contains',
  JSON_PATH = 'json_path',
}

export interface FilterPreset {
  id: string;
  name: string;
  description?: string;
  filters: ColumnFilter[];
  logic: 'AND' | 'OR';
  createdAt: Date;
}

// src/components/DataViewer/FilterBar.tsx
export function FilterBar({ 
  columns,
  filters,
  onFiltersChange,
  onApply,
  onClear,
}: FilterBarProps) {
  const [localFilters, setLocalFilters] = useState<ColumnFilter[]>(filters);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  
  const addFilter = () => {
    setLocalFilters([
      ...localFilters,
      {
        columnName: columns[0].name,
        operator: FilterOperator.CONTAINS,
        value: '',
      },
    ]);
  };
  
  const updateFilter = (index: number, updates: Partial<ColumnFilter>) => {
    const newFilters = [...localFilters];
    newFilters[index] = { ...newFilters[index], ...updates };
    setLocalFilters(newFilters);
  };
  
  const removeFilter = (index: number) => {
    setLocalFilters(localFilters.filter((_, i) => i !== index));
  };
  
  const applyFilters = () => {
    onFiltersChange(localFilters);
    onApply();
  };
  
  const savePreset = async () => {
    const name = await prompt('Preset name:');
    if (!name) return;
    
    const preset: FilterPreset = {
      id: generateId(),
      name,
      filters: localFilters,
      logic: 'AND',
      createdAt: new Date(),
    };
    
    const updatedPresets = [...presets, preset];
    setPresets(updatedPresets);
    
    // Save to localStorage
    localStorage.setItem('filter-presets', JSON.stringify(updatedPresets));
  };
  
  return (
    <div className="border-b p-2 space-y-2">
      {/* Quick filter row */}
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Quick search across all columns..."
          onChange={(e) => {
            if (e.target.value) {
              onFiltersChange([{
                columnName: '*',
                operator: FilterOperator.CONTAINS,
                value: e.target.value,
              }]);
            } else {
              onClear();
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          Advanced
        </Button>
      </div>
      
      {/* Advanced filters */}
      {showAdvanced && (
        <div className="space-y-2 p-2 border rounded">
          {localFilters.map((filter, index) => (
            <FilterRow
              key={index}
              filter={filter}
              columns={columns}
              onChange={(updates) => updateFilter(index, updates)}
              onRemove={() => removeFilter(index)}
            />
          ))}
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={addFilter}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Filter
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Presets
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {presets.map(preset => (
                  <DropdownMenuItem
                    key={preset.id}
                    onClick={() => setLocalFilters(preset.filters)}
                  >
                    {preset.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={savePreset}>
                  Save Current...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <div className="flex-1" />
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLocalFilters([]);
                onClear();
              }}
            >
              Clear
            </Button>
            
            <Button
              size="sm"
              onClick={applyFilters}
            >
              Apply Filters
            </Button>
          </div>
          
          {/* Active filters display */}
          {localFilters.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2">
              {localFilters.map((filter, i) => (
                <Badge key={i} variant="secondary">
                  {filter.columnName} {filter.operator} {filter.value}
                  <button
                    onClick={() => removeFilter(i)}
                    className="ml-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Individual filter row component
function FilterRow({ 
  filter, 
  columns, 
  onChange, 
  onRemove 
}: FilterRowProps) {
  const column = columns.find(c => c.name === filter.columnName);
  const operators = getOperatorsForType(column?.db_type || 'text');
  
  return (
    <div className="flex items-center gap-2">
      {/* Column selector */}
      <Select
        value={filter.columnName}
        onValueChange={(name) => onChange({ columnName: name })}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {columns.map(col => (
            <SelectItem key={col.name} value={col.name}>
              {col.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {/* Operator selector */}
      <Select
        value={filter.operator}
        onValueChange={(op) => onChange({ operator: op as FilterOperator })}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map(op => (
            <SelectItem key={op} value={op}>
              {formatOperator(op)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {/* Value input(s) */}
      {filter.operator !== FilterOperator.IS_NULL && 
       filter.operator !== FilterOperator.IS_NOT_NULL && (
        <>
          <FilterValueInput
            column={column}
            operator={filter.operator}
            value={filter.value}
            onChange={(value) => onChange({ value })}
          />
          
          {filter.operator === FilterOperator.BETWEEN && (
            <>
              <span>and</span>
              <FilterValueInput
                column={column}
                operator={filter.operator}
                value={filter.value2}
                onChange={(value2) => onChange({ value2 })}
              />
            </>
          )}
        </>
      )}
      
      {/* Case sensitive toggle for text */}
      {column?.db_type.includes('text') && (
        <Checkbox
          checked={filter.caseSensitive}
          onCheckedChange={(checked) => 
            onChange({ caseSensitive: checked as boolean })
          }
        />
      )}
      
      {/* Remove button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

### Backend Filter Processing
```rust
// src-tauri/src/database/filters.rs
use sqlx::query_builder::QueryBuilder;

pub struct FilterProcessor {
    filters: Vec<ColumnFilter>,
    logic: FilterLogic,
}

impl FilterProcessor {
    pub fn build_where_clause(&self, qb: &mut QueryBuilder) {
        if self.filters.is_empty() {
            return;
        }
        
        qb.push(" WHERE ");
        
        for (i, filter) in self.filters.iter().enumerate() {
            if i > 0 {
                match self.logic {
                    FilterLogic::And => qb.push(" AND "),
                    FilterLogic::Or => qb.push(" OR "),
                }
            }
            
            self.append_filter_condition(qb, filter);
        }
    }
    
    fn append_filter_condition(
        &self,
        qb: &mut QueryBuilder,
        filter: &ColumnFilter,
    ) {
        // Quote column name
        qb.push(format!("\"{}\"", filter.column_name));
        
        match filter.operator {
            FilterOperator::Equals => {
                qb.push(" = ");
                qb.push_bind(&filter.value);
            }
            FilterOperator::Contains => {
                qb.push(" LIKE ");
                qb.push_bind(format!("%{}%", filter.value));
            }
            FilterOperator::StartsWith => {
                qb.push(" LIKE ");
                qb.push_bind(format!("{}%", filter.value));
            }
            FilterOperator::Regex => {
                // PostgreSQL
                qb.push(" ~ ");
                qb.push_bind(&filter.value);
            }
            FilterOperator::Between => {
                qb.push(" BETWEEN ");
                qb.push_bind(&filter.value);
                qb.push(" AND ");
                qb.push_bind(&filter.value2);
            }
            FilterOperator::IsNull => {
                qb.push(" IS NULL");
            }
            FilterOperator::GreaterThan => {
                qb.push(" > ");
                qb.push_bind(&filter.value);
            }
            // ... other operators
        }
    }
}

// Use in query execution
impl DatabaseAdapter {
    pub async fn query_with_filters(
        &self,
        table: &str,
        columns: Vec<String>,
        filters: Vec<ColumnFilter>,
        logic: FilterLogic,
        limit: usize,
        offset: usize,
    ) -> Result<QueryResult, AppError> {
        let mut qb = QueryBuilder::new("SELECT ");
        
        // Columns
        if columns.is_empty() {
            qb.push("*");
        } else {
            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    qb.push(", ");
                }
                qb.push(format!("\"{}\"", col));
            }
        }
        
        // FROM clause
        qb.push(format!(" FROM \"{}\"", table));
        
        // WHERE clause with filters
        let processor = FilterProcessor { filters, logic };
        processor.build_where_clause(&mut qb);
        
        // Pagination
        qb.push(format!(" LIMIT {} OFFSET {}", limit, offset));
        
        // Execute
        let sql = qb.build();
        let rows = sql.fetch_all(&self.pool).await?;
        
        // Convert to strings as usual
        Ok(self.rows_to_result(rows))
    }
}
```

## Files to Modify
- Create `src/types/filters.ts` - Filter type definitions
- Create `src/components/DataViewer/FilterBar.tsx` - Filter UI
- Create `src/components/DataViewer/FilterRow.tsx` - Individual filter
- Create `src/components/DataViewer/FilterValueInput.tsx` - Type-aware inputs
- Create `src-tauri/src/database/filters.rs` - Backend filter processing
- Update `src-tauri/src/commands/database.rs` - Add filter support
- Update `src/stores/queryStore.ts` - Track active filters

## Testing Requirements
1. **Unit Tests**
   - Test filter SQL generation
   - Test regex validation
   - Test date range parsing

2. **Integration Tests**
   - Apply multiple filters
   - Test filter presets
   - Verify server-side filtering

3. **Manual Testing**
   - Test each operator type
   - Test with large datasets
   - Verify performance impact

## Success Metrics
- Filter application < 100ms
- Support 10+ simultaneous filters
- Regex filters work correctly
- Presets save and load properly

## Notes
- Consider full-text search for text columns
- May need database-specific regex syntax
- Future: Visual query builder interface