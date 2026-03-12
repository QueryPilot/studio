import type { CrudCommand } from '@/types/crud';
import type { RichKeyValueOperable } from '@/adapters/capabilities';
import type { RedisValue, ZSetMember } from '@/adapters/types/redis';
import { logger } from '@/lib/logger';
import type {
  ExecuteResult,
  ExecuteError,
  OperationPreview,
  PreviewOp,
  ValidationResult,
  KeyValueOperationExecutor as KeyValueOperationExecutorInterface,
} from './types';

type RedisOperation = {
  type: 'set' | 'delete' | 'hset' | 'hdel' | 'lpush' | 'rpush' | 'lset' | 'sadd' | 'srem' | 'zadd' | 'expire' | 'persist';
  key: string;
  value?: RedisValue;
  field?: string;
  fields?: Record<string, string>;
  members?: string[];
  index?: number;
  zsetMembers?: ZSetMember[];
  seconds?: number;
};

export class KeyValueOperationExecutor implements KeyValueOperationExecutorInterface {
  readonly paradigm = 'keyvalue' as const;

  constructor(
    private adapter: RichKeyValueOperable,
    private connectionId: string,
  ) {}

  async execute(commands: CrudCommand[]): Promise<ExecuteResult> {
    logger.info('executor.keyvalue', `Executing ${commands.length} commands for ${this.connectionId}`);

    const errors: ExecuteError[] = [];
    let affectedCount = 0;

    const zipped = this.zipOperationsWithCommands(commands);

    if (zipped.length === 0) {
      logger.info('executor.keyvalue', 'No operations to execute');
      return { success: true, affectedCount: 0, errors: [] };
    }

    for (const { op, cmd } of zipped) {
      try {
        await this.executeOperation(op);
        affectedCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('executor.keyvalue', `Operation failed: ${message}`, op);

        errors.push({
          commandId: cmd.id,
          message,
        });
      }
    }

    const success = errors.length === 0;
    logger.info('executor.keyvalue', `Execution complete: ${affectedCount} succeeded, ${errors.length} failed`);

    return { success, affectedCount, errors };
  }

  preview(commands: CrudCommand[]): OperationPreview {
    const zipped = this.zipOperationsWithCommands(commands);

    const previewOps: PreviewOp[] = zipped.map(({ op, cmd }) => ({
      action: op.type,
      target: op.key,
      description: this.getOperationDescription(op),
      before: this.getBeforeValue(cmd),
      after: this.getAfterValue(cmd),
    }));

    const operations = zipped.map(({ op }) => op);
    const content = this.generatePreviewContent(operations);

    return {
      type: 'redis-cmds',
      content,
      operations: previewOps,
    };
  }

  validate(command: CrudCommand): ValidationResult {
    const errors: string[] = [];

    if (!command.target.table) {
      errors.push('Key name is required');
    }

    const supportedTypes = ['data.insert', 'data.update', 'data.delete'];
    if (!supportedTypes.includes(command.type)) {
      errors.push(`Unsupported operation type: ${command.type}`);
    }

    return { valid: errors.length === 0, errors };
  }

  private zipOperationsWithCommands(
    commands: CrudCommand[]
  ): Array<{ op: RedisOperation; cmd: CrudCommand }> {
    const result: Array<{ op: RedisOperation; cmd: CrudCommand }> = [];
    for (const cmd of commands) {
      const op = this.commandToOperation(cmd);
      if (op !== null) {
        result.push({ op, cmd });
      }
    }
    return result;
  }

  private commandToOperation(command: CrudCommand): RedisOperation | null {
    const payload = command.payload as {
      values?: Record<string, unknown>;
      primaryKeys?: Record<string, unknown>;
      column?: string;
      newValue?: unknown;
      redisType?: string;
    };

    const redisType = payload.redisType ?? 'string';
    const values = payload.values ?? {};

    // Prefer primaryKeys.key, then payload.values.key (browser-mode insert),
    // then target.table (key view mode where table is the key name).
    const pkKey = this.toNonEmptyString(payload.primaryKeys?.key);
    const valueKey = this.toNonEmptyString(values.key);
    const tableName = command.target.table ?? '';
    const isBrowserPseudoTable = /^db\d+_keys$/.test(tableName);
    const key = pkKey ?? valueKey ?? (isBrowserPseudoTable ? null : tableName);
    if (!key) return null;

    switch (command.type) {
      case 'data.insert': {
        return this.createInsertOperation(key, values, redisType);
      }

      case 'data.update': {
        return this.createUpdateOperation(key, payload, redisType);
      }

      case 'data.delete': {
        return this.createDeleteOperation(key, payload, redisType);
      }

      default:
        return null;
    }
  }

  private createInsertOperation(
    key: string,
    values: Record<string, unknown>,
    redisType: string
  ): RedisOperation {
    switch (redisType) {
      case 'hash': {
        const field = this.toNonEmptyString(values.field);
        if (field) {
          return {
            type: 'hset',
            key,
            fields: { [field]: String(values.value ?? '') },
          };
        }
        return {
          type: 'hset',
          key,
          fields: this.toStringRecord(values),
        };
      }

      case 'list':
        return {
          type: 'rpush',
          key,
          members: Object.values(values).map(String),
        };

      case 'set':
        return {
          type: 'sadd',
          key,
          members: Object.values(values).map(String),
        };

      case 'zset': {
        const member = values.member !== undefined ? String(values.member) : '';
        const scoreValue = values.score ?? 0;
        const score = typeof scoreValue === 'number' ? scoreValue : Number(scoreValue);
        const zsetMembers: ZSetMember[] = member
          ? [{ member, score: Number.isFinite(score) ? score : 0 }]
          : [];
        return {
          type: 'zadd',
          key,
          zsetMembers,
        };
      }

      default:
        return {
          type: 'set',
          key,
          value: this.toRedisValue(values.value ?? JSON.stringify(values)),
        };
    }
  }

  private toNonEmptyString(value: unknown): string | null {
    if (value == null) return null;
    const str = String(value).trim();
    return str.length > 0 ? str : null;
  }

  private createUpdateOperation(
    key: string,
    payload: {
      column?: string;
      newValue?: unknown;
      primaryKeys?: Record<string, unknown>;
    },
    redisType: string
  ): RedisOperation | null {
    // TTL update — EXPIRE or PERSIST
    if (payload.column === 'ttl') {
      const rawValue = payload.newValue;
      const seconds = typeof rawValue === 'number' ? rawValue : parseInt(String(rawValue), 10);
      if (Number.isFinite(seconds) && seconds > 0) {
        return { type: 'expire', key, seconds };
      }
      return { type: 'persist', key };
    }

    switch (redisType) {
      case 'hash':
        if (payload.column) {
          return {
            type: 'hset',
            key,
            field: payload.column,
            fields: { [payload.column]: String(payload.newValue) },
          };
        }
        return { type: 'hset', key, fields: {} };

      case 'list': {
        const rawIndex = payload.primaryKeys?.index;
        const index =
          typeof rawIndex === 'number' ? rawIndex : Number.parseInt(String(rawIndex), 10);
        if (!Number.isInteger(index)) {
          logger.warn(
            'executor.keyvalue',
            'Skipping list update: invalid or missing list index',
            { key, rawIndex },
          );
          return null;
        }
        return {
          type: 'lset',
          key,
          index,
          members: [String(payload.newValue ?? '')],
        };
      }

      case 'zset': {
        const member = payload.primaryKeys?.member;
        if (member === undefined || member === null) {
          return { type: 'zadd', key, zsetMembers: [] };
        }
        const scoreValue = payload.newValue ?? 0;
        const score = typeof scoreValue === 'number' ? scoreValue : Number(scoreValue);
        return {
          type: 'zadd',
          key,
          zsetMembers: [{ member: String(member), score: Number.isFinite(score) ? score : 0 }],
        };
      }

      default:
        return {
          type: 'set',
          key,
          value: this.toRedisValue(payload.newValue),
        };
    }
  }

  private createDeleteOperation(
    key: string,
    payload: {
      primaryKeys?: Record<string, unknown>;
    },
    redisType: string
  ): RedisOperation {
    switch (redisType) {
      case 'hash': {
        const field = payload.primaryKeys?.field;
        return {
          type: 'hdel',
          key,
          members: field !== undefined && field !== null ? [String(field)] : [],
        };
      }
      case 'set': {
        const member = payload.primaryKeys?.member;
        return {
          type: 'srem',
          key,
          members: member !== undefined && member !== null ? [String(member)] : [],
        };
      }
      default:
        return { type: 'delete', key };
    }
  }

  private async executeOperation(op: RedisOperation): Promise<void> {
    switch (op.type) {
      case 'set':
        await this.adapter.setKey(op.key, op.value ?? { type: 'nil' });
        break;

      case 'delete':
        await this.adapter.deleteKeys([op.key]);
        break;

      case 'hset':
        await this.adapter.hashSet(op.key, op.fields ?? {});
        break;

      case 'hdel':
        await this.adapter.hashDelete(op.key, op.members ?? []);
        break;

      case 'lpush':
        await this.adapter.listPush(op.key, op.members ?? [], 'left');
        break;

      case 'rpush':
        await this.adapter.listPush(op.key, op.members ?? [], 'right');
        break;

      case 'lset':
        await this.adapter.executeRaw('LSET', [
          op.key,
          String(op.index ?? 0),
          op.members?.[0] ?? '',
        ]);
        break;

      case 'sadd':
        await this.adapter.setAdd(op.key, op.members ?? []);
        break;

      case 'srem':
        await this.adapter.setRemove(op.key, op.members ?? []);
        break;

      case 'zadd':
        await this.adapter.zsetAdd(op.key, op.zsetMembers ?? []);
        break;

      case 'expire':
        await this.adapter.setKeyTTL(op.key, op.seconds ?? 0);
        break;

      case 'persist':
        await this.adapter.executeRaw('PERSIST', [op.key]);
        break;
    }
  }

  private getOperationDescription(op: RedisOperation): string {
    switch (op.type) {
      case 'set':
        return `SET ${op.key} <value>`;
      case 'delete':
        return `DEL ${op.key}`;
      case 'hset':
        return `HSET ${op.key} ${Object.keys(op.fields ?? {}).join(' ')}`;
      case 'hdel':
        return `HDEL ${op.key} ${(op.members ?? []).join(' ')}`;
      case 'lpush':
        return `LPUSH ${op.key} <values>`;
      case 'rpush':
        return `RPUSH ${op.key} <values>`;
      case 'lset':
        return `LSET ${op.key} ${op.index} <value>`;
      case 'sadd':
        return `SADD ${op.key} <members>`;
      case 'srem':
        return `SREM ${op.key} <members>`;
      case 'zadd':
        return `ZADD ${op.key} <score> <member>`;
      case 'expire':
        return `EXPIRE ${op.key} ${op.seconds}`;
      case 'persist':
        return `PERSIST ${op.key}`;
    }
  }

  private generatePreviewContent(operations: RedisOperation[]): string {
    if (operations.length === 0) {
      return '# No Redis commands to execute';
    }

    return operations.map((op) => {
      switch (op.type) {
        case 'set':
          return `SET "${op.key}" "${this.redisValueToString(op.value)}"`;
        case 'delete':
          return `DEL "${op.key}"`;
        case 'hset': {
          const fields = Object.entries(op.fields ?? {})
            .map(([k, v]) => `"${k}" "${v}"`)
            .join(' ');
          return `HSET "${op.key}" ${fields}`;
        }
        case 'hdel':
          return `HDEL "${op.key}" ${(op.members ?? []).map(m => `"${m}"`).join(' ')}`;
        case 'lpush':
          return `LPUSH "${op.key}" ${(op.members ?? []).map(m => `"${m}"`).join(' ')}`;
        case 'rpush':
          return `RPUSH "${op.key}" ${(op.members ?? []).map(m => `"${m}"`).join(' ')}`;
        case 'lset':
          return `LSET "${op.key}" ${op.index ?? 0} "${op.members?.[0] ?? ''}"`;
        case 'sadd':
          return `SADD "${op.key}" ${(op.members ?? []).map(m => `"${m}"`).join(' ')}`;
        case 'srem':
          return `SREM "${op.key}" ${(op.members ?? []).map(m => `"${m}"`).join(' ')}`;
        case 'zadd': {
          const members = (op.zsetMembers ?? [])
            .map(({ score, member }) => `${score} "${member}"`)
            .join(' ');
          return `ZADD "${op.key}" ${members}`;
        }
        case 'expire':
          return `EXPIRE "${op.key}" ${op.seconds}`;
        case 'persist':
          return `PERSIST "${op.key}"`;
      }
    }).join('\n');
  }

  private toRedisValue(value: unknown): RedisValue {
    if (value === null || value === undefined) {
      return { type: 'nil' };
    }
    if (typeof value === 'string') {
      return { type: 'string', value };
    }
    if (typeof value === 'number') {
      return Number.isInteger(value)
        ? { type: 'integer', value }
        : { type: 'float', value };
    }
    if (typeof value === 'boolean') {
      return { type: 'boolean', value };
    }
    return { type: 'string', value: JSON.stringify(value) };
  }

  private redisValueToString(value?: RedisValue): string {
    if (!value) return '';
    switch (value.type) {
      case 'nil': return 'nil';
      case 'string': return value.value;
      case 'integer': return String(value.value);
      case 'float': return String(value.value);
      case 'boolean': return String(value.value);
      default: return JSON.stringify(value);
    }
  }

  private toStringRecord(values: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      result[k] = String(v);
    }
    return result;
  }

  private getBeforeValue(command: CrudCommand): unknown {
    if (command.type === 'data.update') {
      const payload = command.payload as { oldValue?: unknown };
      return payload.oldValue;
    }
    if (command.type === 'data.delete') {
      return command.target.table;
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
