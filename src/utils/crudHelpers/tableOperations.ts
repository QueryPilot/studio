import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandTarget,
  TableTruncatePayload,
  TableDropPayload,
  TableDuplicatePayload,
} from "@/types/crud";

/**
 * Generate a unique command ID
 */
function generateCommandId(): string {
  return nanoid();
}

/**
 * Get current ISO timestamp
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a TRUNCATE TABLE command
 */
export function createTruncateCommand(
  target: CrudCommandTarget,
  tableName: string,
  options: { restartIdentity: boolean; cascade: boolean }
): CrudCommand<TableTruncatePayload> {
  const restartText = options.restartIdentity ? " RESTART IDENTITY" : "";
  const cascadeText = options.cascade ? " CASCADE" : "";
  
  return {
    id: generateCommandId(),
    type: "table.truncate",
    target: {
      ...target,
      table: tableName,
    },
    payload: {
      tableName,
      restartIdentity: options.restartIdentity,
      cascade: options.cascade,
    },
    metadata: {
      timestamp: getCurrentTimestamp(),
      description: `TRUNCATE ${tableName}${restartText}${cascadeText}`,
      source: "ui",
    },
    state: "staged",
  };
}

/**
 * Create a DROP TABLE command
 */
export function createDropTableCommand(
  target: CrudCommandTarget,
  tableName: string,
  cascade: boolean
): CrudCommand<TableDropPayload> {
  const cascadeText = cascade ? " CASCADE" : "";
  
  return {
    id: generateCommandId(),
    type: "table.drop",
    target: {
      ...target,
      table: tableName,
    },
    payload: {
      tableName,
      cascade,
      ifExists: false,
    },
    metadata: {
      timestamp: getCurrentTimestamp(),
      description: `DROP TABLE ${tableName}${cascadeText}`,
      source: "ui",
    },
    state: "staged",
  };
}

/**
 * Create a DUPLICATE TABLE command
 */
export function createDuplicateTableCommand(
  target: CrudCommandTarget,
  sourceTable: string,
  options: {
    newName: string;
    includeData: boolean;
    includeIndexes: boolean;
    includeConstraints: boolean;
    includeTriggers: boolean;
  }
): CrudCommand<TableDuplicatePayload> {
  const includeParts: string[] = [];
  if (options.includeData) includeParts.push("data");
  if (options.includeIndexes) includeParts.push("indexes");
  if (options.includeConstraints) includeParts.push("constraints");
  if (options.includeTriggers) includeParts.push("triggers");
  
  const includeText = includeParts.length > 0 
    ? ` (with ${includeParts.join(", ")})` 
    : " (structure only)";
  
  return {
    id: generateCommandId(),
    type: "table.duplicate",
    target: {
      ...target,
      table: sourceTable,
    },
    payload: {
      sourceTableName: sourceTable,
      newTableName: options.newName,
      includeData: options.includeData,
      includeIndexes: options.includeIndexes,
      includeConstraints: options.includeConstraints,
      includeTriggers: options.includeTriggers,
    },
    metadata: {
      timestamp: getCurrentTimestamp(),
      description: `Duplicate ${sourceTable} to ${options.newName}${includeText}`,
      source: "ui",
    },
    state: "staged",
  };
}

