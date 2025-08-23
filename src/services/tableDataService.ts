import { invoke } from '@tauri-apps/api/core';
import { listen, EventCallback, UnlistenFn } from '@tauri-apps/api/event';
import type { 
  TableReadRequest, 
  TableDataResponse, 
  TableDataMeta, 
  TableDataRows,
  TableDataStream,
  SortSpec,
  FilterSpec
} from '@/types/tableData';

export class TableDataService {
  private activeStreams = new Map<string, TableDataStream>();
  private listeners = new Map<string, UnlistenFn>();

  /**
   * Fetch table data with streaming support
   */
  async fetchTableData(
    request: Omit<TableReadRequest, 'connectionId'> & { connectionId: string },
    onData?: (stream: TableDataStream) => void,
    onError?: (error: Error) => void
  ): Promise<TableDataStream> {
    try {
      console.log('[TableDataService] Fetching table data with request:', request);
      
      // Invoke the backend command
      const streamId = await invoke<string>('db_table_data', {
        connectionId: request.connectionId,
        table: request.table,
        schema: request.schema,
        select: request.select,
        sorts: request.sorts,
        filters: request.filters,
        search: request.search,
        cursor: request.cursor,
        offset: request.offset,
        limit: request.limit
      });

      // Initialize stream state
      const stream: TableDataStream = {
        streamId,
        rows: [],
        isComplete: false
      };

      this.activeStreams.set(streamId, stream);

      // Listen for stream events
      const eventName = `table-data-${streamId}`;
      const unlisten = await listen<TableDataResponse>(eventName, (event) => {
        const response = event.payload;
        const currentStream = this.activeStreams.get(streamId);
        
        if (!currentStream) return;

        switch (response.type) {
          case 'meta':
            currentStream.meta = response as TableDataMeta;
            break;
          
          case 'rows':
            const rowsResponse = response as TableDataRows;
            currentStream.rows.push(...rowsResponse.rows);
            currentStream.nextCursor = rowsResponse.nextCursor;
            break;
          
          case 'done':
            currentStream.isComplete = true;
            this.cleanup(streamId);
            break;
          
          case 'error':
            currentStream.error = response;
            currentStream.isComplete = true;
            this.cleanup(streamId);
            if (onError) {
              onError(new Error(response.message));
            }
            break;
        }

        // Notify callback
        if (onData) {
          onData(currentStream);
        }
      });

      this.listeners.set(streamId, unlisten);
      return stream;

    } catch (error) {
      if (onError) {
        onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * Fetch next page using cursor
   */
  async fetchNextPage(
    connectionId: string,
    table: string,
    cursor: string,
    options?: {
      schema?: string;
      select?: string[];
      sorts?: SortSpec[];
      filters?: FilterSpec[];
      search?: string;
    }
  ): Promise<TableDataStream> {
    return this.fetchTableData({
      connectionId,
      table,
      cursor,
      ...options
    });
  }

  /**
   * Simple fetch without streaming (waits for all data)
   */
  async fetchTableDataSimple(
    request: Omit<TableReadRequest, 'connectionId'> & { connectionId: string }
  ): Promise<{ meta: TableDataMeta; rows: Record<string, any>[] }> {
    return new Promise((resolve, reject) => {
      let meta: TableDataMeta | undefined;
      const allRows: Record<string, any>[] = [];

      this.fetchTableData(
        request,
        (stream) => {
          if (stream.meta && !meta) {
            meta = stream.meta;
          }
          
          if (stream.isComplete) {
            if (stream.error) {
              reject(new Error(stream.error.message));
            } else if (meta) {
              resolve({ meta, rows: stream.rows });
            } else {
              reject(new Error('No metadata received'));
            }
          }
        },
        reject
      );
    });
  }

  /**
   * Cancel an active stream
   */
  cancelStream(streamId: string) {
    this.cleanup(streamId);
  }

  /**
   * Clean up stream resources
   */
  private cleanup(streamId: string) {
    const unlisten = this.listeners.get(streamId);
    if (unlisten) {
      unlisten();
      this.listeners.delete(streamId);
    }
    this.activeStreams.delete(streamId);
  }

  /**
   * Clean up all active streams
   */
  dispose() {
    for (const streamId of this.activeStreams.keys()) {
      this.cleanup(streamId);
    }
  }
}

// Singleton instance
export const tableDataService = new TableDataService();