/**
 * ACP Store Tests
 *
 * Tests for the Zustand store managing ACP (Agent Client Protocol) state,
 * including agent selection, session lifecycle, and message streaming.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAcpStore } from "../acpStore";
import { AcpService } from "@/services/acpService";
import * as db from "@/lib/db/aiConversations";
import type { AgentInfo, AcpSession, AcpMessage } from "@/types/acp";

// Mock the AcpService
vi.mock("@/services/acpService", () => ({
  AcpService: {
    listAgents: vi.fn(),
    startAgent: vi.fn(),
    createSession: vi.fn(),
    sendPrompt: vi.fn(),
    cancelSession: vi.fn(),
    getLlmHome: vi.fn().mockResolvedValue("/home/user/.querypilot/llm"),
    setSessionModel: vi.fn(),
  },
}));

// Mock the database
vi.mock("@/lib/db/aiConversations", () => ({
  saveSession: vi.fn(),
  getSession: vi.fn(),
  getSessionMessages: vi.fn(),
  saveMessage: vi.fn(),
  listRecentSessions: vi.fn().mockResolvedValue([]),
}));

describe("acpStore", () => {
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
      models: [
        { id: "opus", name: "Opus 4.5", description: "Most capable" },
        { id: "sonnet", name: "Sonnet 4.5", description: "Balanced" },
      ],
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
      models: [
        { id: "gpt-4o", name: "GPT-4o", description: "OpenAI flagship" },
      ],
    },
  ];

  beforeEach(() => {
    // Reset store to initial state
    useAcpStore.setState({
      availableAgents: [],
      selectedAgentId: null,
      selectedModel: null,
      isLoadingAgents: false,
      activeSession: null,
      activeInstanceId: null,
      messages: [],
      isStreaming: false,
      streamingContent: "",
      streamingThinking: "",
      isPanelOpen: false,
    });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("Initial State", () => {
    it("should have correct initial state", () => {
      const state = useAcpStore.getState();

      expect(state.availableAgents).toEqual([]);
      expect(state.selectedAgentId).toBeNull();
      expect(state.isLoadingAgents).toBe(false);
      expect(state.activeSession).toBeNull();
      expect(state.activeInstanceId).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.isStreaming).toBe(false);
      expect(state.streamingContent).toBe("");
      expect(state.streamingThinking).toBe("");
      expect(state.isPanelOpen).toBe(false);
    });
  });

  describe("loadAgents", () => {
    it("should load agents and update state", async () => {
      vi.mocked(AcpService.listAgents).mockResolvedValue(mockAgents);

      await useAcpStore.getState().loadAgents();

      const state = useAcpStore.getState();
      expect(state.availableAgents).toEqual(mockAgents);
      expect(AcpService.listAgents).toHaveBeenCalledTimes(1);
    });

    it("should set isLoadingAgents to true during load and false after", async () => {
      let loadingDuringCall = false;
      vi.mocked(AcpService.listAgents).mockImplementation(async () => {
        loadingDuringCall = useAcpStore.getState().isLoadingAgents;
        return mockAgents;
      });

      await useAcpStore.getState().loadAgents();

      expect(loadingDuringCall).toBe(true);
      expect(useAcpStore.getState().isLoadingAgents).toBe(false);
    });

    it("should set isLoadingAgents to false even on error", async () => {
      vi.mocked(AcpService.listAgents).mockRejectedValue(new Error("Network error"));

      await expect(useAcpStore.getState().loadAgents()).rejects.toThrow("Network error");

      expect(useAcpStore.getState().isLoadingAgents).toBe(false);
    });

    it("should auto-select first installed agent if none selected", async () => {
      vi.mocked(AcpService.listAgents).mockResolvedValue(mockAgents);

      await useAcpStore.getState().loadAgents();

      const state = useAcpStore.getState();
      expect(state.selectedAgentId).toBe("claude-code-acp");
    });

    it("should skip uninstalled agents when auto-selecting", async () => {
      const agentsWithUninstalled: AgentInfo[] = [
        {
          id: "uninstalled-agent",
          name: "Uninstalled Agent",
          path: null,
          version: null,
          acpArgs: [],
          installed: false,
          installUrl: "https://example.com/install",
          packages: [{ name: "agent", description: "Agent CLI", managerType: "brew", installed: false, installedVersion: null, latestVersion: null, updateAvailable: false }],
          models: [],
        },
        {
          id: "installed-agent",
          name: "Installed Agent",
          path: "/usr/local/bin/agent",
          version: "1.0.0",
          acpArgs: [],
          installed: true,
          installUrl: null,
          packages: [],
          models: [{ id: "default", name: "Default", description: "Default model" }],
        },
      ];
      vi.mocked(AcpService.listAgents).mockResolvedValue(agentsWithUninstalled);

      await useAcpStore.getState().loadAgents();

      const state = useAcpStore.getState();
      expect(state.selectedAgentId).toBe("installed-agent");
    });

    it("should not auto-select if no installed agents", async () => {
      const uninstalledOnly: AgentInfo[] = [
        {
          id: "uninstalled-agent",
          name: "Uninstalled Agent",
          path: null,
          version: null,
          acpArgs: [],
          installed: false,
          installUrl: "https://example.com/install",
          packages: [],
          models: [],
        },
      ];
      vi.mocked(AcpService.listAgents).mockResolvedValue(uninstalledOnly);

      await useAcpStore.getState().loadAgents();

      const state = useAcpStore.getState();
      expect(state.selectedAgentId).toBeNull();
    });

    it("should not change selection if agent already selected", async () => {
      useAcpStore.setState({ selectedAgentId: "existing-agent" });
      vi.mocked(AcpService.listAgents).mockResolvedValue(mockAgents);

      await useAcpStore.getState().loadAgents();

      const state = useAcpStore.getState();
      expect(state.selectedAgentId).toBe("existing-agent");
    });

    it("should handle empty agents list", async () => {
      vi.mocked(AcpService.listAgents).mockResolvedValue([]);

      await useAcpStore.getState().loadAgents();

      const state = useAcpStore.getState();
      expect(state.availableAgents).toEqual([]);
      expect(state.selectedAgentId).toBeNull();
    });
  });

  describe("selectAgent", () => {
    it("should update selected agent ID", () => {
      useAcpStore.setState({ availableAgents: mockAgents });

      useAcpStore.getState().selectAgent("another-agent");

      expect(useAcpStore.getState().selectedAgentId).toBe("another-agent");
    });

    it("should allow selecting any agent ID", () => {
      useAcpStore.getState().selectAgent("unknown-agent");

      expect(useAcpStore.getState().selectedAgentId).toBe("unknown-agent");
    });
  });

  describe("startSession", () => {
    it("should start a new session with selected agent", async () => {
      useAcpStore.setState({
        availableAgents: mockAgents,
        selectedAgentId: "claude-code-acp",
      });

      vi.mocked(AcpService.startAgent).mockResolvedValue("instance-123");
      vi.mocked(AcpService.createSession).mockResolvedValue("session-456");
      vi.mocked(db.saveSession).mockResolvedValue();

      const sessionId = await useAcpStore.getState().startSession();

      expect(sessionId).toBe("session-456");
      expect(AcpService.startAgent).toHaveBeenCalledWith("claude-code-acp");
      // createSession uses the LLM home directory from AcpService.getLlmHome()
      expect(AcpService.createSession).toHaveBeenCalledWith(
        "instance-123",
        "/home/user/.querypilot/llm"
      );
      expect(db.saveSession).toHaveBeenCalled();

      const state = useAcpStore.getState();
      expect(state.activeInstanceId).toBe("instance-123");
      expect(state.activeSession?.id).toBe("session-456");
      expect(state.activeSession?.agentId).toBe("claude-code-acp");
      expect(state.messages).toEqual([]);
    });

    it("should throw error if no agent selected", async () => {
      useAcpStore.setState({ selectedAgentId: null });

      await expect(useAcpStore.getState().startSession()).rejects.toThrow(
        "No agent selected"
      );
    });

    it("should associate session with connection ID", async () => {
      useAcpStore.setState({
        availableAgents: mockAgents,
        selectedAgentId: "claude-code-acp",
      });

      vi.mocked(AcpService.startAgent).mockResolvedValue("instance-123");
      vi.mocked(AcpService.createSession).mockResolvedValue("session-456");
      vi.mocked(db.saveSession).mockResolvedValue();

      await useAcpStore.getState().startSession("conn-123");

      const state = useAcpStore.getState();
      expect(state.activeSession?.connectionId).toBe("conn-123");
    });
  });

  describe("loadSession", () => {
    it("should load existing session and messages", async () => {
      const mockSession: AcpSession = {
        id: "session-123",
        agentId: "claude-code-acp",
        instanceId: "instance-123",
        title: "Test Session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const mockMessages: AcpMessage[] = [
        {
          id: "msg-1",
          sessionId: "session-123",
          role: "user",
          content: "Hello",
          timestamp: Date.now() - 1000,
        },
        {
          id: "msg-2",
          sessionId: "session-123",
          role: "assistant",
          content: "Hi there!",
          timestamp: Date.now(),
        },
      ];

      vi.mocked(db.getSession).mockResolvedValue(mockSession);
      vi.mocked(db.getSessionMessages).mockResolvedValue(mockMessages);

      await useAcpStore.getState().loadSession("session-123");

      const state = useAcpStore.getState();
      expect(state.activeSession).toEqual(mockSession);
      expect(state.activeInstanceId).toBe("instance-123");
      expect(state.messages).toEqual(mockMessages);
    });

    it("should throw error if session not found", async () => {
      vi.mocked(db.getSession).mockResolvedValue(undefined);

      await expect(
        useAcpStore.getState().loadSession("nonexistent")
      ).rejects.toThrow("Session not found");
    });
  });

  describe("sendMessage", () => {
    it("should add user message and start streaming", async () => {
      const mockSession: AcpSession = {
        id: "session-123",
        agentId: "claude-code-acp",
        instanceId: "instance-123",
        title: "Test Session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useAcpStore.setState({
        activeSession: mockSession,
        activeInstanceId: "instance-123",
        messages: [],
      });

      vi.mocked(db.saveMessage).mockResolvedValue();
      vi.mocked(AcpService.sendPrompt).mockResolvedValue("session-123");

      await useAcpStore.getState().sendMessage("Hello!");

      const state = useAcpStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.role).toBe("user");
      expect(state.messages[0]?.content).toBe("Hello!");
      expect(state.isStreaming).toBe(true);
      expect(db.saveMessage).toHaveBeenCalled();
    });

    it("should throw error if no active session", async () => {
      useAcpStore.setState({
        activeSession: null,
        activeInstanceId: null,
      });

      await expect(useAcpStore.getState().sendMessage("Hello!")).rejects.toThrow(
        "No active session"
      );
    });

    it("should pass context JSON to AcpService", async () => {
      const mockSession: AcpSession = {
        id: "session-123",
        agentId: "claude-code-acp",
        instanceId: "instance-123",
        title: "Test Session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useAcpStore.setState({
        activeSession: mockSession,
        activeInstanceId: "instance-123",
      });

      vi.mocked(db.saveMessage).mockResolvedValue();
      vi.mocked(AcpService.sendPrompt).mockResolvedValue("session-123");

      const contextJson = JSON.stringify({ tables: ["users"] });
      await useAcpStore.getState().sendMessage("Query users", contextJson);

      expect(AcpService.sendPrompt).toHaveBeenCalledWith(
        "instance-123",
        "Query users",
        contextJson,
        expect.any(Object)
      );
    });
  });

  describe("cancelGeneration", () => {
    it("should cancel active session and stop streaming", async () => {
      useAcpStore.setState({
        activeInstanceId: "instance-123",
        isStreaming: true,
      });

      vi.mocked(AcpService.cancelSession).mockResolvedValue();

      await useAcpStore.getState().cancelGeneration();

      expect(AcpService.cancelSession).toHaveBeenCalledWith("instance-123");
      expect(useAcpStore.getState().isStreaming).toBe(false);
    });

    it("should do nothing if no active instance", async () => {
      useAcpStore.setState({
        activeInstanceId: null,
        isStreaming: true,
      });

      await useAcpStore.getState().cancelGeneration();

      expect(AcpService.cancelSession).not.toHaveBeenCalled();
      // isStreaming should remain unchanged when there's no instance
      expect(useAcpStore.getState().isStreaming).toBe(true);
    });
  });

  describe("appendChunk", () => {
    it("should append text to streaming content", () => {
      useAcpStore.setState({ streamingContent: "Hello" });

      useAcpStore.getState().appendChunk(" World");

      expect(useAcpStore.getState().streamingContent).toBe("Hello World");
    });

    it("should start from empty string", () => {
      useAcpStore.setState({ streamingContent: "" });

      useAcpStore.getState().appendChunk("Start");

      expect(useAcpStore.getState().streamingContent).toBe("Start");
    });

    it("should handle multiple sequential chunks", () => {
      useAcpStore.setState({ streamingContent: "" });

      const { appendChunk } = useAcpStore.getState();
      appendChunk("One ");
      appendChunk("Two ");
      appendChunk("Three");

      expect(useAcpStore.getState().streamingContent).toBe("One Two Three");
    });
  });

  describe("appendThinking", () => {
    it("should append text to streaming thinking", () => {
      useAcpStore.setState({ streamingThinking: "Thinking about" });

      useAcpStore.getState().appendThinking(" this problem...");

      expect(useAcpStore.getState().streamingThinking).toBe(
        "Thinking about this problem..."
      );
    });

    it("should start from empty string", () => {
      useAcpStore.setState({ streamingThinking: "" });

      useAcpStore.getState().appendThinking("Let me analyze...");

      expect(useAcpStore.getState().streamingThinking).toBe("Let me analyze...");
    });
  });

  describe("finalizeMessage", () => {
    it("should create assistant message from streaming content", async () => {
      const mockSession: AcpSession = {
        id: "session-123",
        agentId: "claude-code-acp",
        instanceId: "instance-123",
        title: "Test Session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useAcpStore.setState({
        activeSession: mockSession,
        streamingContent: "This is the response",
        streamingThinking: "I thought about it",
        isStreaming: true,
        messages: [],
      });

      vi.mocked(db.saveMessage).mockResolvedValue();
      vi.mocked(db.saveSession).mockResolvedValue();

      await useAcpStore.getState().finalizeMessage();

      const state = useAcpStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.role).toBe("assistant");
      expect(state.messages[0]?.content).toBe("This is the response");
      expect(state.messages[0]?.thinking).toBe("I thought about it");
      expect(state.isStreaming).toBe(false);
      expect(state.streamingContent).toBe("");
      expect(state.streamingThinking).toBe("");
    });

    it("should do nothing if no active session", async () => {
      useAcpStore.setState({
        activeSession: null,
        streamingContent: "Content",
        messages: [],
      });

      await useAcpStore.getState().finalizeMessage();

      expect(useAcpStore.getState().messages).toHaveLength(0);
      expect(db.saveMessage).not.toHaveBeenCalled();
    });

    it("should not include thinking if empty", async () => {
      const mockSession: AcpSession = {
        id: "session-123",
        agentId: "claude-code-acp",
        instanceId: "instance-123",
        title: "Test Session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useAcpStore.setState({
        activeSession: mockSession,
        streamingContent: "Response",
        streamingThinking: "",
        isStreaming: true,
        messages: [],
      });

      vi.mocked(db.saveMessage).mockResolvedValue();
      vi.mocked(db.saveSession).mockResolvedValue();

      await useAcpStore.getState().finalizeMessage();

      const state = useAcpStore.getState();
      expect(state.messages[0]?.thinking).toBeUndefined();
    });

    it("should update session timestamp", async () => {
      const mockSession: AcpSession = {
        id: "session-123",
        agentId: "claude-code-acp",
        instanceId: "instance-123",
        title: "Test Session",
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 10000,
      };

      useAcpStore.setState({
        activeSession: mockSession,
        streamingContent: "Response",
        streamingThinking: "",
        isStreaming: true,
        messages: [],
      });

      vi.mocked(db.saveMessage).mockResolvedValue();
      vi.mocked(db.saveSession).mockResolvedValue();

      await useAcpStore.getState().finalizeMessage();

      expect(db.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "session-123",
          updatedAt: expect.any(Number),
        })
      );
    });
  });

  describe("togglePanel", () => {
    it("should toggle panel from closed to open", () => {
      useAcpStore.setState({ isPanelOpen: false });

      useAcpStore.getState().togglePanel();

      expect(useAcpStore.getState().isPanelOpen).toBe(true);
    });

    it("should toggle panel from open to closed", () => {
      useAcpStore.setState({ isPanelOpen: true });

      useAcpStore.getState().togglePanel();

      expect(useAcpStore.getState().isPanelOpen).toBe(false);
    });

    it("should toggle panel multiple times", () => {
      useAcpStore.setState({ isPanelOpen: false });

      const { togglePanel } = useAcpStore.getState();
      togglePanel();
      expect(useAcpStore.getState().isPanelOpen).toBe(true);

      togglePanel();
      expect(useAcpStore.getState().isPanelOpen).toBe(false);

      togglePanel();
      expect(useAcpStore.getState().isPanelOpen).toBe(true);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete conversation flow", async () => {
      // 1. Load agents
      vi.mocked(AcpService.listAgents).mockResolvedValue(mockAgents);
      await useAcpStore.getState().loadAgents();
      expect(useAcpStore.getState().selectedAgentId).toBe("claude-code-acp");

      // 2. Start session
      vi.mocked(AcpService.startAgent).mockResolvedValue("instance-123");
      vi.mocked(AcpService.createSession).mockResolvedValue("session-456");
      vi.mocked(db.saveSession).mockResolvedValue();

      await useAcpStore.getState().startSession();

      // 3. Send message
      vi.mocked(db.saveMessage).mockResolvedValue();
      vi.mocked(AcpService.sendPrompt).mockResolvedValue("session-456");

      await useAcpStore.getState().sendMessage("Hello agent!");

      expect(useAcpStore.getState().messages).toHaveLength(1);
      expect(useAcpStore.getState().isStreaming).toBe(true);

      // 4. Simulate streaming
      useAcpStore.getState().appendChunk("Hello ");
      useAcpStore.getState().appendChunk("human!");
      useAcpStore.getState().appendThinking("Generating greeting...");

      // 5. Finalize message
      await useAcpStore.getState().finalizeMessage();

      const state = useAcpStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]?.role).toBe("user");
      expect(state.messages[1]?.role).toBe("assistant");
      expect(state.messages[1]?.content).toBe("Hello human!");
      expect(state.isStreaming).toBe(false);
    });

    it("should maintain state isolation between sessions", async () => {
      const session1: AcpSession = {
        id: "session-1",
        agentId: "claude-code-acp",
        instanceId: "instance-1",
        title: "Session 1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const session2: AcpSession = {
        id: "session-2",
        agentId: "another-agent",
        instanceId: "instance-2",
        title: "Session 2",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const messages1: AcpMessage[] = [
        {
          id: "msg-1",
          sessionId: "session-1",
          role: "user",
          content: "Session 1 message",
          timestamp: Date.now(),
        },
      ];

      const messages2: AcpMessage[] = [
        {
          id: "msg-2",
          sessionId: "session-2",
          role: "user",
          content: "Session 2 message",
          timestamp: Date.now(),
        },
      ];

      // Load session 1
      vi.mocked(db.getSession).mockResolvedValue(session1);
      vi.mocked(db.getSessionMessages).mockResolvedValue(messages1);

      await useAcpStore.getState().loadSession("session-1");
      expect(useAcpStore.getState().messages[0]?.content).toBe(
        "Session 1 message"
      );

      // Load session 2
      vi.mocked(db.getSession).mockResolvedValue(session2);
      vi.mocked(db.getSessionMessages).mockResolvedValue(messages2);

      await useAcpStore.getState().loadSession("session-2");
      expect(useAcpStore.getState().messages[0]?.content).toBe(
        "Session 2 message"
      );
    });
  });
});
