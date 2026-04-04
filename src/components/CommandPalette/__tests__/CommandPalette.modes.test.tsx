import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CommandPalette } from "../CommandPalette";

// Hoisted mutable state — tests mutate `mode` before rendering
const commandPaletteState = vi.hoisted(() => ({
  isOpen: true,
  query: "",
  mode: "all" as "all" | "objects" | "actions",
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

vi.mock("@/stores/ui/commandPaletteStore", () => ({
  useCommandPaletteStore: Object.assign(
    (selector?: (state: typeof commandPaletteState) => unknown) =>
      selector ? selector(commandPaletteState) : commandPaletteState,
    { getState: () => commandPaletteState },
  ),
}));

vi.mock("../useCommandPaletteQueries", () => ({
  useUnifiedItems: () => ({
    unifiedItems: [
      {
        id: "table:conn:public.users",
        type: "table",
        name: "users",
        subtitle: "",
        schema: "public",
        connectionId: "conn",
        connectionName: "Local",
        database: "app",
        keywords: ["public.users", "table"],
      },
      {
        id: "command:theme.toggle",
        type: "command",
        name: "Toggle Theme",
        subtitle: "⌘T",
        schema: "",
        connectionId: null,
        connectionName: null,
        database: null,
        keywords: ["theme", "toggle"],
        command: { id: "theme.toggle", icon: null },
      },
    ],
    isLoading: false,
    connectionCount: 1,
  }),
}));

vi.mock("../useFrecency", () => ({
  useFrecency: () => ({
    recordAccess: vi.fn(),
    getTopFrecencyItems: () => [],
    sortByFrecency: (items: unknown[]) => items,
    getFrecencyScore: () => 0,
  }),
}));

vi.mock("../useItemActions", () => ({
  useItemActions: () => ({ actions: [], executeAction: vi.fn() }),
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

vi.mock("@/stores/workspaceSelectionStore", () => ({
  useWorkspaceSelectionStore: Object.assign(
    (selector?: (s: { connectionId: null; database: null; schema: null; setSchema: ReturnType<typeof vi.fn> }) => unknown) => {
      const s = { connectionId: null, database: null, schema: null, setSchema: vi.fn() };
      return selector ? selector(s) : s;
    },
    { getState: () => ({ connectionId: null, database: null, schema: null, setSchema: vi.fn() }) },
  ),
}));

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: Object.assign(
    (selector?: (s: { getConnection: () => null }) => unknown) => {
      const s = { getConnection: () => null };
      return selector ? selector(s) : s;
    },
    { getState: () => ({ getConnection: () => null }) },
  ),
}));

function renderCommandPalette() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  commandPaletteState.mode = "all";
  commandPaletteState.query = "";
});

describe("CommandPalette mode filtering", () => {
  it("shows both tables and commands in 'all' mode", async () => {
    commandPaletteState.mode = "all";
    renderCommandPalette();
    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
      expect(screen.getByText("Toggle Theme")).toBeInTheDocument();
    });
  });

  it("hides commands in 'objects' mode", async () => {
    commandPaletteState.mode = "objects";
    renderCommandPalette();
    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
      expect(screen.queryByText("Toggle Theme")).not.toBeInTheDocument();
    });
  });

  it("hides tables in 'actions' mode", async () => {
    commandPaletteState.mode = "actions";
    renderCommandPalette();
    await waitFor(() => {
      expect(screen.queryByText("users")).not.toBeInTheDocument();
      expect(screen.getByText("Toggle Theme")).toBeInTheDocument();
    });
  });

  it("shows 'Objects' badge in objects mode", async () => {
    commandPaletteState.mode = "objects";
    renderCommandPalette();
    await waitFor(() => {
      expect(screen.getByText("Objects")).toBeInTheDocument();
    });
  });

  it("shows 'Actions' badge in actions mode", async () => {
    commandPaletteState.mode = "actions";
    renderCommandPalette();
    await waitFor(() => {
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });
  });

  it("shows no mode badge in 'all' mode", async () => {
    commandPaletteState.mode = "all";
    renderCommandPalette();
    await waitFor(() => {
      expect(screen.queryByText("Objects")).not.toBeInTheDocument();
      expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    });
  });
});
