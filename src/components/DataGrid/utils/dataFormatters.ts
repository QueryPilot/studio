import type { TableDataRow } from '@/services/tableDataTypes';
import type { ColumnMeta } from '@/types/database';

export function formatRowsAsJson(rows: TableDataRow[]): string {
  return JSON.stringify(rows, null, 2);
}

export function formatRowsAsCsv(rows: TableDataRow[], columns: ColumnMeta[]): string {
  if (rows.length === 0) return '';
  
  const headers = columns.map(col => col.name);
  const csvHeaders = headers.map(escapeCSV).join(',');
  
  const csvRows = rows.map(row => {
    return headers.map(header => {
      const value = row[header];
      return escapeCSV(formatCellValue(value));
    }).join(',');
  });
  
  return [csvHeaders, ...csvRows].join('\n');
}

export function formatRowsAsMarkdown(rows: TableDataRow[], columns: ColumnMeta[]): string {
  if (rows.length === 0) return '';
  
  const headers = columns.map(col => col.name);
  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
  
  const dataRows = rows.map(row => {
    const values = headers.map(header => {
      const value = row[header];
      return formatCellValue(value);
    });
    return `| ${values.join(' | ')} |`;
  });
  
  return [headerRow, separatorRow, ...dataRows].join('\n');
}

export function formatRowsAsSql(
  rows: TableDataRow[], 
  columns: ColumnMeta[], 
  tableName: string
): string {
  if (rows.length === 0) return '';
  
  const statements = rows.map(row => {
    const columnNames = columns.map(col => `\`${col.name}\``).join(', ');
    const values = columns.map(col => {
      const value = row[col.name];
      return formatSqlValue(value, col);
    }).join(', ');
    
    return `INSERT INTO \`${tableName}\` (${columnNames}) VALUES (${values});`;
  });
  
  return statements.join('\n');
}

function escapeCSV(value: string): string {
  if (value === null || value === undefined) return '';
  
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatCellValue(value: any): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatSqlValue(value: any, column: ColumnMeta): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  
  // Handle different data types
  const dataType = column.db_type.toUpperCase();
  
  // Numeric types
  if (
    dataType.includes('INT') ||
    dataType.includes('DECIMAL') ||
    dataType.includes('NUMERIC') ||
    dataType.includes('FLOAT') ||
    dataType.includes('DOUBLE') ||
    dataType.includes('REAL')
  ) {
    return String(value);
  }
  
  // Boolean type
  if (dataType.includes('BOOL')) {
    return value ? 'TRUE' : 'FALSE';
  }
  
  // JSON type
  if (dataType.includes('JSON')) {
    const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
    return `'${jsonStr.replace(/'/g, "''")}'`;
  }
  
  // Default: treat as string
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

export function copyCellValue(value: any): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function copyRows(rows: TableDataRow[], columns: ColumnMeta[]): string {
  return rows.map(row => {
    return columns.map(col => {
      const value = row[col.name];
      return formatCellValue(value);
    }).join('\t');
  }).join('\n');
}