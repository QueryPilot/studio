import { logger } from "@/lib/logger";
import {
  invoke,
  SERIALIZE_TO_IPC_FN,
  transformCallback,
} from "@tauri-apps/api/core";
import type { DocumentStreamMessage, KeyValueStreamMessage } from "./backend";
import { isTauri } from "../utils/tauri";
import { Decoder } from "msgpackr";

export interface MongoFindParams {
  connId: string;
  collection: string;
  filter?: Record<string, unknown>;
  skip?: number;
  limit?: number;
  sort?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  batchSize?: number;
}

export interface RedisScanParams {
  connId: string;
  pattern: string;
  count?: number;
}

export interface DocumentBatch {
  documents: Record<string, unknown>[];
  offset: number;
}

export interface KeyBatch {
  keys: KeyInfo[];
  offset: number;
}

export interface KeyInfo {
  key: string;
  key_type: string;
  ttl: number;
  size_bytes?: number;
}

export interface DocumentStreamResult {
  totalDocuments: number;
  executionTimeMs: number;
}

export interface KeyValueStreamResult {
  totalKeys: number;
  executionTimeMs: number;
}

type ChannelLike = {
  [SERIALIZE_TO_IPC_FN]: () => string;
  toJSON: () => string;
};

function createIpcChannel(handler: (message: unknown) => void): ChannelLike {
  let nextMessageId = 0;
  const pending = new Map<number, unknown>();
  const callbackId = transformCallback(
    ({ message, id }: { message: unknown; id?: number }) => {
      if (typeof id !== "number") {
        handler(message);
        return;
      }

      if (id === nextMessageId) {
        nextMessageId++;
        handler(message);

        while (pending.has(nextMessageId)) {
          const next = pending.get(nextMessageId);
          if (next === undefined) break;
          pending.delete(nextMessageId);
          nextMessageId++;
          handler(next);
        }
      } else if (id > nextMessageId) {
        pending.set(id, message);
      } else {
        handler(message);
      }
    },
  );

  const serializedId = `__CHANNEL__:${String(callbackId)}`;
  return {
    [SERIALIZE_TO_IPC_FN]: () => serializedId,
    toJSON: () => serializedId,
  };
}

const decoder = new Decoder({
  useRecords: false,
  mapsAsObjects: true,
  int64AsNumber: false,
});

export class DocumentStreamClient {
  async streamMongoFind(
    params: MongoFindParams,
    callbacks: {
      onStarted?: (collection: string, estimatedCount?: number) => void;
      onBatch?: (batch: DocumentBatch, totalSoFar: number) => void;
      onSuccess?: (result: DocumentStreamResult) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<DocumentStreamResult> {
    if (!isTauri()) {
      const error = new Error(
        "Document streaming requires Tauri context",
      );
      callbacks.onError?.(error);
      return Promise.reject(error);
    }

    const {
      connId,
      collection,
      filter = {},
      skip,
      limit,
      sort,
      projection,
      batchSize,
    } = params;

    return new Promise((resolve, reject) => {
      let totalDocuments = 0;
      let settled = false;

      const settleResolve = (result: DocumentStreamResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const dataChannel = createIpcChannel((message: unknown) => {
        if (!(message instanceof ArrayBuffer)) {
          logger.warn("doc-stream", "Expected ArrayBuffer", typeof message);
          return;
        }

        try {
          const decoded = decoder.decode(new Uint8Array(message)) as Record<string, unknown>[];
          if (Array.isArray(decoded) && decoded.length > 0) {
            const batch: DocumentBatch = {
              documents: decoded,
              offset: totalDocuments,
            };
            totalDocuments += decoded.length;
            callbacks.onBatch?.(batch, totalDocuments);
          }
        } catch (err) {
          logger.error("doc-stream", "Failed to decode batch", err);
        }
      });

      const metadataChannel = createIpcChannel((message) => {
        const typedMessage = message as DocumentStreamMessage;

        switch (typedMessage.type) {
          case "started":
            callbacks.onStarted?.(
              typedMessage.collection,
              typedMessage.estimated_count,
            );
            break;

          case "success": {
            const result: DocumentStreamResult = {
              totalDocuments: typedMessage.total_documents,
              executionTimeMs: typedMessage.execution_time_ms,
            };
            callbacks.onSuccess?.(result);
            settleResolve(result);
            break;
          }

          case "error":
            settleReject(
              new Error(`[${typedMessage.code}] ${typedMessage.message}`),
            );
            break;
        }
      });

      invoke("mongo_find_documents_stream", {
        connId,
        collection,
        filter,
        skip,
        limit,
        sort,
        projection,
        batchSize,
        metadataChannel,
        dataChannel,
      }).catch((err: unknown) => {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async streamRedisScan(
    params: RedisScanParams,
    callbacks: {
      onStarted?: (pattern: string, estimatedKeys?: number) => void;
      onProgress?: (cursor: number, keysSoFar: number) => void;
      onBatch?: (batch: KeyBatch, totalSoFar: number) => void;
      onSuccess?: (result: KeyValueStreamResult) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<KeyValueStreamResult> {
    if (!isTauri()) {
      const error = new Error("Redis streaming requires Tauri context");
      callbacks.onError?.(error);
      return Promise.reject(error);
    }

    const { connId, pattern, count } = params;

    return new Promise((resolve, reject) => {
      let totalKeys = 0;
      let settled = false;

      const settleResolve = (result: KeyValueStreamResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const dataChannel = createIpcChannel((message: unknown) => {
        if (!(message instanceof ArrayBuffer)) {
          logger.warn("kv-stream", "Expected ArrayBuffer", typeof message);
          return;
        }

        try {
          const decoded = decoder.decode(new Uint8Array(message)) as KeyInfo[];
          if (Array.isArray(decoded) && decoded.length > 0) {
            const batch: KeyBatch = {
              keys: decoded,
              offset: totalKeys,
            };
            totalKeys += decoded.length;
            callbacks.onBatch?.(batch, totalKeys);
          }
        } catch (err) {
          logger.error("kv-stream", "Failed to decode batch", err);
        }
      });

      const metadataChannel = createIpcChannel((message) => {
        const typedMessage = message as KeyValueStreamMessage;

        switch (typedMessage.type) {
          case "started":
            callbacks.onStarted?.(
              typedMessage.pattern,
              typedMessage.estimated_keys,
            );
            break;

          case "progress":
            callbacks.onProgress?.(
              typedMessage.cursor,
              typedMessage.keys_so_far,
            );
            break;

          case "success": {
            const result: KeyValueStreamResult = {
              totalKeys: typedMessage.total_keys,
              executionTimeMs: typedMessage.execution_time_ms,
            };
            callbacks.onSuccess?.(result);
            settleResolve(result);
            break;
          }

          case "error":
            settleReject(
              new Error(`[${typedMessage.code}] ${typedMessage.message}`),
            );
            break;
        }
      });

      invoke("redis_scan_stream", {
        connId,
        pattern,
        count,
        metadataChannel,
        dataChannel,
      }).catch((err: unknown) => {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}

export const documentStreamClient = new DocumentStreamClient();
