/**
 * Circuit Breaker Tests
 *
 * Tests for preventing runaway tool calls in agentic loops.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  checkTurnLimit,
  recordToolCall,
  resetTurn,
  getCircuitState,
  CircuitState,
} from "./circuit-breaker";

describe("circuit-breaker", () => {
  const CONV_ID = "test-conv-123";

  beforeEach(() => {
    resetTurn(CONV_ID);
  });

  describe("checkTurnLimit", () => {
    it("should allow first tool call", () => {
      const result = checkTurnLimit(CONV_ID, "list_tables");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow multiple different tool calls", () => {
      recordToolCall(CONV_ID, "list_tables", true);
      recordToolCall(CONV_ID, "get_schema", true);
      recordToolCall(CONV_ID, "sample_data", true);

      const result = checkTurnLimit(CONV_ID, "explain_query");
      expect(result.allowed).toBe(true);
    });

    it("should block after 15 total tool calls", () => {
      for (let i = 0; i < 15; i++) {
        recordToolCall(CONV_ID, `tool_${i}`, true);
      }

      const result = checkTurnLimit(CONV_ID, "another_tool");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("15");
      expect(result.reason?.toLowerCase()).toContain("max");
    });

    it("should block after 3 consecutive errors", () => {
      recordToolCall(CONV_ID, "flaky_tool", false);
      recordToolCall(CONV_ID, "flaky_tool", false);
      recordToolCall(CONV_ID, "flaky_tool", false);

      const result = checkTurnLimit(CONV_ID, "flaky_tool");
      expect(result.allowed).toBe(false);
      expect(result.reason?.toLowerCase()).toContain("consecutive");
    });

    it("should block repeated same tool calls (5 times)", () => {
      for (let i = 0; i < 5; i++) {
        recordToolCall(CONV_ID, "list_tables", true);
      }

      const result = checkTurnLimit(CONV_ID, "list_tables");
      expect(result.allowed).toBe(false);
      expect(result.reason?.toLowerCase()).toContain("too many");
    });

    it("should reset error count on success", () => {
      recordToolCall(CONV_ID, "tool", false);
      recordToolCall(CONV_ID, "tool", false);
      recordToolCall(CONV_ID, "tool", true); // Success resets
      recordToolCall(CONV_ID, "tool", false);

      const result = checkTurnLimit(CONV_ID, "tool");
      expect(result.allowed).toBe(true); // Only 1 consecutive error
    });

    it("should track tool calls per tool name", () => {
      for (let i = 0; i < 4; i++) {
        recordToolCall(CONV_ID, "list_tables", true);
      }

      // list_tables at limit (4), new tool should still be allowed
      const result1 = checkTurnLimit(CONV_ID, "get_schema");
      expect(result1.allowed).toBe(true);

      // But list_tables would be blocked after one more
      recordToolCall(CONV_ID, "list_tables", true);
      const result2 = checkTurnLimit(CONV_ID, "list_tables");
      expect(result2.allowed).toBe(false);
    });
  });

  describe("resetTurn", () => {
    it("should reset all counters for a conversation", () => {
      for (let i = 0; i < 10; i++) {
        recordToolCall(CONV_ID, "tool", true);
      }

      resetTurn(CONV_ID);

      const result = checkTurnLimit(CONV_ID, "tool");
      expect(result.allowed).toBe(true);
    });

    it("should not affect other conversations", () => {
      const OTHER_CONV = "other-conv-456";

      for (let i = 0; i < 10; i++) {
        recordToolCall(CONV_ID, "tool", true);
      }
      for (let i = 0; i < 5; i++) {
        recordToolCall(OTHER_CONV, "tool", true);
      }

      resetTurn(CONV_ID);

      // First conversation is reset
      const result1 = checkTurnLimit(CONV_ID, "tool");
      expect(result1.allowed).toBe(true);

      // Other conversation is not affected
      const result2 = checkTurnLimit(OTHER_CONV, "tool");
      expect(result2.allowed).toBe(false); // Still at 5 calls
    });
  });

  describe("getCircuitState", () => {
    it("should return initial state for new conversation", () => {
      const state = getCircuitState(CONV_ID);
      expect(state.totalCalls).toBe(0);
      expect(state.consecutiveErrors).toBe(0);
      expect(state.toolCallCounts).toEqual({});
    });

    it("should track state correctly after calls", () => {
      recordToolCall(CONV_ID, "list_tables", true);
      recordToolCall(CONV_ID, "list_tables", true);
      recordToolCall(CONV_ID, "get_schema", false);

      const state = getCircuitState(CONV_ID);
      expect(state.totalCalls).toBe(3);
      expect(state.consecutiveErrors).toBe(1);
      expect(state.toolCallCounts["list_tables"]).toBe(2);
      expect(state.toolCallCounts["get_schema"]).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty conversation ID", () => {
      const result = checkTurnLimit("", "tool");
      expect(result.allowed).toBe(true);
    });

    it("should handle empty tool name", () => {
      const result = checkTurnLimit(CONV_ID, "");
      expect(result.allowed).toBe(true);
    });

    it("should handle concurrent conversations independently", () => {
      const convs = ["conv1", "conv2", "conv3"];

      convs.forEach((conv) => {
        for (let i = 0; i < 3; i++) {
          recordToolCall(conv, "tool", true);
        }
      });

      convs.forEach((conv) => {
        const state = getCircuitState(conv);
        expect(state.totalCalls).toBe(3);
      });
    });
  });
});
