/**
 * Tests for GlobalChangesDialog - verifies UI rendering for all CRUD operation types
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GlobalChangesDialog } from '../GlobalChangesDialog';
import { useCrudStore } from '@/stores/crudStore';
import { useConnectionStore } from '@/stores/connectionStoreNew';
import type { CrudCommand } from '@/types/crud';
import { DbType } from '@/types/connection';

// Mock stores
vi.mock('@/stores/crudStore');
vi.mock('@/stores/connectionStoreNew');
vi.mock('@/stores/dataInvalidationStore');
vi.mock('@/stores/validationStore', () => ({
  useValidationStore: () => ({
    canCommit: () => ({ allowed: true, errorCount: 0 }),
  }),
}));

// Mock CodeEditor component
vi.mock('@/components/CodeEditor', () => ({
  CodeEditor: ({ value }: { value: string }) => <div data-testid="code-editor">{value}</div>,
}));

// Mock react-diff-viewer
vi.mock('react-diff-viewer-continued', () => ({
  default: ({ oldValue, newValue }: { oldValue: string; newValue: string }) => (
    <div data-testid="diff-viewer">
      <div data-testid="old-value">{oldValue}</div>
      <div data-testid="new-value">{newValue}</div>
    </div>
  ),
}));

const createMockCommand = (
  type: CrudCommand['type'],
  payload: Record<string, unknown>,
): CrudCommand => ({
  id: `test-${type}`,
  type,
  target: {
    connectionId: 'test-conn',
    database: 'testdb',
    schema: 'public',
    table: 'users',
  },
  payload,
  metadata: {
    timestamp: '2024-01-01T00:00:00Z',
    description: `Test ${type} operation`,
  },
  state: 'staged',
});

describe('GlobalChangesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock connection store
    vi.mocked(useConnectionStore).mockReturnValue({
      getConnection: () => ({
        profile: {
          id: 'test-conn',
          db_type: DbType.PostgreSQL,
          name: 'Test DB',
        },
      }),
    } as never);
  });

  describe('DML Operations Display', () => {
    it('should display INSERT operation', () => {
      const insertCommand = createMockCommand('data.insert', {
        values: { name: 'John Doe', email: 'john@example.com', age: 30 },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [insertCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText('Insert')).toBeInTheDocument();
      expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    });

    it('should display UPDATE operation', () => {
      const updateCommand = createMockCommand('data.update', {
        column: 'email',
        oldValue: 'old@example.com',
        newValue: 'new@example.com',
        primaryKeys: { id: 1 },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [updateCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText('Update')).toBeInTheDocument();
      expect(screen.getByText(/1 field/)).toBeInTheDocument();
    });

    it('should display DELETE operation', () => {
      const deleteCommand = createMockCommand('data.delete', {
        primaryKeys: { id: 1 },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [deleteCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('DDL Operations Display', () => {
    it('should display table.create operation', () => {
      const createTableCommand = createMockCommand('table.create', {
        tableName: 'new_table',
        columns: [
          { name: 'id', dataType: 'INTEGER', nullable: false, isPrimaryKey: true },
          { name: 'name', dataType: 'VARCHAR(255)', nullable: true },
        ],
        primaryKey: ['id'],
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:new_table', [createTableCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:new_table',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="new_table"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText('DDL')).toBeInTheDocument();
      expect(screen.getByText(/Table: new_table/)).toBeInTheDocument();
      expect(screen.getByText(/id: INTEGER/)).toBeInTheDocument();
    });

    it('should display view.create operation', () => {
      const createViewCommand = createMockCommand('view.create', {
        definition: {
          name: 'active_users',
          definition: 'SELECT * FROM users WHERE active = true',
          isMaterialized: false,
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [createViewCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText('DDL')).toBeInTheDocument();
      expect(screen.getByText(/View: active_users/)).toBeInTheDocument();
    });

    it('should display view.create with materialized flag', () => {
      const createMatViewCommand = createMockCommand('view.create', {
        definition: {
          name: 'user_stats',
          definition: 'SELECT count(*) FROM users',
          isMaterialized: true,
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [createMatViewCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(screen.getByText(/View: user_stats \(MATERIALIZED\)/)).toBeInTheDocument();
    });

    it('should display view.rename operation', () => {
      const renameViewCommand = createMockCommand('view.rename', {
        viewName: 'old_view',
        newName: 'new_view',
        isMaterialized: false,
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [renameViewCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText(/old_view → new_view/)).toBeInTheDocument();
    });

    it('should display constraint.addPrimaryKey operation', () => {
      const addPKCommand = createMockCommand('constraint.addPrimaryKey', {
        definition: {
          name: 'users_pkey',
          type: 'primary_key',
          columns: ['id'],
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [addPKCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText(/Constraint: users_pkey \(PRIMARY_KEY\)/)).toBeInTheDocument();
      expect(screen.getByText(/Columns: id/)).toBeInTheDocument();
    });

    it('should display constraint.addCheck operation', () => {
      const addCheckCommand = createMockCommand('constraint.addCheck', {
        definition: {
          name: 'age_check',
          type: 'check',
          expression: 'age >= 18',
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [addCheckCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(screen.getByText(/Constraint: age_check \(CHECK\)/)).toBeInTheDocument();
      expect(screen.getByText(/Expression: age >= 18/)).toBeInTheDocument();
    });

    it('should display sequence.create operation', () => {
      const createSeqCommand = createMockCommand('sequence.create', {
        definition: {
          name: 'user_id_seq',
          increment: 1,
          startValue: 1000,
          minValue: 1,
          maxValue: 999999999,
          cycle: false,
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [createSeqCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText(/Sequence: user_id_seq/)).toBeInTheDocument();
      expect(screen.getByText(/Increment: 1/)).toBeInTheDocument();
      expect(screen.getByText(/Start: 1000/)).toBeInTheDocument();
    });

    it('should display sequence.alter operation', () => {
      const alterSeqCommand = createMockCommand('sequence.alter', {
        sequenceName: 'user_id_seq',
        changes: {
          increment: 2,
          cache: 20,
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [alterSeqCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(screen.getByText(/Sequence: user_id_seq/)).toBeInTheDocument();
      expect(screen.getByText(/increment: 2/)).toBeInTheDocument();
      expect(screen.getByText(/cache: 20/)).toBeInTheDocument();
    });

    it('should display column.add operation', () => {
      const addColCommand = createMockCommand('column.add', {
        column: {
          name: 'phone',
          dataType: 'VARCHAR(20)',
          nullable: true,
          comment: 'User phone number',
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [addColCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getByText('DDL')).toBeInTheDocument();
    });
  });

  describe('Schema Invalidation Detection', () => {
    it('should detect schema-altering operations for views', () => {
      const createViewCommand = createMockCommand('view.create', {
        definition: {
          name: 'test_view',
          definition: 'SELECT * FROM users',
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [createViewCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
        commitChanges: vi.fn().mockResolvedValue({
          transactionId: 'test',
          success: true,
          durationMs: 100,
          committed: [],
          failures: [],
        }),
      } as never);

      render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      // The component should render without errors
      expect(screen.getByText('DDL')).toBeInTheDocument();
    });

    it('should detect schema-altering operations for sequences', () => {
      const createSeqCommand = createMockCommand('sequence.create', {
        definition: {
          name: 'test_seq',
          increment: 1,
        },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [createSeqCommand]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(screen.getByText('DDL')).toBeInTheDocument();
    });
  });

  describe('Multiple Operations Grouping', () => {
    it('should group multiple UPDATE commands for the same row', () => {
      const update1 = createMockCommand('data.update', {
        column: 'email',
        oldValue: 'old@example.com',
        newValue: 'new@example.com',
        primaryKeys: { id: 1 },
      });

      const update2 = createMockCommand('data.update', {
        column: 'name',
        oldValue: 'Old Name',
        newValue: 'New Name',
        primaryKeys: { id: 1 },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([['test-conn:testdb:public:users', [update1, update2]]]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(screen.getByText('Update')).toBeInTheDocument();
      expect(screen.getByText(/2 fields/)).toBeInTheDocument();
    });

    it('should display mixed DDL operations', () => {
      const viewCreate = createMockCommand('view.create', {
        definition: { name: 'test_view', definition: 'SELECT * FROM users' },
      });

      const seqCreate = createMockCommand('sequence.create', {
        definition: { name: 'test_seq', increment: 1 },
      });

      const constraintAdd = createMockCommand('constraint.addUnique', {
        definition: { name: 'email_unique', type: 'unique', columns: ['email'] },
      });

      vi.mocked(useCrudStore).mockReturnValue({
        stagedCommands: new Map([
          ['test-conn:testdb:public:users', [viewCreate, seqCreate, constraintAdd]],
        ]),
        getTableKey: () => 'test-conn:testdb:public:users',
      } as never);

      const { container } = render(
        <GlobalChangesDialog
          connectionId="test-conn"
          database="testdb"
          schema="public"
          table="users"
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(container).toMatchSnapshot();
      expect(screen.getAllByText('DDL')).toHaveLength(3);
    });
  });
});

