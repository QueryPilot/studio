import type { DbType } from '@/types/connection';
import { getParadigm } from '@/types/connection';
import { getSqlAdapter } from '@/adapters';
import type { OperationExecutor } from './types';
import { SqlOperationExecutor } from './SqlOperationExecutor';

const executorCache = new Map<string, OperationExecutor>();

export async function getOperationExecutor(
  connectionId: string,
  dbType: DbType,
): Promise<OperationExecutor> {
  const cached = executorCache.get(connectionId);
  if (cached) {
    return cached;
  }

  const paradigm = getParadigm(dbType);
  let executor: OperationExecutor;

  switch (paradigm) {
    case 'sql': {
      const adapter = await getSqlAdapter(connectionId, dbType);
      executor = new SqlOperationExecutor(adapter, connectionId);
      break;
    }

    case 'document': {
      throw new Error('Document executor not yet implemented');
    }

    case 'keyvalue': {
      throw new Error('KeyValue executor not yet implemented');
    }

    default:
      throw new Error(`Unsupported paradigm: ${paradigm}`);
  }

  executorCache.set(connectionId, executor);
  return executor;
}

export function clearOperationExecutor(connectionId: string): void {
  executorCache.delete(connectionId);
}

export function clearAllOperationExecutors(): void {
  executorCache.clear();
}
