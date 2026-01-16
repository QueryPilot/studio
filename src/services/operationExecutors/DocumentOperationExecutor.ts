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

type MongoOperation = {
  type: 'insert' | 'update' | 'delete';
  collection: string;
  document?: object;
  filter?: object;
  update?: object;
};

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

    const supportedTypes = ['data.insert', 'data.update', 'data.delete'];
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

    switch (command.type) {
      case 'data.insert': {
        const payload = command.payload as { values?: Record<string, unknown> };
        return {
          type: 'insert',
          collection,
          document: payload.values ?? {},
        };
      }

      case 'data.update': {
        const payload = command.payload as {
          primaryKeys?: Record<string, unknown>;
          column?: string;
          newValue?: unknown;
        };

        const filter = payload.primaryKeys ?? {};
        const update = payload.column
          ? { $set: { [payload.column]: payload.newValue } }
          : {};

        return {
          type: 'update',
          collection,
          filter,
          update,
        };
      }

      case 'data.delete': {
        const payload = command.payload as { primaryKeys?: Record<string, unknown> };
        return {
          type: 'delete',
          collection,
          filter: payload.primaryKeys ?? {},
        };
      }

      default:
        return null;
    }
  }

  private async executeOperation(op: MongoOperation): Promise<void> {
    switch (op.type) {
      case 'insert':
        await this.adapter.insertDocument(op.collection, op.document ?? {});
        break;

      case 'update':
        await this.adapter.updateDocument(op.collection, op.filter ?? {}, op.update ?? {});
        break;

      case 'delete':
        await this.adapter.deleteDocument(op.collection, op.filter ?? {});
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

    return undefined;
  }
}
