/**
 * TableDataService - Service for loading table data using db_table_data command
 * Provides type-safe streaming interface for table data operations
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  TableDataParams,
  TableDataCallbacks,
  TableDataStream,
  TableDataEvent,
  TableDataServiceError,
  StreamState,
} from './tableDataTypes';

export class TableDataService {
  private activeStreams = new Map<string, StreamState>();
  private readonly TIMEOUT_MS = 30000; // 30 second timeout

  /**
   * Start streaming table data with the provided parameters
   * Returns a stream control object that can be used to stop the stream
   */
  async startTableDataStream(
    params: TableDataParams,
    callbacks: TableDataCallbacks
  ): Promise<TableDataStream> {
    console.log('[TableDataService] Starting stream with params:', params);
    
    try {
      // Validate parameters
      this.validateParams(params);
      console.log('[TableDataService] Parameters validated');

      // Invoke db_table_data command to start the stream
      // Note: Tauri expects camelCase and converts to snake_case for Rust
      const invokeParams = {
        connectionId: params.connectionId,
        database: params.database,
        table: params.table,
        schema: params.schema,
        select: params.select,
        sorts: params.sorts,
        filters: params.filters,
        search: params.search,
        cursor: params.cursor,
        offset: params.offset,
        limit: params.limit,
      };
      
      console.log('[TableDataService] Invoking db_table_data with:', invokeParams);
      
      const streamId = await invoke<string>('db_table_data', invokeParams);
      
      console.log('[TableDataService] Received stream ID:', streamId);

      if (typeof streamId !== 'string' || streamId.length === 0) {
        throw new Error('Invalid stream ID returned from db_table_data');
      }

      // Set up event listener for the stream
      const eventName = `table-data-${streamId}`;
      console.log('[TableDataService] Setting up listener for event:', eventName);
      
      const unlisten = await listen<TableDataEvent>(eventName, (event) => {
        console.log('[TableDataService] Received event:', event.payload.type, event.payload);
        this.handleStreamEvent(streamId, event.payload, callbacks);
      });
      
      console.log('[TableDataService] Event listener set up successfully');

      // Create stream state
      const streamState: StreamState = {
        streamId,
        isActive: true,
        callbacks,
        unlisten,
        startTime: Date.now(),
      };

      // Store active stream
      this.activeStreams.set(streamId, streamState);

      // Set up timeout for the stream
      this.setupStreamTimeout(streamId);

      // Return stream control interface
      return {
        streamId,
        isActive: true,
        stop: () => this.stopStream(streamId),
      };
    } catch (error) {
      console.error('[TableDataService] Error starting stream:', error);
      
      const serviceError: TableDataServiceError = {
        type: 'stream',
        message: error instanceof Error ? error.message : 'Failed to start table data stream',
        originalError: error,
      };
      
      callbacks.onError({
        type: 'error',
        code: 'STREAM_START_FAILED',
        message: serviceError.message,
      });
      
      throw serviceError;
    }
  }

  /**
   * Stop an active stream and clean up resources
   */
  async stopStream(streamId: string): Promise<void> {
    const streamState = this.activeStreams.get(streamId);
    if (!streamState) {
      return; // Stream already stopped or doesn't exist
    }

    try {
      // Mark as inactive
      streamState.isActive = false;

      // Clean up event listener
      if (streamState.unlisten) {
        streamState.unlisten();
      }

      // Remove from active streams
      this.activeStreams.delete(streamId);

      // Note: We don't need to call a Tauri command to stop the stream
      // since the stream will complete naturally or can be cleaned up
      // by the Rust backend when the event listener is removed
    } catch (error) {
      console.error(`Error stopping stream ${streamId}:`, error);
    }
  }

  /**
   * Stop all active streams
   */
  async stopAllStreams(): Promise<void> {
    const streamIds = Array.from(this.activeStreams.keys());
    await Promise.all(streamIds.map((id) => this.stopStream(id)));
  }

  /**
   * Get list of active stream IDs
   */
  getActiveStreams(): string[] {
    return Array.from(this.activeStreams.keys()).filter((id) => {
      const stream = this.activeStreams.get(id);
      return stream?.isActive ?? false;
    });
  }

  /**
   * Handle stream events and route them to appropriate callbacks
   */
  private handleStreamEvent(
    streamId: string,
    event: TableDataEvent,
    callbacks: TableDataCallbacks
  ): void {
    const streamState = this.activeStreams.get(streamId);
    if (!streamState || !streamState.isActive) {
      return; // Stream is no longer active
    }

    try {
      switch (event.type) {
        case 'meta':
          callbacks.onMeta(event);
          break;

        case 'rows':
          callbacks.onRows(event);
          break;

        case 'done':
          callbacks.onDone();
          // Automatically clean up completed stream
          this.stopStream(streamId);
          break;

        case 'error':
          callbacks.onError(event);
          // Stop stream on error
          this.stopStream(streamId);
          break;

        default:
          // TypeScript should ensure this never happens with proper discriminated union
          console.warn(`Unknown event type:`, event);
          break;
      }
    } catch (error) {
      console.error(`Error handling stream event for ${streamId}:`, error);
      callbacks.onError({
        type: 'error',
        code: 'EVENT_HANDLER_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error in event handler',
      });
      this.stopStream(streamId);
    }
  }

  /**
   * Set up timeout for stream to prevent hanging streams
   */
  private setupStreamTimeout(streamId: string): void {
    setTimeout(() => {
      const streamState = this.activeStreams.get(streamId);
      if (streamState && streamState.isActive) {
        const timeoutError: TableDataServiceError = {
          type: 'timeout',
          message: `Stream ${streamId} timed out after ${this.TIMEOUT_MS}ms`,
          code: 'STREAM_TIMEOUT',
        };

        streamState.callbacks.onError({
          type: 'error',
          code: 'STREAM_TIMEOUT',
          message: timeoutError.message,
        });

        this.stopStream(streamId);
      }
    }, this.TIMEOUT_MS);
  }

  /**
   * Validate table data parameters
   */
  private validateParams(params: TableDataParams): void {
    if (!params.connectionId || typeof params.connectionId !== 'string') {
      throw new Error('Connection ID is required and must be a string');
    }

    if (!params.database || typeof params.database !== 'string') {
      throw new Error('Database name is required and must be a string');
    }

    if (!params.table || typeof params.table !== 'string') {
      throw new Error('Table name is required and must be a string');
    }

    if (params.limit !== undefined && (params.limit < 1 || params.limit > 1000)) {
      throw new Error('Limit must be between 1 and 1000');
    }

    if (params.offset !== undefined && params.offset < 0) {
      throw new Error('Offset must be non-negative');
    }

    // Validate sort specifications
    if (params.sorts) {
      for (const sort of params.sorts) {
        if (!sort.column || typeof sort.column !== 'string') {
          throw new Error('Sort column name is required and must be a string');
        }
        if (!['asc', 'desc'].includes(sort.direction)) {
          throw new Error('Sort direction must be "asc" or "desc"');
        }
      }
    }

    // Validate filter specifications
    if (params.filters) {
      for (const filter of params.filters) {
        if (!filter.column || typeof filter.column !== 'string') {
          throw new Error('Filter column name is required and must be a string');
        }
        
        // Additional validation based on filter type would be done here
        // The discriminated union ensures type safety at compile time
      }
    }

    // Validate column selection
    if (params.select) {
      if (!Array.isArray(params.select) || params.select.length === 0) {
        throw new Error('Select must be a non-empty array of column names');
      }
      for (const column of params.select) {
        if (!column || typeof column !== 'string') {
          throw new Error('Selected column names must be non-empty strings');
        }
      }
    }
  }
}

// Export singleton instance
export const tableDataService = new TableDataService();