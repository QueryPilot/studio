/**
 * CommandCard Component Tests
 *
 * Tests for mutation and UI commands only.
 * Note: Read commands (SQL, MongoDB, Redis) have been removed - AI uses MCP tools.
 */

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CommandCard, CommandList } from "../CommandCard";
import { useAiCommandPermissionStore } from "@/stores/aiCommandPermissionStore";
import { parseCommands } from "@/utils/aiCommandParser";
import type { ParsedCommand } from "@/types/aiCommands";

// Mock the Tauri invoke function
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock nanoid for unique IDs
let nanoidCounter = 0;
vi.mock("nanoid", () => ({
  nanoid: () => `test-id-${++nanoidCounter}`,
}));

// Mock stores that are used by the executor
vi.mock("@/stores/crudStore", () => ({
  useCrudStore: {
    getState: () => ({
      getTableKey: () => "conn:db:schema:table",
      stageCommand: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/workspaceScreenStore", () => ({
  useWorkspaceScreenStore: {
    getState: () => ({
      getPanels: () => {
        const panel = {
          activeTabId: "tab-1",
          tabs: new Map([["tab-1", { payload: { sql: "SELECT 1" } }]]),
        };
        return new Map([["panel-1", panel]]);
      },
      getActivePanelId: () => "panel-1",
      addTab: vi.fn(() => "tab-1"),
      updateTab: vi.fn(),
    }),
  },
}));

/**
 * Helper to create a parsed command for testing
 */
function createParsedCommand(
  name: ParsedCommand["name"],
  params: Record<string, unknown>,
  options?: Partial<ParsedCommand>
): ParsedCommand {
  return {
    id: options?.id ?? `cmd-${Date.now()}`,
    name,
    params,
    raw: `<command name="${name}">${JSON.stringify(params)}</command>`,
    startIndex: 0,
    endIndex: 100,
    ...options,
  };
}

describe("CommandCard", () => {
  beforeEach(() => {
    // Reset permission store state
    useAiCommandPermissionStore.getState().reset();
    vi.clearAllMocks();
    // Reset nanoid counter for predictable IDs
    nanoidCounter = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Rendering", () => {
    it("should render crud.stage command card", async () => {
      const command = createParsedCommand("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "insert",
        document: { name: "Alice" },
      });

      await act(async () => {
        render(<CommandCard command={command} />);
      });

      // crud.stage requires approval, so should show Run button
      expect(screen.getByText(/Stage insert/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Run/i })).toBeInTheDocument();
    });

    it("should render tab.update command card", async () => {
      const command = createParsedCommand("tab.update", {
        content: "SELECT * FROM users",
        title: "User Query",
      });

      await act(async () => {
        render(<CommandCard command={command} />);
      });

      // tab.update is auto-approve, so should execute automatically
      expect(screen.getByText(/Update tab content/i)).toBeInTheDocument();
    });

    it("should render editor.insert command card", async () => {
      const command = createParsedCommand("editor.insert", {
        text: "-- Comment",
        position: "cursor",
      });

      await act(async () => {
        render(<CommandCard command={command} />);
      });

      // editor.insert is auto-approve, so should execute automatically
      expect(screen.getByText(/Insert at cursor/i)).toBeInTheDocument();
    });

    it("should display error message for commands with parsing errors", () => {
      const command = createParsedCommand(
        "crud.stage",
        {},
        { error: "Invalid JSON: Unexpected token" }
      );

      render(<CommandCard command={command} />);

      expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Run/i })).not.toBeInTheDocument();
    });

    it("should display validation error for missing required params", () => {
      const command = createParsedCommand("crud.stage", {
        connectionId: "conn-123",
        // Missing required 'operation' param
      });

      render(<CommandCard command={command} />);

      // There can be multiple instances of the error message (in header and expanded details)
      const errorMessages = screen.getAllByText(/Missing required parameter: operation/i);
      expect(errorMessages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Approval Flow", () => {
    it("should track command in permission store on mount", async () => {
      const command = createParsedCommand("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "insert",
        document: { name: "Test" },
      });

      await act(async () => {
        render(<CommandCard command={command} />);
      });

      const state = useAiCommandPermissionStore.getState().getCommandState(command.id);
      expect(["pending", "approved", "executing", "completed"]).toContain(state);
    });

    it("should show pending state for approve-level commands", async () => {
      const command = createParsedCommand("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "insert",
        document: { name: "Test" },
      });

      await act(async () => {
        render(<CommandCard command={command} />);
      });

      // Should have Run button visible for approve-level commands
      expect(screen.getByRole("button", { name: /Run/i })).toBeInTheDocument();
    });

    it("should auto-approve auto-level commands", async () => {
      const onResult = vi.fn();
      const command = createParsedCommand("tab.update", {
        content: "SELECT 1",
        title: "Test",
      });

      await act(async () => {
        render(<CommandCard command={command} onResult={onResult} />);
      });

      // Auto-level commands should auto-execute - wait for the result callback
      await waitFor(
        () => {
          expect(onResult).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );
    });

    it("should reject command when reject button is clicked", async () => {
      const command = createParsedCommand("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "insert",
        document: { name: "Test" },
      });

      await act(async () => {
        render(<CommandCard command={command} />);
      });

      // Find all buttons - the reject button is the one that doesn't contain "Run" text
      const buttons = screen.getAllByRole("button");
      const runButton = buttons.find((btn) => btn.textContent?.includes("Run"));
      const rejectButton = buttons.find(
        (btn) => !btn.textContent?.includes("Run") && btn !== runButton
      );
      expect(rejectButton).toBeDefined();

      await act(async () => {
        if (rejectButton) {
          fireEvent.click(rejectButton);
        }
      });

      await waitFor(() => {
        expect(screen.getByText(/Rejected/i)).toBeInTheDocument();
      });
    });
  });

  describe("CRUD Command Execution", () => {
    it("should execute crud.stage command", async () => {
      const onResult = vi.fn();
      const command = createParsedCommand("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "insert",
        document: { name: "Alice", email: "alice@example.com" },
        description: "Add new user",
      });

      render(<CommandCard command={command} onResult={onResult} />);

      const runButton = screen.getByRole("button", { name: /Run/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(onResult).toHaveBeenCalled();
        const resultText = onResult.mock.calls[0]?.[0];
        expect(resultText).toContain("Change staged");
      });
    });

    it("should handle crud.stage validation errors", async () => {
      const onResult = vi.fn();
      const command = createParsedCommand("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "insert",
        document: {}, // Empty document should fail
      });

      render(<CommandCard command={command} onResult={onResult} />);

      const runButton = screen.getByRole("button", { name: /Run/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(onResult).toHaveBeenCalled();
        const resultText = onResult.mock.calls[0]?.[0];
        expect(resultText).toContain("Error");
        expect(resultText).toContain("non-empty document");
      });
    });
  });

  describe("Tab Commands Execution", () => {
    it("should execute tab.update command", async () => {
      const onResult = vi.fn();
      const command = createParsedCommand("tab.update", {
        content: "SELECT * FROM new_query",
        title: "New Query",
      });

      await act(async () => {
        render(<CommandCard command={command} onResult={onResult} />);
      });

      // tab.update is auto-approve level - wait for auto-execution
      await waitFor(
        () => {
          expect(onResult).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );
    });

    it("should execute editor.insert command", async () => {
      const onResult = vi.fn();
      const command = createParsedCommand("editor.insert", {
        text: "-- New comment\n",
        position: "cursor",
      });

      await act(async () => {
        render(<CommandCard command={command} onResult={onResult} />);
      });

      // editor.insert is auto-approve level
      await waitFor(
        () => {
          expect(onResult).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle validation errors gracefully", async () => {
      const onResult = vi.fn();
      const command = createParsedCommand("crud.stage", {
        connectionId: "conn-123",
        table: "users",
        operation: "update",
        // Missing primaryKeys/filter for update
        update: { name: "Bob" },
      });

      render(<CommandCard command={command} onResult={onResult} />);

      const runButton = screen.getByRole("button", { name: /Run/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(onResult).toHaveBeenCalled();
        const resultText = onResult.mock.calls[0]?.[0];
        expect(resultText).toContain("Error");
      });
    });
  });
});

describe("CommandList", () => {
  beforeEach(() => {
    useAiCommandPermissionStore.getState().reset();
    vi.clearAllMocks();
    nanoidCounter = 0;
  });

  it("should render multiple commands", async () => {
    const commands = [
      createParsedCommand(
        "crud.stage",
        { connectionId: "c1", table: "users", operation: "insert", document: { name: "A" } },
        { id: "cmd-1" }
      ),
      createParsedCommand(
        "crud.stage",
        { connectionId: "c1", table: "users", operation: "insert", document: { name: "B" } },
        { id: "cmd-2" }
      ),
    ];

    await act(async () => {
      render(<CommandList commands={commands} />);
    });

    expect(screen.getAllByText(/Stage insert/i)).toHaveLength(2);
  });

  it("should show 'Allow all' button when multiple pending commands", async () => {
    const commands = [
      createParsedCommand(
        "crud.stage",
        { connectionId: "c1", table: "users", operation: "insert", document: { name: "A" } },
        { id: "cmd-1" }
      ),
      createParsedCommand(
        "crud.stage",
        { connectionId: "c1", table: "users", operation: "insert", document: { name: "B" } },
        { id: "cmd-2" }
      ),
      createParsedCommand(
        "crud.stage",
        { connectionId: "c1", table: "users", operation: "insert", document: { name: "C" } },
        { id: "cmd-3" }
      ),
    ];

    await act(async () => {
      render(<CommandList commands={commands} />);
    });

    expect(screen.getByText(/Allow all this conversation/i)).toBeInTheDocument();
  });

  it("should not render when commands array is empty", () => {
    const { container } = render(<CommandList commands={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("should call onResult with command ID when command completes", async () => {
    const onResult = vi.fn();
    const commands = [
      createParsedCommand(
        "crud.stage",
        {
          connectionId: "c1",
          table: "users",
          operation: "insert",
          document: { name: "Test" },
        },
        { id: "cmd-1" }
      ),
    ];

    await act(async () => {
      render(<CommandList commands={commands} onResult={onResult} />);
    });

    const runButton = screen.getByRole("button", { name: /Run/i });
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith("cmd-1", expect.any(String));
    });
  });
});

describe("End-to-End: Parse -> Render -> Execute", () => {
  beforeEach(() => {
    useAiCommandPermissionStore.getState().reset();
    vi.clearAllMocks();
    nanoidCounter = 0;
  });

  it("should parse crud.stage commands from AI response and execute", async () => {
    const aiResponse = `I'll help you insert a new user.

<command name="crud.stage">
{
  "connectionId": "conn-123",
  "table": "users",
  "operation": "insert",
  "document": { "name": "Alice", "email": "alice@example.com" }
}
</command>

This will stage the insert for review.`;

    // Step 1: Parse commands
    const commands = parseCommands(aiResponse);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command?.name).toBe("crud.stage");

    // Step 2: Render CommandCard
    const onResult = vi.fn();
    await act(async () => {
      render(<CommandCard command={command as ParsedCommand} onResult={onResult} />);
    });

    // Step 3: Click Run
    const runButton = screen.getByRole("button", { name: /Run/i });
    fireEvent.click(runButton);

    // Step 4: Verify result
    await waitFor(() => {
      expect(onResult).toHaveBeenCalled();
      const resultText = onResult.mock.calls[0]?.[0];
      expect(resultText).toContain("Change staged");
    });
  });

  it("should handle multiple mutation commands in one response", async () => {
    const aiResponse = `Let me stage these changes:

<command name="crud.stage">{"connectionId": "c1", "table": "users", "operation": "insert", "document": {"name": "A"}}</command>

And also:

<command name="crud.stage">{"connectionId": "c1", "table": "users", "operation": "insert", "document": {"name": "B"}}</command>`;

    const commands = parseCommands(aiResponse);
    expect(commands).toHaveLength(2);

    await act(async () => {
      render(<CommandList commands={commands} />);
    });

    expect(screen.getAllByText(/Stage insert/i)).toHaveLength(2);
    expect(screen.getByText(/Allow all this conversation/i)).toBeInTheDocument();
  });
});

describe("Permission Store Integration", () => {
  beforeEach(() => {
    useAiCommandPermissionStore.getState().reset();
    vi.clearAllMocks();
    nanoidCounter = 0;
  });

  it("should respect allowAllThisConversation setting", async () => {
    // Enable allow all
    useAiCommandPermissionStore.getState().setAllowAll(true);

    const command = createParsedCommand("crud.stage", {
      connectionId: "conn-123",
      table: "users",
      operation: "insert",
      document: { name: "Test" },
    });

    const onResult = vi.fn();
    await act(async () => {
      render(<CommandCard command={command} onResult={onResult} />);
    });

    // Should auto-execute since allowAll is true and crud.stage is approve-level
    await waitFor(
      () => {
        expect(onResult).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });

  it("should update command state through execution lifecycle", async () => {
    const onResult = vi.fn();
    const command = createParsedCommand("crud.stage", {
      connectionId: "conn-123",
      table: "users",
      operation: "insert",
      document: { name: "Test" },
    });

    await act(async () => {
      render(<CommandCard command={command} onResult={onResult} />);
    });

    // Initially pending
    expect(useAiCommandPermissionStore.getState().getCommandState(command.id)).toBe("pending");

    // Click run
    await act(async () => {
      const runButton = screen.getByRole("button", { name: /Run/i });
      fireEvent.click(runButton);
    });

    // Verify the execution completed by checking result callback was called
    await waitFor(() => {
      expect(onResult).toHaveBeenCalled();
    });

    // Should be completed
    await waitFor(() => {
      const finalState = useAiCommandPermissionStore.getState().getCommandState(command.id);
      expect(["completed", "approved"]).toContain(finalState);
    });
  });
});
