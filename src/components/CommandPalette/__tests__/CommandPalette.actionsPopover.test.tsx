import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CommandPalette } from "../CommandPalette";

const paletteItems = vi.hoisted(() => [
  {
    id: "table:conn:public.users",
    type: "table",
    name: "users",
    subtitle: "",
    schema: "public",
    connectionId: "conn",
    connectionName: "Local",
    database: "app",
    keywords: ["users", "table"],
    table: {
      name: "users",
      schema: "public",
    },
  },
  {
    id: "command:refresh",
    type: "command",
    name: "Refresh",
    subtitle: "",
    keywords: ["refresh", "command"],
    command: {
      id: "workbench.action.refreshAll",
      label: "Refresh",
      source: "default",
      category: "Workbench",
      metadata: {},
    },
  },
]);

vi.mock("../useCommandPaletteQueries", () => ({
  useUnifiedItems: () => ({
    unifiedItems: paletteItems,
    isLoading: false,
    connectionCount: 1,
  }),
}));

vi.mock("../useFrecency", () => ({
  useFrecency: () => ({
    recordAccess: vi.fn(),
    getTopFrecencyItems: () => [],
    sortByFrecency: (items: typeof paletteItems) => items,
  }),
}));

const executeActionMock = vi.hoisted(() => vi.fn());

vi.mock("../useItemActions", () => ({
  useItemActions: (selectedItem: (typeof paletteItems)[number] | null) => ({
    actions: selectedItem
      ? [
          {
            id: `action:${selectedItem.id}`,
            label: `Action for ${selectedItem.name}`,
          },
        ]
      : [],
    executeAction: executeActionMock,
  }),
  getNestedDatabaseActions: () => [],
  getNestedSchemaActions: () => [],
  executeDatabaseAction: vi.fn(),
  executeSchemaAction: vi.fn(),
}));

vi.mock("@/components/KeyboardProvider", () => ({
  useKeyboardServicesOptional: () => ({
    commandService: {
      onDidRegister: vi.fn(() => () => {}),
      onDidUnregister: vi.fn(() => () => {}),
    },
    keybindingService: {
      onDidRegister: vi.fn(() => () => {}),
      onDidUnregister: vi.fn(() => () => {}),
      onDidChange: vi.fn(() => () => {}),
    },
  }),
}));

const commandPaletteState = vi.hoisted(() => ({
  isOpen: true,
  query: "",
  mode: "all" as const,
  nestedMode: null,
  openPalette: vi.fn(),
  closePalette: vi.fn(),
  setQuery: vi.fn(),
  setMode: vi.fn(),
  setNestedMode: vi.fn(),
  exitNestedMode: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
}));

const commandPaletteStore = vi.hoisted(() => {
  return Object.assign(
    (selector?: (state: typeof commandPaletteState) => unknown) =>
      selector ? selector(commandPaletteState) : commandPaletteState,
    {
      getState: () => commandPaletteState,
    },
  );
});

vi.mock("@/stores/ui/commandPaletteStore", () => ({
  useCommandPaletteStore: commandPaletteStore,
}));

const workspaceSelectionStore = vi.hoisted(() => {
  const workspaceSelectionState = {
    connectionId: null,
    database: null,
    schema: null,
    setSelectedDatabase: vi.fn(),
    setSchema: vi.fn(),
  };

  return Object.assign(
    (selector?: (state: typeof workspaceSelectionState) => unknown) =>
      selector ? selector(workspaceSelectionState) : workspaceSelectionState,
    {
      getState: () => workspaceSelectionState,
    },
  );
});

vi.mock("@/stores/workspaceSelectionStore", () => ({
  useWorkspaceSelectionStore: workspaceSelectionStore,
}));

const connectionStore = vi.hoisted(() => {
  const connectionState = {
    getConnection: () => null,
  };

  return Object.assign(
    (selector?: (state: typeof connectionState) => unknown) =>
      selector ? selector(connectionState) : connectionState,
    {
      getState: () => connectionState,
    },
  );
});

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: connectionStore,
}));

function renderCommandPalette() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>,
  );
}

describe("CommandPalette actions popover keyboard behavior", () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    commandPaletteState.closePalette.mockClear();
    commandPaletteState.openPalette.mockClear();
    commandPaletteState.setQuery.mockClear();
    commandPaletteState.setNestedMode.mockClear();
    commandPaletteState.exitNestedMode.mockClear();
    commandPaletteState.undo.mockClear();
    commandPaletteState.redo.mockClear();
    executeActionMock.mockClear();
  });

  it("opens Cmd+K actions for the currently focused list item", async () => {
    renderCommandPalette();

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Search tables, commands, and more...");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    fireEvent.keyDown(input, { key: "k", metaKey: true });

    await waitFor(() => {
      expect(screen.getByText("Action for Refresh")).toBeInTheDocument();
    });
  });

  it("closes only Cmd+K actions on Escape before closing quick open", async () => {
    renderCommandPalette();

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Search tables, commands, and more...");

    fireEvent.keyDown(input, { key: "k", metaKey: true });

    await waitFor(() => {
      expect(screen.getByText("Action for users")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(commandPaletteState.closePalette).not.toHaveBeenCalled();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(commandPaletteState.closePalette).toHaveBeenCalledTimes(1);
    });
  });
});
