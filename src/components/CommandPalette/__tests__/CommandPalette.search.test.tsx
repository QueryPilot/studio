import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CommandPalette } from "../CommandPalette";

const searchableItems = vi.hoisted(() => [
  {
    id: "table:conn:public.user_table",
    type: "table",
    name: "user_table",
    subtitle: "",
    schema: "public",
    connectionId: "conn",
    connectionName: "Local",
    database: "app",
    keywords: ["public.user_table", "table", "local", "app"],
  },
]);

vi.mock("../useCommandPaletteQueries", () => ({
  useUnifiedItems: () => ({
    unifiedItems: searchableItems,
    isLoading: false,
    connectionCount: 1,
  }),
}));

vi.mock("../useFrecency", () => ({
  useFrecency: () => ({
    recordAccess: vi.fn(),
    getTopFrecencyItems: () => [],
    sortByFrecency: (items: typeof searchableItems) => items,
  }),
}));

vi.mock("../useItemActions", () => ({
  useItemActions: () => ({
    actions: [],
    executeAction: vi.fn(),
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

const commandPaletteStore = vi.hoisted(() => {
  const commandPaletteState = {
    isOpen: true,
    query: "user table",
    nestedMode: null,
    openPalette: vi.fn(),
    closePalette: vi.fn(),
    setQuery: vi.fn(),
    setNestedMode: vi.fn(),
    exitNestedMode: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };

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

describe("CommandPalette search", () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("matches underscore object names with space-separated query", async () => {
    renderCommandPalette();

    await waitFor(() => {
      expect(screen.getByText("user_table")).toBeInTheDocument();
    });
  });
});
