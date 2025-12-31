/**
 * Metrics and observability utilities for AI operations
 * Tracks timing, success rates, tool usage, and error patterns
 */

export interface OperationMetric {
  operation: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AggregatedMetrics {
  totalOperations: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  errorBreakdown: Record<string, number>;
  operationBreakdown: Record<string, { count: number; avgMs: number; successRate: number }>;
}

// Rolling window for metrics (last N operations)
const MAX_METRICS_HISTORY = 1000;

class MetricsCollector {
  private metrics: OperationMetric[] = [];
  private operationCounts: Map<string, { total: number; success: number; totalMs: number }> =
    new Map();

  /**
   * Start timing an operation
   */
  startOperation(operation: string, metadata?: Record<string, unknown>): OperationMetric {
    const metric: OperationMetric = {
      operation,
      startTime: Date.now(),
      success: false,
      metadata,
    };
    return metric;
  }

  /**
   * Complete an operation with success
   */
  endOperation(metric: OperationMetric, success: boolean, error?: string): void {
    metric.endTime = Date.now();
    metric.durationMs = metric.endTime - metric.startTime;
    metric.success = success;
    metric.error = error;

    // Add to history
    this.metrics.push(metric);

    // Trim history if needed
    if (this.metrics.length > MAX_METRICS_HISTORY) {
      this.metrics = this.metrics.slice(-MAX_METRICS_HISTORY);
    }

    // Update aggregates
    const counts = this.operationCounts.get(metric.operation) || {
      total: 0,
      success: 0,
      totalMs: 0,
    };
    counts.total++;
    if (success) counts.success++;
    counts.totalMs += metric.durationMs;
    this.operationCounts.set(metric.operation, counts);
  }

  /**
   * Measure an async operation
   */
  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const metric = this.startOperation(operation, metadata);
    try {
      const result = await fn();
      this.endOperation(metric, true);
      return result;
    } catch (error) {
      this.endOperation(metric, false, error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  }

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics(
    timeWindowMs: number = 5 * 60 * 1000 // Last 5 minutes
  ): AggregatedMetrics {
    const cutoff = Date.now() - timeWindowMs;
    const recentMetrics = this.metrics.filter((m) => m.startTime >= cutoff);

    if (recentMetrics.length === 0) {
      return {
        totalOperations: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        avgDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
        errorBreakdown: {},
        operationBreakdown: {},
      };
    }

    const successCount = recentMetrics.filter((m) => m.success).length;
    const durations = recentMetrics.map((m) => m.durationMs || 0).sort((a, b) => a - b);

    // Error breakdown
    const errorBreakdown: Record<string, number> = {};
    for (const m of recentMetrics.filter((m) => !m.success && m.error)) {
      const key = m.error!.slice(0, 50); // Truncate error message
      errorBreakdown[key] = (errorBreakdown[key] || 0) + 1;
    }

    // Operation breakdown
    const operationBreakdown: Record<
      string,
      { count: number; avgMs: number; successRate: number }
    > = {};
    const byOperation = new Map<string, OperationMetric[]>();
    for (const m of recentMetrics) {
      const list = byOperation.get(m.operation) || [];
      list.push(m);
      byOperation.set(m.operation, list);
    }
    for (const [op, metrics] of byOperation) {
      const successCount = metrics.filter((m) => m.success).length;
      const totalMs = metrics.reduce((sum, m) => sum + (m.durationMs || 0), 0);
      operationBreakdown[op] = {
        count: metrics.length,
        avgMs: Math.round(totalMs / metrics.length),
        successRate: Math.round((successCount / metrics.length) * 100),
      };
    }

    return {
      totalOperations: recentMetrics.length,
      successCount,
      failureCount: recentMetrics.length - successCount,
      successRate: Math.round((successCount / recentMetrics.length) * 100),
      avgDurationMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      p50DurationMs: durations[Math.floor(durations.length * 0.5)] || 0,
      p95DurationMs: durations[Math.floor(durations.length * 0.95)] || 0,
      p99DurationMs: durations[Math.floor(durations.length * 0.99)] || 0,
      errorBreakdown,
      operationBreakdown,
    };
  }

  /**
   * Get recent metrics for debugging
   */
  getRecentMetrics(limit: number = 20): OperationMetric[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.operationCounts.clear();
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

// Convenience decorators/wrappers
export function withMetrics<TArgs extends unknown[], TResult>(
  operation: string,
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    return metrics.measure(operation, () => fn(...args));
  };
}

// Tool-specific metrics helpers
export const ToolMetrics = {
  toolCall: (toolName: string) => metrics.startOperation(`tool:${toolName}`),
  tauriCall: (command: string) => metrics.startOperation(`tauri:${command}`),
  aiGeneration: (provider: string, model: string) =>
    metrics.startOperation(`ai:${provider}/${model}`),
  textToSql: (dialect: string) => metrics.startOperation(`text-to-sql:${dialect}`),
  chat: (provider: string) => metrics.startOperation(`chat:${provider}`),
};
