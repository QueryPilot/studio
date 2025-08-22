# P1-001: Numeric Precision Handling

## Priority
P1 - Core Feature

## Dependencies
- P0-004: Cursor Management (builds on string-based row data)

## Estimated Effort
3-4 hours

## Problem Statement
JavaScript's number type loses precision for large integers (>2^53) and decimals. Database values like BIGINT, DECIMAL(30,10), or monetary values get corrupted when converted to JavaScript numbers.

## Acceptance Criteria
- [x] Backend returns all numeric values as strings
- [x] Frontend detects numeric columns by type metadata
- [x] Special input component for numeric editing
- [x] Validation prevents invalid numeric input
- [x] Copy/paste preserves full precision
- [x] Export maintains original precision

## Implementation Notes

### Backend (Rust)
```rust
// src-tauri/src/database/value_converter.rs
pub fn row_to_strings(row: &PgRow, columns: &[ColumnMeta]) -> Vec<String> {
    columns.iter().enumerate().map(|(i, col)| {
        if row.try_get_raw(i).is_err() {
            return "null".to_string();
        }
        
        match col.db_type.to_uppercase().as_str() {
            // Numeric types - preserve exact value as string
            "BIGINT" | "INT8" => {
                row.try_get::<i64, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or("null".to_string())
            },
            "DECIMAL" | "NUMERIC" => {
                // Use rust_decimal for exact representation
                row.try_get::<Decimal, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or("null".to_string())
            },
            "REAL" | "FLOAT4" => {
                row.try_get::<f32, _>(i)
                    .map(|v| format!("{:.}", v))  // Full precision
                    .unwrap_or("null".to_string())
            },
            "DOUBLE PRECISION" | "FLOAT8" => {
                row.try_get::<f64, _>(i)
                    .map(|v| format!("{:.}", v))
                    .unwrap_or("null".to_string())
            },
            // Other types...
            "BOOLEAN" | "BOOL" => {
                row.try_get::<bool, _>(i)
                    .map(|v| v.to_string())
                    .unwrap_or("null".to_string())
            },
            _ => {
                // Default: try to get as string
                row.try_get::<String, _>(i)
                    .unwrap_or_else(|_| "null".to_string())
            }
        }
    }).collect()
}

// Ensure ColumnMeta includes precision/scale
pub struct ColumnMeta {
    pub name: String,
    pub db_type: String,
    pub nullable: bool,
    pub precision: Option<i32>,  // Total digits
    pub scale: Option<i32>,      // Decimal places
    // ...
}
```

### Frontend (React/TypeScript)
```typescript
// src/components/cells/NumericCell.tsx
interface NumericCellProps {
  value: string;
  columnMeta: ColumnMeta;
  isEditing: boolean;
  onChange?: (value: string) => void;
}

export function NumericCell({ 
  value, 
  columnMeta, 
  isEditing, 
  onChange 
}: NumericCellProps) {
  const [editValue, setEditValue] = useState(value);
  const [isValid, setIsValid] = useState(true);
  
  const validateNumeric = useCallback((val: string) => {
    if (val === 'null' || val === '') return true;
    
    const { db_type, precision, scale } = columnMeta;
    
    if (db_type.includes('INT')) {
      // Integer validation
      const regex = /^-?\d+$/;
      if (!regex.test(val)) return false;
      
      // Check range for specific types
      if (db_type === 'SMALLINT') {
        const num = BigInt(val);
        return num >= -32768n && num <= 32767n;
      }
      if (db_type === 'INT' || db_type === 'INTEGER') {
        const num = BigInt(val);
        return num >= -2147483648n && num <= 2147483647n;
      }
      // BIGINT - just check it's a valid BigInt
      try {
        BigInt(val);
        return true;
      } catch {
        return false;
      }
    }
    
    if (db_type.includes('DECIMAL') || db_type.includes('NUMERIC')) {
      // Decimal validation with precision/scale
      const regex = /^-?\d+(\.\d+)?$/;
      if (!regex.test(val)) return false;
      
      if (precision && scale) {
        const parts = val.split('.');
        const integerDigits = parts[0].replace('-', '').length;
        const decimalDigits = parts[1]?.length || 0;
        
        return integerDigits <= (precision - scale) && 
               decimalDigits <= scale;
      }
    }
    
    return true;
  }, [columnMeta]);
  
  if (!isEditing) {
    // Display mode - format for readability
    const formatted = formatNumericDisplay(value, columnMeta);
    return (
      <div className="numeric-cell font-mono text-right">
        {formatted}
      </div>
    );
  }
  
  // Edit mode
  return (
    <input
      type="text"
      value={editValue}
      onChange={(e) => {
        const val = e.target.value;
        setEditValue(val);
        
        const valid = validateNumeric(val);
        setIsValid(valid);
        
        if (valid && onChange) {
          onChange(val);
        }
      }}
      className={cn(
        "w-full px-2 py-1 font-mono text-right",
        !isValid && "border-red-500 bg-red-50"
      )}
      placeholder={columnMeta.nullable ? "null" : undefined}
    />
  );
}

// Formatting helper
function formatNumericDisplay(value: string, meta: ColumnMeta): string {
  if (value === 'null' || value === '') return 'NULL';
  
  // Add thousand separators for integers
  if (meta.db_type.includes('INT')) {
    return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  
  // Format decimals with proper precision
  if (meta.db_type.includes('DECIMAL') || meta.db_type.includes('NUMERIC')) {
    const num = parseFloat(value);
    if (!isNaN(num) && meta.scale) {
      return num.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: meta.scale,
      });
    }
  }
  
  return value;
}

// src/utils/numeric.ts
export class NumericValue {
  constructor(private value: string) {}
  
  toString(): string {
    return this.value;
  }
  
  toBigInt(): bigint {
    return BigInt(this.value);
  }
  
  toDecimal(scale?: number): string {
    if (scale !== undefined) {
      // Apply scale truncation/rounding
      const parts = this.value.split('.');
      if (parts[1] && parts[1].length > scale) {
        // Round at scale position
        // Implementation needed...
      }
    }
    return this.value;
  }
  
  add(other: NumericValue): NumericValue {
    // Implement precise arithmetic
    // Could use decimal.js library
    return new NumericValue(/* result */);
  }
}
```

## Files to Modify
- Create `src-tauri/src/database/value_converter.rs` - String conversion utilities
- Update `src-tauri/src/database/cursor.rs` - Use string converter
- Create `src/components/cells/NumericCell.tsx` - Numeric display/edit component
- Create `src/utils/numeric.ts` - Numeric value utilities
- Update `src/components/DataViewer/VirtualRow.tsx` - Use NumericCell
- Update export functions to preserve string values

## Testing Requirements
1. **Unit Tests**
   - Test BigInt conversion and validation
   - Test decimal precision preservation
   - Test numeric range validation

2. **Integration Tests**
   - Insert/update large numbers
   - Test copy/paste of precise values
   - Export and reimport data

3. **Manual Testing**
   - Create table with BIGINT, DECIMAL(30,10)
   - Insert boundary values
   - Edit and save large numbers

## Success Metrics
- Zero precision loss for any numeric type
- Validation prevents invalid input
- Clear visual indication of numeric columns
- Copy/paste maintains exact values

## Notes
- Consider using decimal.js for client-side arithmetic
- May need special handling for money types
- Scientific notation support for very large/small numbers