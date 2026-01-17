import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BaseDataGrid } from '../BaseDataGrid';
import type { GridRowModel, GridColumnV2 } from '@/components/DataGrid/types';

const mockRows: GridRowModel[] = [
  { col_0: { value: 'A', db_type: 'text', value_type: 'String', is_truncated: false } },
];

const mockColumns: GridColumnV2[] = [
  { id: 'col_0', field: 'col_0', title: 'Column 1', name: 'col1', width: 100, type: 'text' },
];

const mockGetCellContent = () => ({
  kind: 'text' as const,
  data: '',
  displayData: '',
  allowOverlay: false,
  readonly: true,
});

describe('BaseDataGrid', () => {
  it('should render with SQL paradigm', () => {
    const { container } = render(
      <BaseDataGrid
        gridId="test-sql"
        rows={mockRows}
        columns={mockColumns}
        getCellContent={mockGetCellContent}
        paradigm="sql"
        enableFiltering={true}
        enableSorting={true}
      />
    );

    expect(container.querySelector('[data-testid="base-datagrid"]')).toBeInTheDocument();
  });

  it('should render with document paradigm and breadcrumb nav', () => {
    const { container } = render(
      <BaseDataGrid
        gridId="test-doc"
        rows={mockRows}
        columns={mockColumns}
        getCellContent={mockGetCellContent}
        paradigm="document"
        topToolbar={<div data-testid="breadcrumb-nav">Breadcrumb</div>}
      />
    );

    expect(container.querySelector('[data-testid="breadcrumb-nav"]')).toBeInTheDocument();
  });
});
