/**
 * ACP Service Tests
 *
 * Tests for Agent Client Protocol service that handles
 * agent discovery, session management, and streaming updates.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { AcpService } from "../acpService";
import type { AgentInfo, SessionUpdateEvent } from "@/types/acp";

/**
 * Helper to set up both IPC commands and events for ACP tests
 */
function setupAcpMocks(
  commandHandler: (cmd: string, args?: Record<string, unknown>) => unknown
): void {
  mockIPC((cmd, args) => {
    return commandHandler(cmd, args as Record<string, unknown>);
  }, { shouldMockEvents: true });
}

describe("AcpService", () => {
  beforeEach(() => {
    // Default empty mock - tests will set up their own handlers
    setupAcpMocks(() => null);
  });

  describe("listAgents", () => {
    it("should return an array of discovered agents", async () => {
      const mockAgents: AgentInfo[] = [
        {
          id: "claude-code-acp",
          name: "Claude Code",
          path: "/usr/local/bin/claude",
          version: "1.0.0",
          acpArgs: ["--acp"],
          installed: true,
          installUrl: null,
          packages: [],
          models: [{ id: "opus", name: "Opus 4.5", description: "Most capable" }],
        },
        {
          id: "another-agent",
          name: "Another Agent",
          path: "/usr/local/bin/another",
          version: "2.0.0",
          acpArgs: [],
          installed: true,
          installUrl: null,
          packages: [],
          models: [{ id: "gpt-4o", name: "GPT-4o", description: "OpenAI flagship" }],
        },
      ];

      setupAcpMocks((cmd) =>
        cmd === "acp_list_agents" ? mockAgents : null
      );

      const agents = await AcpService.listAgents();

      expect(agents).toEqual(mockAgents);
      expect(agents).toHaveLength(2);
      expect(agents[0]?.id).toBe("claude-code-acp");
      expect(agents[0]?.name).toBe("Claude Code");
    });

    it("should return empty array when no agents are discovered", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_list_agents" ? [] : null
      );

      const agents = await AcpService.listAgents();

      expect(agents).toEqual([]);
      expect(agents).toHaveLength(0);
    });

    it("should handle agents with null version", async () => {
      const mockAgents: AgentInfo[] = [
        {
          id: "agent-no-version",
          name: "Agent Without Version",
          path: "/path/to/agent",
          version: null,
          acpArgs: [],
          installed: true,
          installUrl: null,
          packages: [],
          models: [],
        },
      ];

      setupAcpMocks((cmd) =>
        cmd === "acp_list_agents" ? mockAgents : null
      );

      const agents = await AcpService.listAgents();

      expect(agents).toHaveLength(1);
      expect(agents[0]?.version).toBeNull();
    });

    it("should handle invoke error gracefully", async () => {
      setupAcpMocks((cmd) => {
        if (cmd === "acp_list_agents") {
          throw new Error("Failed to discover agents");
        }
        return null;
      });

      await expect(AcpService.listAgents()).rejects.toThrow(
        "Failed to discover agents"
      );
    });
  });

  describe("startAgent", () => {
    it("should start an agent and return instance ID", async () => {
      setupAcpMocks((cmd, args) => {
        if (cmd === "acp_start_agent") {
          expect(args?.agentId).toBe("claude-code-acp");
          return "instance-123";
        }
        return null;
      });

      const instanceId = await AcpService.startAgent("claude-code-acp");

      expect(instanceId).toBe("instance-123");
    });

    it("should handle agent start failure", async () => {
      setupAcpMocks((cmd) => {
        if (cmd === "acp_start_agent") {
          throw new Error("Agent binary not found");
        }
        return null;
      });

      await expect(AcpService.startAgent("nonexistent-agent")).rejects.toThrow(
        "Agent binary not found"
      );
    });
  });

  describe("createSession", () => {
    it("should create a session and return session ID", async () => {
      setupAcpMocks((cmd, args) => {
        if (cmd === "acp_create_session") {
          expect(args?.instanceId).toBe("instance-123");
          expect(args?.cwd).toBe("/home/user/project");
          return "session-456";
        }
        return null;
      });

      const sessionId = await AcpService.createSession(
        "instance-123",
        "/home/user/project"
      );

      expect(sessionId).toBe("session-456");
    });
  });

  describe("sendPrompt", () => {
    it("should send prompt and return session ID", async () => {
      setupAcpMocks((cmd, args) => {
        if (cmd === "acp_send_prompt") {
          expect(args?.instanceId).toBe("instance-123");
          expect(args?.prompt).toBe("Hello, agent!");
          return "session-789";
        }
        return null;
      });

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Hello, agent!"
      );

      expect(sessionId).toBe("session-789");
    });

    it("should send prompt with context JSON", async () => {
      const contextJson = JSON.stringify({ tables: ["users", "posts"] });

      setupAcpMocks((cmd, args) => {
        if (cmd === "acp_send_prompt") {
          expect(args?.contextJson).toBe(contextJson);
          return "session-789";
        }
        return null;
      });

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Generate a query",
        contextJson
      );

      expect(sessionId).toBe("session-789");
    });

    it("should call onChunk callback for AgentMessageChunk events", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_send_prompt" ? "session-stream-1" : null
      );

      const onChunk = vi.fn();

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Hello",
        undefined,
        { onChunk }
      );

      // Simulate streaming event
      const event: SessionUpdateEvent = {
        sessionId,
        update: {
          type: "AgentMessageChunk",
          content: {
            content: [{ type: "text", text: "Hello, human!" }],
          },
        },
      };

      await emit(`acp-update-${sessionId}`, event);

      expect(onChunk).toHaveBeenCalledWith("Hello, human!");
    });

    it("should call onThinking callback for AgentThoughtChunk events", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_send_prompt" ? "session-stream-2" : null
      );

      const onThinking = vi.fn();

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Hello",
        undefined,
        { onThinking }
      );

      // Simulate thinking event
      const event: SessionUpdateEvent = {
        sessionId,
        update: {
          type: "AgentThoughtChunk",
          content: {
            content: [{ type: "text", text: "Let me think about this..." }],
          },
        },
      };

      await emit(`acp-update-${sessionId}`, event);

      expect(onThinking).toHaveBeenCalledWith("Let me think about this...");
    });

    it("should call onToolCall callback for ToolCall events", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_send_prompt" ? "session-stream-3" : null
      );

      const onToolCall = vi.fn();

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Read a file",
        undefined,
        { onToolCall }
      );

      // Simulate tool call event
      const event: SessionUpdateEvent = {
        sessionId,
        update: {
          type: "ToolCall",
          toolCall: {
            id: "tool-1",
            name: "read_file",
            input: { path: "/test.txt" },
          },
        },
      };

      await emit(`acp-update-${sessionId}`, event);

      expect(onToolCall).toHaveBeenCalledWith({
        id: "tool-1",
        name: "read_file",
        status: "pending",
        input: { path: "/test.txt" },
      });
    });

    it("should call onComplete callback and cleanup on Complete event", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_send_prompt" ? "session-stream-4" : null
      );

      const onComplete = vi.fn();

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Done",
        undefined,
        { onComplete }
      );

      // Simulate complete event
      const event: SessionUpdateEvent = {
        sessionId,
        update: { type: "Complete" },
      };

      await emit(`acp-update-${sessionId}`, event);

      expect(onComplete).toHaveBeenCalled();
    });

    it("should call onError callback when prompt fails", async () => {
      setupAcpMocks((cmd) => {
        if (cmd === "acp_send_prompt") {
          throw new Error("Network error");
        }
        return null;
      });

      const onError = vi.fn();

      await expect(
        AcpService.sendPrompt("instance-123", "Hello", undefined, { onError })
      ).rejects.toThrow("Network error");

      expect(onError).toHaveBeenCalledWith("Error: Network error");
    });
  });

  describe("stopListening", () => {
    it("should stop listening for session events", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_send_prompt" ? "session-stop-1" : null
      );

      const onChunk = vi.fn();

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Hello",
        undefined,
        { onChunk }
      );

      // Stop listening
      AcpService.stopListening(sessionId);

      // Emit event after stopping - should not trigger callback
      const event: SessionUpdateEvent = {
        sessionId,
        update: {
          type: "AgentMessageChunk",
          content: {
            content: [{ type: "text", text: "This should not be received" }],
          },
        },
      };

      await emit(`acp-update-${sessionId}`, event);

      // The first chunk might have been received before stopListening
      // but subsequent ones should not be
      expect(onChunk).toHaveBeenCalledTimes(0);
    });

    it("should not error when stopping non-existent listener", () => {
      // Should not throw
      expect(() =>
        AcpService.stopListening("nonexistent-session")
      ).not.toThrow();
    });
  });

  describe("cancelSession", () => {
    it("should cancel an active session", async () => {
      setupAcpMocks((cmd, args) => {
        if (cmd === "acp_cancel_session") {
          expect(args?.instanceId).toBe("instance-123");
          return undefined;
        }
        return null;
      });

      await expect(
        AcpService.cancelSession("instance-123")
      ).resolves.toBeUndefined();
    });

    it("should handle cancel failure gracefully", async () => {
      setupAcpMocks((cmd) => {
        if (cmd === "acp_cancel_session") {
          throw new Error("Session not found");
        }
        return null;
      });

      await expect(AcpService.cancelSession("invalid-instance")).rejects.toThrow(
        "Session not found"
      );
    });
  });

  describe("edge cases", () => {
    it("should handle content blocks without text", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_send_prompt" ? "session-edge-1" : null
      );

      const onChunk = vi.fn();

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Hello",
        undefined,
        { onChunk }
      );

      // Simulate event with image content block (no text)
      const event: SessionUpdateEvent = {
        sessionId,
        update: {
          type: "AgentMessageChunk",
          content: {
            content: [{ type: "image", mimeType: "image/png", data: "base64data" }],
          },
        },
      };

      await emit(`acp-update-${sessionId}`, event);

      // onChunk should not be called since there's no text block
      expect(onChunk).not.toHaveBeenCalled();
    });

    it("should handle empty content array", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_send_prompt" ? "session-edge-2" : null
      );

      const onChunk = vi.fn();

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Hello",
        undefined,
        { onChunk }
      );

      // Simulate event with empty content array
      const event: SessionUpdateEvent = {
        sessionId,
        update: {
          type: "AgentMessageChunk",
          content: {
            content: [],
          },
        },
      };

      await emit(`acp-update-${sessionId}`, event);

      expect(onChunk).not.toHaveBeenCalled();
    });

    it("should handle tool call with undefined input", async () => {
      setupAcpMocks((cmd) =>
        cmd === "acp_send_prompt" ? "session-edge-3" : null
      );

      const onToolCall = vi.fn();

      const sessionId = await AcpService.sendPrompt(
        "instance-123",
        "Execute",
        undefined,
        { onToolCall }
      );

      // Simulate tool call event with undefined input
      const event: SessionUpdateEvent = {
        sessionId,
        update: {
          type: "ToolCall",
          toolCall: {
            id: "tool-1",
            name: "some_tool",
            input: undefined,
          },
        },
      };

      await emit(`acp-update-${sessionId}`, event);

      expect(onToolCall).toHaveBeenCalledWith({
        id: "tool-1",
        name: "some_tool",
        status: "pending",
        input: {},
      });
    });
  });
});
