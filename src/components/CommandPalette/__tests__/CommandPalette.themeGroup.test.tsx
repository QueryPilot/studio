import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CommandPalette } from "../CommandPalette";

const themeItems = vi.hoisted(() => [
  {
    id: "command:appearance.setThemeDark",
    type: "command",
    name: "Dark",
    subtitle: "",
    keywords: ["theme", "dark"],
    command: {
      id: "appearance.setThemeDark",
      label: "Dark",
      source: "default",
      category: "Appearance",
      metadata: { paletteGroup: "Theme" },
    },
  },
  {
    id: "command:appearance.setThemeLight",
    type: "command",
    name: "Light",
    subtitle: "",
    keywords: ["theme", "light"],
    command: {
      id: "appearance.setThemeLight",
      label: "Light",
      source: "default",
      category: "Appearance",
      metadata: { paletteGroup: "Theme" },
    },
  },
  {
    id: "command:appearance.setThemeSystem",
    type: "command",
    name: "System",
    subtitle: "",
    keywords: ["theme", "system"],
    command: {
      id: "appearance.setThemeSystem",
      label: "System",
      source: "default",
      category: "Appearance",
      metadata: { paletteGroup: "Theme" },
    },
  },
]);

vi.mock("../useCommandPaletteQueries", () => ({
  useUnifiedItems: () => ({
    unifiedItems: themeItems,
    isLoading: false,
  }),
}));

vi.mock("../useFrecency", () => ({
  useFrecency: () => ({
    recordAccess: vi.fn(),
    getTopFrecencyItems: () => [],
    sortByFrecency: (items: typeof themeItems) => items,
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
    query: "",
    nestedMode: null,
    openPalette: vi.fn(),
    closePalette: vi.fn(),
    setQuery: vi.fn(),
    setNestedMode: vi.fn(),
    exitNestedMode: vi.fn(),
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

describe("CommandPalette theme grouping", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  it("groups theme commands under a Theme heading", () => {
    renderCommandPalette();

    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });
});
