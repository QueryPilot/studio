import { buildCrudTableKey } from "@/stores/crudStore";
import type {
  CrudCommand,
  CrudCommandFor,
  CrudDiffConflict,
  CrudDiffSnapshot,
  CrudImpactSummary,
  DataRowDiff,
  StructureDiffEntry,
} from "@/types/crud";
import { type DbType } from "./backend";
import { sqlDiffGenerator } from "./sqlDiffGenerator";

const DATA_OPERATION_TYPES = new Set<CrudCommand['type']>([
  'data.insert',
  'data.update',
  'data.delete',
]);

const STRUCTURE_OPERATION_TYPES = new Set<CrudCommand['type']>([
  'column.add',
  'column.modify',
  'column.drop',
  'column.rename',
  'index.create',
  'index.drop',
  'index.rename',
  'trigger.create',
  'trigger.drop',
  'trigger.enable',
  'trigger.disable',
  'fk.add',
  'fk.drop',
]);

interface DiffEngineOptions {
  readonly dbType: DbType;
}

const toDataRowDiff = (command: CrudCommandFor<'data.insert' | 'data.update' | 'data.delete'>): DataRowDiff => {
  const base = {
    primaryKey: command.payload.primaryKeys ?? {},
    operation:
      command.type === 'data.insert'
        ? 'insert'
        : command.type === 'data.update'
          ? 'update'
          : 'delete',
  } as DataRowDiff;

  switch (command.type) {
    case 'data.insert':
      return {
        ...base,
        after: command.payload.values,
      };
    case 'data.update':
      return {
        ...base,
        before: command.payload.oldValue && typeof command.payload.oldValue === 'object'
          ? { [command.payload.column]: command.payload.oldValue }
          : command.payload.oldValue !== undefined
            ? { [command.payload.column]: command.payload.oldValue }
            : undefined,
        after: { [command.payload.column]: command.payload.newValue },
      };
    case 'data.delete':
      return {
        ...base,
        before: command.payload.primaryKeys,
      };
    default:
      return base;
  }
};

const toStructureDiffEntry = (command: CrudCommand): StructureDiffEntry | null => {
  switch (command.type) {
    case 'column.add': {
      const cmd = command as CrudCommandFor<'column.add'>;
      return {
        path: `columns.${cmd.payload.column.name}`,
        changeType: 'added',
        after: cmd.payload.column as any,
      };
    }
    case 'column.modify': {
      const cmd = command as CrudCommandFor<'column.modify'>;
      return {
        path: `columns.${cmd.payload.columnName}`,
        changeType: 'modified',
        after: cmd.payload.newDefinition as any,
      };
    }
    case 'column.drop': {
      const cmd = command as CrudCommandFor<'column.drop'>;
      return {
        path: `columns.${cmd.payload.columnName}`,
        changeType: 'removed',
      };
    }
    case 'column.rename': {
      const cmd = command as CrudCommandFor<'column.rename'>;
      return {
        path: `columns.${cmd.payload.columnName}`,
        changeType: 'modified',
        after: { name: cmd.payload.newName },
      };
    }
    case 'index.create': {
      const cmd = command as CrudCommandFor<'index.create'>;
      return {
        path: `indexes.${cmd.payload.definition.name}`,
        changeType: 'added',
        after: cmd.payload.definition as any,
      };
    }
    case 'index.drop': {
      const cmd = command as CrudCommandFor<'index.drop'>;
      return {
        path: `indexes.${cmd.payload.indexName}`,
        changeType: 'removed',
      };
    }
    case 'index.rename': {
      const cmd = command as CrudCommandFor<'index.rename'>;
      return {
        path: `indexes.${cmd.payload.indexName}`,
        changeType: 'modified',
        after: { name: cmd.payload.newName },
      };
    }
    case 'trigger.create': {
      const cmd = command as CrudCommandFor<'trigger.create'>;
      return {
        path: `triggers.${cmd.payload.definition.name}`,
        changeType: 'added',
        after: cmd.payload.definition as any,
      };
    }
    case 'trigger.drop': {
      const cmd = command as CrudCommandFor<'trigger.drop'>;
      return {
        path: `triggers.${cmd.payload.triggerName}`,
        changeType: 'removed',
      };
    }
    case 'trigger.enable':
    case 'trigger.disable': {
      const cmd = command as CrudCommandFor<'trigger.enable'>;
      return {
        path: `triggers.${cmd.payload.triggerName}`,
        changeType: 'modified',
        after: { enabled: cmd.payload.enable },
      };
    }
    case 'fk.add': {
      const cmd = command as CrudCommandFor<'fk.add'>;
      return {
        path: `foreignKeys.${cmd.payload.definition.name}`,
        changeType: 'added',
        after: cmd.payload.definition as any,
      };
    }
    case 'fk.drop': {
      const cmd = command as CrudCommandFor<'fk.drop'>;
      return {
        path: `foreignKeys.${cmd.payload.constraintName}`,
        changeType: 'removed',
      };
    }
    default:
      return null;
  }
};

const detectConflicts = (commands: CrudCommand[]): CrudDiffConflict[] => {
  const conflicts: CrudDiffConflict[] = [];
  const droppedColumns = new Set<string>();
  const renamedColumns = new Map<string, string>();

  for (const command of commands) {
    if (command.type === 'column.drop') {
      const cmd = command as CrudCommandFor<'column.drop'>;
      droppedColumns.add(cmd.payload.columnName);
    }
    if (command.type === 'column.rename') {
      const cmd = command as CrudCommandFor<'column.rename'>;
      renamedColumns.set(cmd.payload.columnName, cmd.payload.newName);
    }
  }

  for (const command of commands) {
    if (command.type === 'data.update') {
      const cmd = command as CrudCommandFor<'data.update'>;
      if (droppedColumns.has(cmd.payload.column)) {
        conflicts.push({
          id: `${cmd.id}-column-drop-conflict`,
          severity: 'error',
          message: `Column ${cmd.payload.column} is scheduled to be dropped but also updated`,
          relatedCommandIds: [cmd.id],
          resolutionHint: 'Remove the update or cancel the column drop.',
        });
      }

      if (renamedColumns.has(cmd.payload.column)) {
        conflicts.push({
          id: `${cmd.id}-column-rename-conflict`,
          severity: 'warning',
          message: `Column ${cmd.payload.column} is being renamed to ${renamedColumns.get(cmd.payload.column)}`,
          relatedCommandIds: [cmd.id],
          resolutionHint: 'Ensure the update uses the new column name.',
        });
      }
    }
  }

  return conflicts;
};

const buildImpacts = (dataCount: number, structureCount: number): CrudImpactSummary[] => {
  const impacts: CrudImpactSummary[] = [];
  if (dataCount > 0) {
    impacts.push({
      type: 'rowImpact',
      severity: 'info',
      message: `${dataCount} data operation${dataCount > 1 ? 's' : ''}`,
    });
  }
  if (structureCount > 0) {
    impacts.push({
      type: 'schemaChange',
      severity: 'warning',
      message: `${structureCount} schema modification${structureCount > 1 ? 's' : ''}`,
    });
  }
  return impacts;
};

export class DiffEngine {
  generateSnapshots(commands: CrudCommand[], options: DiffEngineOptions): CrudDiffSnapshot[] {
    const grouped = this.groupByTable(commands);
    const snapshots: CrudDiffSnapshot[] = [];

    for (const [tableKey, tableCommands] of grouped.entries()) {
      const dataCommands = tableCommands.filter((command) => DATA_OPERATION_TYPES.has(command.type));
      const structureCommands = tableCommands.filter((command) => STRUCTURE_OPERATION_TYPES.has(command.type));

      const dataDiff: DataRowDiff[] = dataCommands.map((command) =>
        toDataRowDiff(command as CrudCommandFor<'data.insert' | 'data.update' | 'data.delete'>),
      );

      const structureDiff: StructureDiffEntry[] = structureCommands
        .map((command) => toStructureDiffEntry(command))
        .filter((entry): entry is StructureDiffEntry => entry !== null);

      const sqlResult = sqlDiffGenerator.generateSql(tableCommands, options.dbType);
      const conflicts = detectConflicts(tableCommands);
      const impacts = buildImpacts(dataDiff.length, structureDiff.length);

      snapshots.push({
        tableKey,
        dataDiff,
        structureDiff,
        sqlStatements: sqlResult.statements,
        conflicts,
        impacts,
      });
    }

    return snapshots;
  }

  private groupByTable(commands: CrudCommand[]): Map<string, CrudCommand[]> {
    const grouped = new Map<string, CrudCommand[]>();
    for (const command of commands) {
      const tableKey = buildCrudTableKey(command.target);
      const bucket = grouped.get(tableKey) ?? [];
      bucket.push(command);
      grouped.set(tableKey, bucket);
    }
    return grouped;
  }
}

export const diffEngine = new DiffEngine();

