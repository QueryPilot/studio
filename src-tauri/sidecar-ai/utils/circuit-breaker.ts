/**
 * Circuit Breaker for AI Tool Calls
 *
 * Prevents runaway tool calls in agentic loops by tracking:
 * - Total tool calls per conversation turn (max 15)
 * - Consecutive errors (max 3)
 * - Repeated same tool calls (max 5 per tool)
 *
 * Usage:
 *   const check = checkTurnLimit(conversationId, toolName);
 *   if (!check.allowed) {
 *     return { error: check.reason };
 *   }
 *   // Execute tool
 *   recordToolCall(conversationId, toolName, success);
 */

// Configuration constants
const MAX_TOOL_CALLS_PER_TURN = 15;
const MAX_CONSECUTIVE_ERRORS = 3;
const MAX_SAME_TOOL_CALLS = 5;

/**
 * Circuit state for a conversation
 */
export interface CircuitState {
  totalCalls: number;
  consecutiveErrors: number;
  toolCallCounts: Record<string, number>;
  lastToolName: string | null;
}

/**
 * Result of checking turn limits
 */
export interface TurnLimitResult {
  allowed: boolean;
  reason?: string;
}

// In-memory state store (per-conversation)
const conversationState = new Map<string, CircuitState>();

/**
 * Get or create circuit state for a conversation
 */
function getOrCreateState(conversationId: string): CircuitState {
  let state = conversationState.get(conversationId);
  if (!state) {
    state = {
      totalCalls: 0,
      consecutiveErrors: 0,
      toolCallCounts: {},
      lastToolName: null,
    };
    conversationState.set(conversationId, state);
  }
  return state;
}

/**
 * Check if a tool call should be allowed
 *
 * @param conversationId - The conversation/session ID
 * @param toolName - The name of the tool being called
 * @returns Object with allowed boolean and optional reason
 */
export function checkTurnLimit(
  conversationId: string,
  toolName: string
): TurnLimitResult {
  const state = getOrCreateState(conversationId);

  // Check total call limit
  if (state.totalCalls >= MAX_TOOL_CALLS_PER_TURN) {
    return {
      allowed: false,
      reason: `Tool call limit reached (${MAX_TOOL_CALLS_PER_TURN} max per turn). Please reset or start a new turn.`,
    };
  }

  // Check consecutive error limit
  if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    return {
      allowed: false,
      reason: `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Please check the tool configuration or try a different approach.`,
    };
  }

  // Check same tool call limit
  const toolCount = state.toolCallCounts[toolName] || 0;
  if (toolCount >= MAX_SAME_TOOL_CALLS) {
    return {
      allowed: false,
      reason: `Tool '${toolName}' called too many times (${MAX_SAME_TOOL_CALLS} max). Consider using the cached result or a different approach.`,
    };
  }

  return { allowed: true };
}

/**
 * Record a tool call execution
 *
 * @param conversationId - The conversation/session ID
 * @param toolName - The name of the tool that was called
 * @param success - Whether the tool call succeeded
 */
export function recordToolCall(
  conversationId: string,
  toolName: string,
  success: boolean
): void {
  const state = getOrCreateState(conversationId);

  // Increment total calls
  state.totalCalls++;

  // Increment per-tool count
  state.toolCallCounts[toolName] = (state.toolCallCounts[toolName] || 0) + 1;

  // Track consecutive errors
  if (success) {
    state.consecutiveErrors = 0;
  } else {
    state.consecutiveErrors++;
  }

  // Track last tool name
  state.lastToolName = toolName;
}

/**
 * Reset circuit state for a conversation (start of new turn)
 *
 * @param conversationId - The conversation/session ID
 */
export function resetTurn(conversationId: string): void {
  conversationState.delete(conversationId);
}

/**
 * Get the current circuit state for a conversation (for debugging/monitoring)
 *
 * @param conversationId - The conversation/session ID
 * @returns The current circuit state
 */
export function getCircuitState(conversationId: string): CircuitState {
  return (
    conversationState.get(conversationId) || {
      totalCalls: 0,
      consecutiveErrors: 0,
      toolCallCounts: {},
      lastToolName: null,
    }
  );
}

/**
 * Clear all circuit state (useful for testing)
 */
export function clearAllState(): void {
  conversationState.clear();
}

/**
 * Get circuit breaker configuration (for introspection)
 */
export function getCircuitConfig() {
  return {
    maxToolCallsPerTurn: MAX_TOOL_CALLS_PER_TURN,
    maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
    maxSameToolCalls: MAX_SAME_TOOL_CALLS,
  };
}
