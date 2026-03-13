import type { CrudCommand } from '@/types/crud';
import type { DocumentQueryable } from '@/adapters/capabilities';
import { logger } from '@/lib/logger';
import type {
  ExecuteResult,
  ExecuteError,
  OperationPreview,
  PreviewOp,
  ValidationResult,
  DocumentOperationExecutor as DocumentOperationExecutorInterface,
} from './types';

import {
  ARRAY_INDEX_FIELD,
  KV_KEY_FIELD,
  KV_VALUE_FIELD,
} from '@/components/DataGrid/hooks/useDocumentData';

/** Synthetic grid-only keys that must not reach MongoDB filters. */
const SYNTHETIC_KEYS: ReadonlySet<string> = new Set([
  KV_KEY_FIELD,
  KV_VALUE_FIELD,
  ARRAY_INDEX_FIELD,
]);

/** Remove synthetic grid keys (e.g. __kv_key) from primaryKeys before using as MongoDB filter. */
function stripSyntheticKeys(keys: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(keys)) {
    if (!SYNTHETIC_KEYS.has(k)) {
      result[k] = v;
    }
  }
  return result;
}

type MongoOperation = {
  type:
    | 'insert'
    | 'update'
    | 'delete'
    | 'createIndex'
    | 'dropIndex'
    | 'updateValidation';
  collection: string;
  database?: string;
  document?: object;
  filter?: object;
  update?: object;
  indexName?: string;
  indexKeys?: Record<string, 1 | -1 | 'text'>;
  indexOptions?: Record<string, unknown>;
  validation?: {
    validationJson?: string;
    clearValidator?: boolean;
    validationLevel?: 'off' | 'strict' | 'moderate';
    validationAction?: 'error' | 'warn';
  };
};

function safeParseJsonObject(
  value: string | undefined,
): Record<string, unknown> | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  throw new Error('Validation JSON must be an object');
}

export class DocumentOperationExecutor implements DocumentOperationExecutorInterface {
  readonly paradigm = 'document' as const;

  constructor(
    private adapter: DocumentQueryable,
    private connectionId: string,
  ) {}

  async execute(commands: CrudCommand[]): Promise<ExecuteResult> {
    logger.info('executor.document', `Executing ${commands.length} commands for ${this.connectionId}`);

    const errors: ExecuteError[] = [];
    let affectedCount = 0;

    const operations = this.commandsToOperations(commands);

    if (operations.length === 0) {
      logger.info('executor.document', 'No operations to execute');
      return { success: true, affectedCount: 0, errors: [] };
    }

    for (const { op, cmd } of this.zipOperationsWithCommands(commands)) {
      try {
        await this.executeOperation(op);
        affectedCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('executor.document', `Operation failed: ${message}`, op);

        errors.push({
          commandId: cmd.id,
          message,
        });
      }
    }

    const success = errors.length === 0;
    logger.info('executor.document', `Execution complete: ${affectedCount} succeeded, ${errors.length} failed`);

    return { success, affectedCount, errors };
  }

  preview(commands: CrudCommand[]): OperationPreview {
    const zipped = this.zipOperationsWithCommands(commands);

    const previewOps: PreviewOp[] = zipped.map(({ op, cmd }) => ({
      action: op.type,
      target: op.collection,
      description: this.getOperationDescription(op),
      before: this.getBeforeValue(cmd),
      after: this.getAfterValue(cmd),
    }));

    const operations = zipped.map(({ op }) => op);

    const content = this.generatePreviewContent(operations);

    return {
      type: 'mongo-ops',
      content,
      operations: previewOps,
    };
  }

  validate(command: CrudCommand): ValidationResult {
    const errors: string[] = [];

    if (!command.target.table) {
      errors.push('Collection name is required');
    }

    const supportedTypes = [
      'data.insert',
      'data.update',
      'data.delete',
      'document.index.create',
      'document.index.drop',
      'document.validation.update',
    ];
    if (!supportedTypes.includes(command.type)) {
      errors.push(`Unsupported operation type: ${command.type}`);
    }

    if (command.type === 'data.update') {
      const payload = command.payload as { primaryKeys?: unknown };
      if (!payload.primaryKeys) {
        errors.push('Update requires document identifier (_id)');
      }
    }

    if (command.type === 'data.delete') {
      const payload = command.payload as { primaryKeys?: unknown };
      if (!payload.primaryKeys) {
        errors.push('Delete requires document identifier (_id)');
      }
    }

    if (command.type === 'document.index.create') {
      const payload = command.payload as {
        definition?: { name?: string; keys?: Record<string, unknown> };
      };
      if (!payload.definition?.name) {
        errors.push('Document index create requires an index name');
      }
      if (!payload.definition?.keys || Object.keys(payload.definition.keys).length === 0) {
        errors.push('Document index create requires at least one index key');
      }
    }

    if (command.type === 'document.index.drop') {
      const payload = command.payload as { indexName?: string };
      if (!payload.indexName) {
        errors.push('Document index drop requires an index name');
      }
    }

    if (command.type === 'document.validation.update') {
      const payload = command.payload as { validationJson?: string };
      if (payload.validationJson?.trim()) {
        try {
          safeParseJsonObject(payload.validationJson);
        } catch (error) {
          errors.push(
            error instanceof Error ? error.message : 'Validation JSON is invalid',
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private commandsToOperations(commands: CrudCommand[]): MongoOperation[] {
    return commands
      .map((cmd) => this.commandToOperation(cmd))
      .filter((op): op is MongoOperation => op !== null);
  }

  private zipOperationsWithCommands(
    commands: CrudCommand[]
  ): Array<{ op: MongoOperation; cmd: CrudCommand }> {
    const result: Array<{ op: MongoOperation; cmd: CrudCommand }> = [];
    for (const cmd of commands) {
      const op = this.commandToOperation(cmd);
      if (op !== null) {
        result.push({ op, cmd });
      }
    }
    return result;
  }

  private commandToOperation(command: CrudCommand): MongoOperation | null {
    const collection = command.target.table;
    if (!collection) return null;
    const database = command.target.database;

    switch (command.type) {
      case 'data.insert': {
        const payload = command.payload as { values?: Record<string, unknown> };
        return {
          type: 'insert',
          collection,
          database,
          document: payload.values ?? {},
        };
      }

      case 'data.update': {
        const payload = command.payload as {
          primaryKeys?: Record<string, unknown>;
          column?: string;
          newValue?: unknown;
        };

        const filter = stripSyntheticKeys(payload.primaryKeys ?? {});
        const update = payload.column
          ? { $set: { [payload.column]: payload.newValue } }
          : {};

        return {
          type: 'update',
          collection,
          database,
          filter,
          update,
        };
      }

      case 'data.delete': {
        const payload = command.payload as { primaryKeys?: Record<string, unknown> };
        return {
          type: 'delete',
          collection,
          database,
          filter: stripSyntheticKeys(payload.primaryKeys ?? {}),
        };
      }

      case 'document.index.create': {
        const payload = command.payload as {
          definition?: {
            name?: string;
            keys?: Record<string, 1 | -1 | 'text'>;
            options?: Record<string, unknown>;
          };
        };

        return {
          type: 'createIndex',
          collection,
          database,
          indexName: payload.definition?.name,
          indexKeys: payload.definition?.keys,
          indexOptions: payload.definition?.options,
        };
      }

      case 'document.index.drop': {
        const payload = command.payload as { indexName?: string };
        return {
          type: 'dropIndex',
          collection,
          database,
          indexName: payload.indexName,
        };
      }

      case 'document.validation.update': {
        const payload = command.payload as {
          validationJson?: string;
          clearValidator?: boolean;
          validationLevel?: 'off' | 'strict' | 'moderate';
          validationAction?: 'error' | 'warn';
        };
        return {
          type: 'updateValidation',
          collection,
          database,
          validation: {
            validationJson: payload.validationJson,
            clearValidator: payload.clearValidator,
            validationLevel: payload.validationLevel,
            validationAction: payload.validationAction,
          },
        };
      }

      default:
        return null;
    }
  }

  private async executeOperation(op: MongoOperation): Promise<void> {
    switch (op.type) {
      case 'insert':
        if (op.database) {
          await this.adapter.insertDocument(op.collection, op.document ?? {}, op.database);
        } else {
          await this.adapter.insertDocument(op.collection, op.document ?? {});
        }
        break;

      case 'update':
        if (op.database) {
          await this.adapter.updateDocument(
            op.collection,
            op.filter ?? {},
            op.update ?? {},
            op.database,
          );
        } else {
          await this.adapter.updateDocument(op.collection, op.filter ?? {}, op.update ?? {});
        }
        break;

      case 'delete':
        if (op.database) {
          await this.adapter.deleteDocument(op.collection, op.filter ?? {}, op.database);
        } else {
          await this.adapter.deleteDocument(op.collection, op.filter ?? {});
        }
        break;

      case 'createIndex':
        if (op.database) {
          await this.adapter.createIndex(
            op.collection,
            op.indexKeys ?? {},
            op.indexOptions,
            op.database,
          );
        } else {
          await this.adapter.createIndex(
            op.collection,
            op.indexKeys ?? {},
            op.indexOptions,
          );
        }
        break;

      case 'dropIndex':
        if (op.database) {
          await this.adapter.dropIndex(op.collection, op.indexName ?? '', op.database);
        } else {
          await this.adapter.dropIndex(op.collection, op.indexName ?? '');
        }
        break;

      case 'updateValidation':
        if (op.database) {
          await this.adapter.updateCollectionValidation(op.collection, {
            ...(safeParseJsonObject(op.validation?.validationJson) ?? {}),
            clearValidator: op.validation?.clearValidator,
            validationLevel: op.validation?.validationLevel,
            validationAction: op.validation?.validationAction,
          }, op.database);
        } else {
          await this.adapter.updateCollectionValidation(op.collection, {
            ...(safeParseJsonObject(op.validation?.validationJson) ?? {}),
            clearValidator: op.validation?.clearValidator,
            validationLevel: op.validation?.validationLevel,
            validationAction: op.validation?.validationAction,
          });
        }
        break;
    }
  }

  private getOperationDescription(op: MongoOperation): string {
    switch (op.type) {
      case 'insert':
        return `db.${op.collection}.insertOne({...})`;
      case 'update': {
        const filterStr = JSON.stringify(op.filter);
        return `db.${op.collection}.updateOne(${filterStr}, {...})`;
      }
      case 'delete': {
        const filterStr = JSON.stringify(op.filter);
        return `db.${op.collection}.deleteOne(${filterStr})`;
      }
      case 'createIndex':
        return `db.${op.collection}.createIndex(${JSON.stringify(op.indexKeys)}, {...})`;
      case 'dropIndex':
        return `db.${op.collection}.dropIndex(${JSON.stringify(op.indexName)})`;
      case 'updateValidation':
        return `db.runCommand({ collMod: ${JSON.stringify(op.collection)}, ... })`;
    }
  }

  private generatePreviewContent(operations: MongoOperation[]): string {
    if (operations.length === 0) {
      return '// No MongoDB operations to execute';
    }

    return operations.map((op) => {
      switch (op.type) {
        case 'insert':
          return `db.${op.collection}.insertOne(${JSON.stringify(op.document, null, 2)});`;
        case 'update':
          return `db.${op.collection}.updateOne(\n  ${JSON.stringify(op.filter)},\n  ${JSON.stringify(op.update, null, 2)}\n);`;
        case 'delete':
          return `db.${op.collection}.deleteOne(${JSON.stringify(op.filter)});`;
        case 'createIndex':
          return `db.${op.collection}.createIndex(\n  ${JSON.stringify(op.indexKeys, null, 2)},\n  ${JSON.stringify(op.indexOptions ?? {}, null, 2)}\n);`;
        case 'dropIndex':
          return `db.${op.collection}.dropIndex(${JSON.stringify(op.indexName)});`;
        case 'updateValidation':
          return `db.runCommand(${JSON.stringify({
            collMod: op.collection,
            validator: safeParseJsonObject(op.validation?.validationJson)
              ?? (op.validation?.clearValidator ? {} : undefined),
            validationLevel: op.validation?.validationLevel,
            validationAction: op.validation?.validationAction,
          }, null, 2)});`;
      }
    }).join('\n\n');
  }

  private getBeforeValue(command: CrudCommand): unknown {
    if (command.type === 'data.update') {
      const payload = command.payload as { oldValue?: unknown };
      return payload.oldValue;
    }

    if (command.type === 'data.delete') {
      const payload = command.payload as { primaryKeys?: Record<string, unknown> };
      return payload.primaryKeys;
    }

    if (command.type === 'document.index.drop') {
      const payload = command.payload as { indexName?: string };
      return payload.indexName;
    }

    return undefined;
  }

  private getAfterValue(command: CrudCommand): unknown {
    if (command.type === 'data.insert') {
      const payload = command.payload as { values?: Record<string, unknown> };
      return payload.values;
    }

    if (command.type === 'data.update') {
      const payload = command.payload as { newValue?: unknown };
      return payload.newValue;
    }

    if (command.type === 'document.index.create') {
      const payload = command.payload as { definition?: unknown };
      return payload.definition;
    }

    if (command.type === 'document.validation.update') {
      const payload = command.payload as {
        validationJson?: string;
        validationLevel?: string;
        validationAction?: string;
      };
      return payload;
    }

    return undefined;
  }
}
