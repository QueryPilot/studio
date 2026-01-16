import { GridCellKind, type GridCell } from '@glideapps/glide-data-grid';
import type { GridColumnV2, GridRowModel } from '../types';
import type { CrudCommand } from '@/types/crud';
import type { GridEditCommitEvent } from '../types';
import type { SqlDataSource as SqlDataSourceInterface, DataSourceIdentifier } from './types';

export interface SqlDataSourceConfig {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
}

/**
 * SQL data source implementation
 * Wraps SQL table data for the unified DataGrid
 */
export class SqlDataSource implements SqlDataSourceInterface {
  readonly paradigm = 'sql' as const;
  readonly connectionId: string;
  readonly identifier: Extract<DataSourceIdentifier, { type: 'table' }>;
  readonly editable = true;

  private columns: GridColumnV2[] = [];
  private rows: GridRowModel[] = [];
  private _isLoading = false;
  private _hasMore = false;

  constructor(config: SqlDataSourceConfig) {
    this.connectionId = config.connectionId;
    this.identifier = {
      type: 'table',
      database: config.database,
      schema: config.schema,
      table: config.table,
    };
  }

  getColumns(): GridColumnV2[] {
    return this.columns;
  }

  getRowCount(): number {
    return this.rows.length;
  }

  getRow(index: number): GridRowModel | undefined {
    return this.rows[index];
  }

  getCellContent(_row: number, _col: number): GridCell {
    // TODO: Implement cell rendering logic
    return {
      kind: GridCellKind.Text,
      data: '',
      displayData: '',
      allowOverlay: true,
    };
  }

  async fetchMore(_offset: number, _limit: number): Promise<void> {
    // TODO: Implement data fetching
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  get hasMore(): boolean {
    return this._hasMore;
  }

  createEditCommand(_event: GridEditCommitEvent): CrudCommand | null {
    // TODO: Implement edit command creation
    return null;
  }

  createInsertCommand(_values: Record<string, unknown>): CrudCommand {
    // TODO: Implement insert command creation
    throw new Error('Not implemented');
  }

  createDeleteCommand(_row: GridRowModel): CrudCommand {
    // TODO: Implement delete command creation
    throw new Error('Not implemented');
  }
}
