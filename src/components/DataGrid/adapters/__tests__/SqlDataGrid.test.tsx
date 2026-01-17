import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SqlDataGrid } from '../SqlDataGrid';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

vi.mock('@/stores/crudStore', () => ({
  useCrudStore: vi.fn((selector) => {
    const store = {
      commands: {},
      stageCommand: vi.fn(),
    };
    return selector ? selector(store) : store;
  }),
}));

vi.mock('@/stores/dataInvalidationStore', () => ({
  useDataInvalidationStore: vi.fn((selector) => {
    const store = {
      registerListener: vi.fn(() => vi.fn()),
    };
    return selector ? selector(store) : store;
  }),
}));

vi.mock('../../components/StagingActionsToolbar', () => ({
  StagingActionsToolbar: () => null,
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
        gridId="test-sql"
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
      />,
      { wrapper: Wrapper }
    );

    // Should render BaseDataGrid
    expect(container.querySelector('[data-testid="base-datagrid"]')).toBeInTheDocument();
  });

  it('should show Add Row button for tables', () => {
    render(
      <SqlDataGrid
        gridId="test-sql"
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        kind="Table"
      />,
      { wrapper: Wrapper }
    );

    // Should have Add Row button in toolbar
    const toolbar = screen.queryByRole('button');
    expect(toolbar).toBeTruthy();
  });

  it('should not show Add Row button for views', () => {
    const { container } = render(
      <SqlDataGrid
        gridId="test-sql"
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="user_view"
        kind="View"
      />,
      { wrapper: Wrapper }
    );

    // Views should not have Add Row button
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0); // No Add Row button for views
  });
});
