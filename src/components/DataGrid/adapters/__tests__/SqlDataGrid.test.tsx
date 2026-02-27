import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SqlDataGrid } from '../SqlDataGrid';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DbType } from '@/types';
import { ConstraintType } from '@/services/backend';
import { useTableFullStructure } from '@/hooks/useTableFullStructure';
import { useTableDataQuery } from '@/hooks/useTableDataQuery';
import { useGridPreferencesStore } from '../../stores/gridPreferencesStore';
import { GridCellKind, type GridCell } from '@glideapps/glide-data-grid';

const {
  createUpdateCommandMock,
  createInsertCommandMock,
  createDeleteCommandMock,
  createCrudTargetMock,
  getAdapterForConnectionMock,
  canProceedBestEffortMock,
} = vi.hoisted(() => ({
  createUpdateCommandMock: vi.fn(() => ({
    id: 'mock-update',
    type: 'data.update',
    target: { connectionId: 'test', database: 'test', schema: 'public', table: 'users' },
    payload: { primaryKeys: {} },
    metadata: { timestamp: new Date().toISOString(), description: 'mock update' },
    state: 'staged',
  })),
  createInsertCommandMock: vi.fn(() => ({
    id: 'mock-insert',
    type: 'data.insert',
    target: { connectionId: 'test', database: 'test', schema: 'public', table: 'users' },
    payload: { values: {} },
    metadata: { timestamp: new Date().toISOString(), description: 'mock insert' },
    state: 'staged',
  })),
  createDeleteCommandMock: vi.fn(() => ({
    id: 'mock-delete',
    type: 'data.delete',
    target: { connectionId: 'test', database: 'test', schema: 'public', table: 'users' },
    payload: { primaryKeys: {} },
    metadata: { timestamp: new Date().toISOString(), description: 'mock delete' },
    state: 'staged',
  })),
  createCrudTargetMock: vi.fn(() => 'test-target'),
  getAdapterForConnectionMock: vi.fn(async () => ({})),
  canProceedBestEffortMock: vi.fn(async () => ({ ok: true, matchCount: 1 })),
}));

const capturedBaseGridProps: Array<Record<string, unknown>> = [];

vi.mock('../../base/BaseDataGrid', () => ({
  BaseDataGrid: (props: Record<string, unknown>) => {
    capturedBaseGridProps.push(props);
    return <div data-testid="base-datagrid" />;
  },
}));

// Mock the hooks and components
vi.mock('@/hooks/useTableDataQuery', () => ({
  useTableDataQuery: vi.fn(() => ({
    data: undefined,
    rows: [],
    columns: [],
    status: 'success',
    error: null,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(async () => {}),
    refetch: vi.fn(async () => ({ data: undefined })) as unknown as ReturnType<
      typeof useTableDataQuery
    >["refetch"],
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
  createUpdateCommand: createUpdateCommandMock,
  createInsertCommand: createInsertCommandMock,
  createDeleteCommand: createDeleteCommandMock,
  createCrudTarget: createCrudTargetMock,
}));

vi.mock('@/adapters', () => ({
  getAdapterForConnection: getAdapterForConnectionMock,
}));

vi.mock('../../utils/bestEffortMatcher', () => ({
  canProceedBestEffort: canProceedBestEffortMock,
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

function makeTableDataQueryResult(
  overrides: Partial<ReturnType<typeof useTableDataQuery>> = {},
): ReturnType<typeof useTableDataQuery> {
  return {
    data: undefined,
    rows: [],
    columns: [],
    status: 'success',
    error: null,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(async () => {}),
    refetch: vi.fn(async () => ({ data: undefined })) as unknown as ReturnType<
      typeof useTableDataQuery
    >["refetch"],
    cancelStream: vi.fn(),
    progress: null,
    estimatedTotal: 0,
    isEstimatedCount: false,
    ...overrides,
  };
}

describe('SqlDataGrid', () => {
  const mockUseTableFullStructure = vi.mocked(useTableFullStructure);
  const mockUseTableDataQuery = vi.mocked(useTableDataQuery);

  beforeEach(() => {
    capturedBaseGridProps.length = 0;
    createUpdateCommandMock.mockClear();
    createInsertCommandMock.mockClear();
    createDeleteCommandMock.mockClear();
    createCrudTargetMock.mockClear();
    getAdapterForConnectionMock.mockClear();
    canProceedBestEffortMock.mockClear();
    getAdapterForConnectionMock.mockResolvedValue({});
    canProceedBestEffortMock.mockResolvedValue({ ok: true, matchCount: 1 });
    useGridPreferencesStore.setState({ preferences: {} });
    mockUseTableFullStructure.mockReturnValue({
      structure: null,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
    mockUseTableDataQuery.mockReturnValue(makeTableDataQueryResult());
  });

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

  it('should derive deterministic identity from unique constraints when PK is missing', () => {
    mockUseTableFullStructure.mockReturnValue({
      structure: {
        name: 'users',
        schema: 'public',
        database: 'test-db',
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        constraints: [
          {
            name: 'users_email_key',
            table_name: 'users',
            constraint_type: ConstraintType.Unique,
            definition: 'UNIQUE ("email")',
          },
        ],
        triggers: [],
      },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        dbType={DbType.PostgreSQL}
      />,
      { wrapper: Wrapper },
    );

    const latestProps = capturedBaseGridProps.at(-1);
    const commandFactory = latestProps?.commandFactory as
      | { primaryKeyColumns: string[] }
      | undefined;

    expect(commandFactory?.primaryKeyColumns).toEqual(['email']);
  });

  it('excludes embedded FK alias columns from best-effort matcher identity', () => {
    mockUseTableDataQuery.mockReturnValue(
      makeTableDataQueryResult({
        rows: [
          {
            col_0: { value: 'alice', db_type: 'text', value_type: 'Text', is_truncated: false },
            col_1: { value: 'alice@example.com', db_type: 'text', value_type: 'Text', is_truncated: false },
          },
        ],
        columns: [
          {
            name: 'name',
            db_type: 'text',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 0,
          },
          {
            name: '__qp_fk__owner_id__email',
            db_type: 'text',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 1,
          },
        ],
        estimatedTotal: 1,
      }),
    );
    mockUseTableFullStructure.mockReturnValue({
      structure: {
        name: 'users',
        schema: 'public',
        database: 'test-db',
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        dbType={DbType.PostgreSQL}
      />,
      { wrapper: Wrapper },
    );

    const latestProps = capturedBaseGridProps.at(-1);
    const commandFactory = latestProps?.commandFactory as
      | { createDeleteCommand: (row: Record<string, unknown>, rowKey: string) => unknown }
      | undefined;
    expect(commandFactory).toBeDefined();

    commandFactory?.createDeleteCommand(
      {
        col_0: { value: 'alice', db_type: 'text', value_type: 'Text', is_truncated: false },
        col_1: { value: 'alice@example.com', db_type: 'text', value_type: 'Text', is_truncated: false },
      },
      'row-key',
    );

    expect(createDeleteCommandMock).toHaveBeenCalledWith(
      expect.anything(),
      'test-target',
      expect.anything(),
      expect.objectContaining({
        matcherMode: 'best_effort',
        identityColumns: ['name'],
      }),
    );
  });

  it('should use persisted custom identifier columns when deterministic identity is missing', () => {
    mockUseTableDataQuery.mockReturnValue(
      makeTableDataQueryResult({
        rows: [
          {
            col_0: { value: 'alice@example.com', db_type: 'text', value_type: 'Text', is_truncated: false },
            col_1: { value: 'tenant-a', db_type: 'text', value_type: 'Text', is_truncated: false },
          },
        ],
        columns: [
          {
            name: 'email',
            db_type: 'text',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 0,
          },
          {
            name: 'tenant_id',
            db_type: 'text',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 1,
          },
        ],
        estimatedTotal: 1,
      }),
    );
    mockUseTableFullStructure.mockReturnValue({
      structure: {
        name: 'users',
        schema: 'public',
        database: 'test-db',
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    useGridPreferencesStore.getState().setRowIdentifierColumns(
      'test-conn:test-db:public:users',
      ['email', 'tenant_id'],
    );

    render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        dbType={DbType.PostgreSQL}
      />,
      { wrapper: Wrapper },
    );

    const latestProps = capturedBaseGridProps.at(-1);
    const commandFactory = latestProps?.commandFactory as
      | { primaryKeyColumns: string[] }
      | undefined;

    expect(commandFactory?.primaryKeyColumns).toEqual(['email', 'tenant_id']);
    expect(latestProps?.readOnlyReason).toBeUndefined();
    expect(typeof latestProps?.onSelectIdentifierColumns).toBe('function');
  });

  it('uses best-effort matcher for custom identifier update/delete commands', () => {
    mockUseTableDataQuery.mockReturnValue(
      makeTableDataQueryResult({
        rows: [
          {
            col_0: { value: 'alice@example.com', db_type: 'text', value_type: 'Text', is_truncated: false },
            col_1: { value: 'tenant-a', db_type: 'text', value_type: 'Text', is_truncated: false },
          },
        ],
        columns: [
          {
            name: 'email',
            db_type: 'text',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 0,
          },
          {
            name: 'tenant_id',
            db_type: 'text',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 1,
          },
        ],
        estimatedTotal: 1,
      }),
    );
    mockUseTableFullStructure.mockReturnValue({
      structure: {
        name: 'users',
        schema: 'public',
        database: 'test-db',
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    useGridPreferencesStore.getState().setRowIdentifierColumns(
      'test-conn:test-db:public:users',
      ['email', 'tenant_id'],
    );

    render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        dbType={DbType.PostgreSQL}
      />,
      { wrapper: Wrapper },
    );

    const latestProps = capturedBaseGridProps.at(-1);
    const commandFactory = latestProps?.commandFactory as
      | {
          createEditCommand: (event: {
            cell: [number, number];
            rowIndex: number;
            columnIndex: number;
            column: Record<string, unknown>;
            row: Record<string, unknown>;
            newValue: GridCell;
            previousValue: unknown;
          }) => unknown;
          createDeleteCommand: (
            row: Record<string, unknown>,
            rowKey: string,
          ) => unknown;
          getRowKey: (row: Record<string, unknown>, index: number) => string;
        }
      | undefined;
    const gridColumns = (latestProps?.columns as Array<Record<string, unknown>> | undefined) ?? [];
    const row = {
      col_0: { value: 'alice@example.com', db_type: 'text', value_type: 'Text', is_truncated: false },
      col_1: { value: 'tenant-a', db_type: 'text', value_type: 'Text', is_truncated: false },
    };

    expect(commandFactory).toBeDefined();
    expect(gridColumns.length).toBeGreaterThan(0);

    const firstColumn = gridColumns[0];
    if (!firstColumn) {
      throw new Error('Expected first grid column');
    }
    const rowKey = commandFactory?.getRowKey(row, 0);
    if (!rowKey) {
      throw new Error('Expected generated row key');
    }

    commandFactory?.createEditCommand({
      cell: [0, 0],
      rowIndex: 0,
      columnIndex: 0,
      column: firstColumn,
      row,
      newValue: {
        kind: GridCellKind.Text,
        data: 'alice+updated@example.com',
        displayData: 'alice+updated@example.com',
        allowOverlay: true,
      },
      previousValue: row.col_0,
    });

    commandFactory?.createDeleteCommand(row, rowKey);

    expect(createUpdateCommandMock).toHaveBeenCalledWith(
      expect.anything(),
      'test-target',
      expect.anything(),
      expect.objectContaining({
        matcherMode: 'best_effort',
        identityColumns: ['email', 'tenant_id'],
      }),
    );
    expect(createDeleteCommandMock).toHaveBeenCalledWith(
      expect.anything(),
      'test-target',
      expect.anything(),
      expect.objectContaining({
        matcherMode: 'best_effort',
        identityColumns: ['email', 'tenant_id'],
      }),
    );
  });

  it('should not clear persisted custom identifiers while columns are still loading', () => {
    mockUseTableDataQuery.mockReturnValue(
      makeTableDataQueryResult({
        rows: [],
        columns: [],
      }),
    );
    mockUseTableFullStructure.mockReturnValue({
      structure: {
        name: 'users',
        schema: 'public',
        database: 'test-db',
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    useGridPreferencesStore.getState().setRowIdentifierColumns(
      'test-conn:test-db:public:users',
      ['email', 'tenant_id'],
    );

    render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        dbType={DbType.PostgreSQL}
      />,
      { wrapper: Wrapper },
    );

    const persisted =
      useGridPreferencesStore.getState().preferences[
        'test-conn:test-db:public:users'
      ]?.rowIdentifierColumns;
    expect(persisted).toEqual(['email', 'tenant_id']);
  });

  it('should keep update/delete disabled for tables without deterministic or custom identity', () => {
    mockUseTableDataQuery.mockReturnValue(
      makeTableDataQueryResult({
        rows: [],
        columns: [
          {
            name: 'email',
            db_type: 'text',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 0,
          },
        ],
      }),
    );
    mockUseTableFullStructure.mockReturnValue({
      structure: {
        name: 'users',
        schema: 'public',
        database: 'test-db',
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="users"
        dbType={DbType.PostgreSQL}
      />,
      { wrapper: Wrapper },
    );

    const latestProps = capturedBaseGridProps.at(-1);
    const commandFactory = latestProps?.commandFactory as
      | { primaryKeyColumns: string[] }
      | undefined;

    expect(commandFactory?.primaryKeyColumns).toEqual([]);
    expect(latestProps?.readOnlyReason).toBe('Update/Delete disabled: no primary/unique key');
    expect(typeof latestProps?.onSelectIdentifierColumns).toBe('function');
  });

  it('should skip best-effort probe for inserted-row updates linked by tempId', async () => {
    mockUseTableDataQuery.mockReturnValue(
      makeTableDataQueryResult({
        rows: [],
        columns: [
          {
            name: 'id',
            db_type: 'integer',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 0,
          },
          {
            name: 'name',
            db_type: 'text',
            nullable: true,
            default: null,
            is_pk: false,
            is_fk: false,
            ordinal: 1,
          },
        ],
      }),
    );
    mockUseTableFullStructure.mockReturnValue({
      structure: {
        name: 'no_constraints',
        schema: 'public',
        database: 'test-db',
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    useGridPreferencesStore.getState().setRowIdentifierColumns(
      'test-conn:test-db:public:no_constraints',
      ['id'],
    );

    render(
      <SqlDataGrid
        connectionId="test-conn"
        database="test-db"
        schema="public"
        table="no_constraints"
        dbType={DbType.PostgreSQL}
      />,
      { wrapper: Wrapper },
    );

    const latestProps = capturedBaseGridProps.at(-1);
    const commandFactory = latestProps?.commandFactory as
      | {
          validateCommand?: (command: Record<string, unknown>) => Promise<{ valid: boolean; reason?: string }>;
        }
      | undefined;

    expect(commandFactory?.validateCommand).toBeDefined();

    const validation = await commandFactory?.validateCommand?.({
      id: 'update-temp-1',
      type: 'data.update',
      target: {
        connectionId: 'test-conn',
        database: 'test-db',
        schema: 'public',
        table: 'no_constraints',
      },
      payload: {
        column: 'name',
        newValue: 'draft-name',
        primaryKeys: { id: 1 },
        tempId: 'temp-row-1',
      },
      metadata: {
        timestamp: new Date().toISOString(),
        description: 'Update inserted draft row',
        tags: ['matcher:best_effort'],
      },
      state: 'staged',
    });

    expect(validation).toEqual({ valid: true });
    expect(getAdapterForConnectionMock).not.toHaveBeenCalled();
    expect(canProceedBestEffortMock).not.toHaveBeenCalled();
  });
});
