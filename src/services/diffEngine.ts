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
import { DbType } from "./backend";
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
    case 'column.add':
      return {
        path: `columns.${command.payload.column.name}`,
        changeType: 'added',
        after: command.payload.column,
      };
    case 'column.modify':
      return {
        path: `columns.${command.payload.columnName}`,
        changeType: 'modified',
        after: command.payload.newDefinition,
      };
    case 'column.drop':
      return {
        path: `columns.${command.payload.columnName}`,
        changeType: 'removed',
      };
    case 'column.rename':
      return {
        path: `columns.${command.payload.columnName}`,
        changeType: 'modified',
        after: { name: command.payload.newName },
      };
    case 'index.create':
      return {
        path: `indexes.${command.payload.definition.name}`,
        changeType: 'added',
        after: command.payload.definition,
      };
    case 'index.drop':
      return {
        path: `indexes.${command.payload.indexName}`,
        changeType: 'removed',
      };
    case 'index.rename':
      return {
        path: `indexes.${command.payload.indexName}`,
        changeType: 'modified',
        after: { name: command.payload.newName },
      };
    case 'trigger.create':
      return {
        path: `triggers.${command.payload.definition.name}`,
        changeType: 'added',
        after: command.payload.definition,
      };
    case 'trigger.drop':
      return {
        path: `triggers.${command.payload.triggerName}`,
        changeType: 'removed',
      };
    case 'trigger.enable':
    case 'trigger.disable':
      return {
        path: `triggers.${command.payload.triggerName}`,
        changeType: 'modified',
        after: { enabled: command.payload.enable },
      };
    case 'fk.add':
      return {
        path: `foreignKeys.${command.payload.definition.name}`,
        changeType: 'added',
        after: command.payload.definition,
      };
    case 'fk.drop':
      return {
        path: `foreignKeys.${command.payload.constraintName}`,
        changeType: 'removed',
      };
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
      droppedColumns.add(command.payload.columnName);
    }
    if (command.type === 'column.rename') {
      renamedColumns.set(command.payload.columnName, command.payload.newName);
    }
  }

  for (const command of commands) {
    if (command.type === 'data.update' && droppedColumns.has(command.payload.column)) {
      conflicts.push({
        id: `${command.id}-column-drop-conflict`,
        severity: 'error',
        message: `Column ${command.payload.column} is scheduled to be dropped but also updated`,
        relatedCommandIds: [command.id],
        resolutionHint: 'Remove the update or cancel the column drop.',
      });
    }

    if (command.type === 'data.update' && renamedColumns.has(command.payload.column)) {
      conflicts.push({
        id: `${command.id}-column-rename-conflict`,
        severity: 'warning',
        message: `Column ${command.payload.column} is being renamed to ${renamedColumns.get(command.payload.column)}`,
        relatedCommandIds: [command.id],
        resolutionHint: 'Ensure the update uses the new column name.',
      });
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

