/**
 * Sample DataTable implementation for testing and demonstration
 */
import { useState, useCallback } from 'react';
import { DataTable } from '../DataTable';
import type { 
  DataTableRow, 
  ColumnDefinition, 
  CellValue 
} from '../types';

// Sample data generation
function createSampleCellValue(value: unknown, valueType: CellValue['value_type'], dbType: string): CellValue {
  return {
    value,
    db_type: dbType,
    value_type: valueType,
    is_truncated: false,
    metadata: valueType === 'Decimal' ? { precision: 10, scale: 2 } : undefined,
  };
}

function generateSampleData(count: number): DataTableRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: createSampleCellValue(i + 1, 'Integer', 'INT'),
    name: createSampleCellValue(`User ${i + 1}`, 'Text', 'VARCHAR(255)'),
    email: createSampleCellValue(`user${i + 1}@example.com`, 'Text', 'VARCHAR(255)'),
    age: createSampleCellValue(Math.floor(Math.random() * 50) + 18, 'Integer', 'INT'),
    salary: createSampleCellValue(Number((Math.random() * 100000 + 30000).toFixed(2)), 'Decimal', 'DECIMAL(10,2)'),
    active: createSampleCellValue(Math.random() > 0.3, 'Boolean', 'BOOLEAN'),
    created_at: createSampleCellValue(
      new Date(2020 + Math.floor(Math.random() * 4), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString(),
      'DateTime',
      'TIMESTAMP'
    ),
    profile: createSampleCellValue(
      JSON.stringify({ location: `City ${i + 1}`, department: 'Engineering' }),
      'Json',
      'JSON'
    ),
  }));
}

const sampleColumns: ColumnDefinition[] = [
  {
    id: 'id',
    name: 'ID',
    dbType: 'INT',
    valueType: 'Integer',
    width: 80,
    sortable: true,
    editable: false,
  },
  {
    id: 'name',
    name: 'Name',
    dbType: 'VARCHAR(255)',
    valueType: 'Text',
    width: 150,
    sortable: true,
    editable: true,
  },
  {
    id: 'email',
    name: 'Email',
    dbType: 'VARCHAR(255)',
    valueType: 'Text',
    width: 200,
    sortable: true,
    editable: true,
  },
  {
    id: 'age',
    name: 'Age',
    dbType: 'INT',
    valueType: 'Integer',
    width: 80,
    sortable: true,
    editable: true,
  },
  {
    id: 'salary',
    name: 'Salary',
    dbType: 'DECIMAL(10,2)',
    valueType: 'Decimal',
    width: 120,
    sortable: true,
    editable: true,
    metadata: { precision: 10, scale: 2 },
  },
  {
    id: 'active',
    name: 'Active',
    dbType: 'BOOLEAN',
    valueType: 'Boolean',
    width: 80,
    sortable: true,
    editable: true,
  },
  {
    id: 'created_at',
    name: 'Created At',
    dbType: 'TIMESTAMP',
    valueType: 'DateTime',
    width: 180,
    sortable: true,
    editable: false,
  },
  {
    id: 'profile',
    name: 'Profile',
    dbType: 'JSON',
    valueType: 'Json',
    width: 200,
    sortable: false,
    editable: true,
  },
];

interface SampleDataTableProps {
  className?: string;
}

export function SampleDataTable({ className }: SampleDataTableProps) {
  const [data] = useState(() => generateSampleData(1000));
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [isLoading] = useState(false);

  const handleRowSelect = useCallback((rows: DataTableRow[], mode: 'single' | 'range' | 'toggle') => {
    const rowIds = rows.map(row => String(row.id?.value || ''));
    
    setSelectedRows(prev => {
      const newSelection = new Set(prev);
      
      if (mode === 'single') {
        newSelection.clear();
        rowIds.forEach(id => newSelection.add(id));
      } else if (mode === 'toggle') {
        rowIds.forEach(id => {
          if (newSelection.has(id)) {
            newSelection.delete(id);
          } else {
            newSelection.add(id);
          }
        });
      } else if (mode === 'range') {
        // Simple range selection - just add all row IDs for demo
        rowIds.forEach(id => newSelection.add(id));
      }
      
      return newSelection;
    });
  }, []);

  const handleCellEdit = useCallback((rowId: string, field: string, value: CellValue) => {
    console.log(`Edit cell: Row ${rowId}, Field ${field}, New value:`, value);
    // TODO: Implement actual data update
  }, []);

  const handleRowDelete = useCallback((rows: DataTableRow[]) => {
    console.log('Delete rows:', rows.map(row => row.id?.value || ''));
    // TODO: Implement actual row deletion
  }, []);

  const handleCopyRows = useCallback((rows: DataTableRow[], format: 'json' | 'csv' | 'insert') => {
    console.log(`Copy ${rows.length} rows as ${format}`);
    // TODO: Implement actual copy functionality
  }, []);

  const handleLoadMore = useCallback(() => {
    console.log('Load more data');
    // TODO: Implement pagination
  }, []);

  return (
    <div className={className}>
      <div className="mb-4 text-sm text-muted-foreground">
        Sample DataTable with 1,000 rows • Selected: {selectedRows.size} rows
      </div>
      <DataTable
        data={data}
        columns={sampleColumns}
        isLoading={isLoading}
        rowIdField="id"
        selectedRows={selectedRows}
        onRowSelect={handleRowSelect}
        onCellEdit={handleCellEdit}
        onRowDelete={handleRowDelete}
        onCopyRows={handleCopyRows}
        onLoadMore={handleLoadMore}
        hasNextPage={false}
        editableColumns={new Set(['name', 'email', 'age', 'salary', 'active', 'profile'])}
      />
    </div>
  );
}