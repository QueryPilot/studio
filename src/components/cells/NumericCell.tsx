import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ColumnMeta {
  name: string;
  db_type: string;
  nullable: boolean;
  precision?: number;
  scale?: number;
}

interface NumericCellProps {
  value: string | null;
  columnMeta: ColumnMeta;
  isEditing: boolean;
  onChange?: (value: string | null) => void;
  onEditComplete?: () => void;
  className?: string;
}

export function NumericCell({ 
  value, 
  columnMeta, 
  isEditing, 
  onChange,
  onEditComplete,
  className 
}: NumericCellProps) {
  const [editValue, setEditValue] = useState(value || '');
  const [isValid, setIsValid] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);
  
  const validateNumeric = useCallback((val: string): boolean => {
    if (val === '' || val === 'null') {
      return columnMeta.nullable;
    }
    
    const dbType = columnMeta.db_type.toUpperCase();
    
    // Integer validation
    if (dbType.includes('INT')) {
      const regex = /^-?\d+$/;
      if (!regex.test(val)) return false;
      
      try {
        const num = BigInt(val);
        
        // Check specific integer type ranges
        if (dbType === 'TINYINT' || dbType === 'INT1') {
          return num >= -128n && num <= 127n;
        }
        if (dbType === 'SMALLINT' || dbType === 'INT2') {
          return num >= -32768n && num <= 32767n;
        }
        if (dbType === 'MEDIUMINT') {
          return num >= -8388608n && num <= 8388607n;
        }
        if (dbType === 'INT' || dbType === 'INTEGER' || dbType === 'INT4') {
          return num >= -2147483648n && num <= 2147483647n;
        }
        // BIGINT - just validate it's a valid BigInt
        return true;
      } catch {
        return false;
      }
    }
    
    // Decimal/Numeric validation
    if (dbType.includes('DECIMAL') || dbType.includes('NUMERIC') || dbType === 'DEC') {
      const regex = /^-?\d+(\.\d+)?$/;
      if (!regex.test(val)) return false;
      
      if (columnMeta.precision && columnMeta.scale !== undefined) {
        const parts = val.replace('-', '').split('.');
        const integerDigits = parts[0].length;
        const decimalDigits = parts[1]?.length || 0;
        
        const maxIntegerDigits = (columnMeta.precision || 0) - (columnMeta.scale || 0);
        return integerDigits <= maxIntegerDigits && decimalDigits <= (columnMeta.scale || 0);
      }
      
      return true;
    }
    
    // Float/Real/Double validation
    if (dbType.includes('FLOAT') || dbType.includes('REAL') || dbType.includes('DOUBLE')) {
      // Allow scientific notation
      const regex = /^-?(\d+\.?\d*|\d*\.\d+)([eE][+-]?\d+)?$/;
      if (!regex.test(val)) {
        // Check for special values
        return ['NaN', 'Infinity', '-Infinity'].includes(val);
      }
      return true;
    }
    
    // Money type
    if (dbType === 'MONEY') {
      // Allow currency format
      const regex = /^-?\d+(\.\d{0,2})?$/;
      return regex.test(val);
    }
    
    return false;
  }, [columnMeta]);
  
  const formatForDisplay = useCallback((val: string | null): string => {
    if (!val || val === 'null') return 'NULL';
    
    const dbType = columnMeta.db_type.toUpperCase();
    
    // Format integers with thousand separators
    if (dbType.includes('INT') && !dbType.includes('POINT')) {
      const num = val.replace(/^-/, '');
      const formatted = num.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return val.startsWith('-') ? `-${formatted}` : formatted;
    }
    
    // Format decimals
    if (dbType.includes('DECIMAL') || dbType.includes('NUMERIC') || dbType === 'DEC') {
      const parts = val.split('.');
      const integerPart = parts[0]?.replace(/^-/, '') || '';
      const formatted = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const result = parts[0]?.startsWith('-') ? `-${formatted}` : formatted;
      
      if (parts[1]) {
        return `${result}.${parts[1]}`;
      }
      return result;
    }
    
    // Format money
    if (dbType === 'MONEY') {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(num);
      }
    }
    
    // Scientific notation for very large/small floats
    if (dbType.includes('FLOAT') || dbType.includes('REAL') || dbType.includes('DOUBLE')) {
      if (val.includes('e') || val.includes('E')) {
        return val; // Already in scientific notation
      }
      const num = parseFloat(val);
      if (!isNaN(num) && (Math.abs(num) > 1e6 || (Math.abs(num) < 1e-4 && num !== 0))) {
        return num.toExponential();
      }
    }
    
    return val;
  }, [columnMeta]);
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);
    
    const valid = validateNumeric(newValue);
    setIsValid(valid);
    
    if (valid && onChange) {
      onChange(newValue === '' ? null : newValue);
    }
  }, [validateNumeric, onChange]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isValid) {
        onEditComplete?.();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditValue(value || '');
      setIsValid(true);
      onEditComplete?.();
    }
  }, [isValid, value, onEditComplete]);
  
  if (!isEditing) {
    return (
      <div 
        className={cn(
          "font-mono text-right tabular-nums",
          value === null && "text-muted-foreground italic",
          className
        )}
      >
        {formatForDisplay(value)}
      </div>
    );
  }
  
  return (
    <input
      ref={inputRef}
      type="text"
      value={editValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={() => onEditComplete?.()}
      className={cn(
        "w-full h-full px-2 py-1 font-mono text-right tabular-nums",
        "bg-background border-0 outline-none focus:ring-2 focus:ring-primary/20",
        !isValid && "bg-destructive/10 text-destructive",
        className
      )}
      placeholder={columnMeta.nullable ? "NULL" : "Required"}
    />
  );
}

/**
 * Determines if a column type is numeric
 */
export function isNumericColumn(dbType: string): boolean {
  const type = dbType.toUpperCase();
  return (
    type.includes('INT') ||
    type.includes('DECIMAL') ||
    type.includes('NUMERIC') ||
    type.includes('FLOAT') ||
    type.includes('REAL') ||
    type.includes('DOUBLE') ||
    type === 'DEC' ||
    type === 'MONEY'
  );
}

/**
 * Parse numeric value for calculations
 */
export function parseNumericValue(value: string | null, dbType: string): number | bigint | null {
  if (!value || value === 'null') return null;
  
  const type = dbType.toUpperCase();
  
  // Use BigInt for large integers
  if (type.includes('BIGINT')) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  
  // Regular number for most cases
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}