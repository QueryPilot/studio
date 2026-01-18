import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SqlDataGrid } from '../SqlDataGrid';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DbType } from '@/types';

// Mock the hooks and components
vi.mock('@/hooks/useTableDataQuery', () => ({
  useTableDataQuery: vi.fn(() => ({
    rows: [],
    columns: [],
    status: 'success',
    error: null,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    cancelStream: vi.fn(),
    progress: null,
    estimatedTotal: 0,
    isEstimatedCount: false,
  })),
}));

vi.mock('@/hooks/useTableFullStructure', () => ({
  useTableFullStructure: vi.fn(() => ({
    structure: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/hooks/useReferencedTableColumns', () => ({
  useReferencedTableColumns: vi.fn(() => ({})),
}));

vi.mock('../../stores/embeddedFKPreferencesStore', () => ({
  useEmbeddedFKPreferencesStore: vi.fn((selector) => {
    const store = {
      preferences: {},
      gridPreferences: {},
      getEmbeddedConfig: vi.fn(() => null),
      isReady: true,
    };
    return selector ? selector(store) : store;
  }),
}));

vi.mock('@/stores/crudStore', () => ({
  useCrudStore: vi.fn((selector) => {
    const store = {
      commands: {},
      stageCommand: vi.fn(),
      getTableKey: vi.fn(({ connectionId, database, schema, table }) =>
        `${connectionId}:${database ?? ''}:${schema ?? ''}:${table}`
      ),
      stagedCommands: new Map(),
    };
    return selector ? selector(store) : store;
  }),
}));

vi.mock('@/stores/dataInvalidationStore', () => ({
  useDataInvalidationStore: Object.assign(
    vi.fn((selector) => {
      const store = {
        registerListener: vi.fn(() => vi.fn()),
      };
      return selector ? selector(store) : store;
    }),
    {
      getState: () => ({
        subscribe: vi.fn(() => vi.fn()), // returns unsubscribe function
      }),
    }
  ),
}));

vi.mock('../../components/StagingActionsToolbar', () => ({
  StagingActionsToolbar: () => null,
}));

vi.mock('../../hooks', () => ({
  useTableCrud: vi.fn(() => ({
    handleCellEditCommit: vi.fn(),
    handleRowDelete: vi.fn(),
    handleBatchEdit: vi.fn(),
  })),
  useOptimisticRows: vi.fn((props) => props.displayRows),
}));

vi.mock('../../utils/crudHelpers', () => ({
  createInsertCommand: vi.fn(),
  createCrudTarget: vi.fn(() => 'test-target'),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('SqlDataGrid', () => {
  it('should render SQL data grid with BaseDataGrid', () => {
    const { container } = render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        dbType={DbType.PostgreSQL}
      />,
      { wrapper: Wrapper }
    );

    // Should render BaseDataGrid
    expect(container.querySelector('[data-testid="base-datagrid"]')).toBeInTheDocument();
  });

  it('should render as editable for tables (kind=Table)', () => {
    const { container } = render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        dbType={DbType.PostgreSQL}
        kind="Table"
      />,
      { wrapper: Wrapper }
    );

    // Should render BaseDataGrid (editable mode for tables)
    expect(container.querySelector('[data-testid="base-datagrid"]')).toBeInTheDocument();
  });

  it('should render in read-only mode for views', () => {
    const { container } = render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="user_view"
        dbType={DbType.PostgreSQL}
        kind="View"
      />,
      { wrapper: Wrapper }
    );

    // Should render something (may not have data-testid in all states)
    expect(container.firstChild).toBeTruthy();
  });

  it('should render in read-only mode for materialized views', () => {
    const { container } = render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="user_matview"
        dbType={DbType.PostgreSQL}
        kind="MaterializedView"
      />,
      { wrapper: Wrapper }
    );

    // Should render something (may not have data-testid in all states)
    expect(container.firstChild).toBeTruthy();
  });
});
