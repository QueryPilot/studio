import type { DbType } from '@/types/connection';
import { getParadigm } from '@/types/connection';
import { getSqlAdapter } from '@/adapters';
import type { DocumentQueryable, RichKeyValueOperable } from '@/adapters/capabilities';
import { MongoDBAdapter } from '@/adapters/mongodb/MongoDBAdapter';
import { RedisAdapter } from '@/adapters/redis/RedisAdapter';
import type { OperationExecutor } from './types';
import { SqlOperationExecutor } from './SqlOperationExecutor';
import { DocumentOperationExecutor } from './DocumentOperationExecutor';
import { KeyValueOperationExecutor } from './KeyValueOperationExecutor';

const executorCache = new Map<string, OperationExecutor>();
const documentAdapterCache = new Map<string, DocumentQueryable>();
const keyValueAdapterCache = new Map<string, RichKeyValueOperable>();

async function getDocumentAdapter(connectionId: string): Promise<DocumentQueryable> {
  const cached = documentAdapterCache.get(connectionId);
  if (cached) return cached;
  
  const adapter = new MongoDBAdapter(connectionId);
  documentAdapterCache.set(connectionId, adapter);
  return adapter;
}

async function getKeyValueAdapter(connectionId: string): Promise<RichKeyValueOperable> {
  const cached = keyValueAdapterCache.get(connectionId);
  if (cached) return cached;
  
  const adapter = new RedisAdapter(connectionId);
  keyValueAdapterCache.set(connectionId, adapter);
  return adapter;
}

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
      const adapter = await getDocumentAdapter(connectionId);
      executor = new DocumentOperationExecutor(adapter, connectionId);
      break;
    }

    case 'keyvalue': {
      const adapter = await getKeyValueAdapter(connectionId);
      executor = new KeyValueOperationExecutor(adapter, connectionId);
      break;
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
