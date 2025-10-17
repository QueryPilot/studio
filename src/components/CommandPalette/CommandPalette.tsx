import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Search,
  Terminal,
  FileText,
  Zap,
  HelpCircle,
  Hash,
  AtSign,
  Code,
  Command as CommandIcon,
  Sparkles,
} from "lucide-react";
import { fuzzyMatch } from "./fuzzyMatch";
import { DatabaseCommandProvider } from "./providers/DatabaseCommandProvider";
import { useParams } from "react-router-dom";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";

export type PaletteMode = ">" | "@" | ":" | "?" | "#" | "!" | "$" | "";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: PaletteMode;
}

export interface CommandItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  description?: string;
  category?: string;
  action: () => void | Promise<void>;
  keywords?: string[];
  when?: string;
}

const modeIcons: Record<PaletteMode, React.ReactNode> = {
  ">": <CommandIcon className="w-4 h-4" />,
  "@": <AtSign className="w-4 h-4" />,
  ":": <Hash className="w-4 h-4" />,
  "?": <HelpCircle className="w-4 h-4" />,
  "#": <Search className="w-4 h-4" />,
  "!": <Zap className="w-4 h-4" />,
  $: <Code className="w-4 h-4" />,
  "": <Search className="w-4 h-4" />,
};

const modePlaceholders: Record<PaletteMode, string> = {
  ">": "Type a command or search...",
  "@": "Go to table, view, or function...",
  ":": "Go to line...",
  "?": "Search help and documentation...",
  "#": "Search in workspace...",
  "!": "Run SQL snippet...",
  $: "Search variables...",
  "": "Type > for commands, @ for symbols...",
};

export function CommandPalette({
  open,
  onOpenChange,
  initialMode = ">",
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const { connectionId } = useParams<{ connectionId: string }>();
  const dbProvider = useMemo(() => {
    if (connectionId) {
      return new DatabaseCommandProvider(connectionId);
    }
    return null;
  }, [connectionId]);

  const ensureAssistantVisible = useCallback(() => {
    const store = useWorkspaceScreenStore.getState();
    const sidebars = store.getSidebars();
    if (!sidebars.right) {
      store.toggleSidebar("right");
    }
  }, []);

  const aiCommands = useMemo<CommandItem[]>(
    () => [
      {
        id: "ai.openAssistant",
        label: "AI: Open Assistant Panel",
        icon: <Sparkles className="w-4 h-4 text-blue-500" />,
        category: "AI",
        keywords: ["ai", "assistant", "chat"],
        action: () => {
          ensureAssistantVisible();
          window.dispatchEvent(new CustomEvent("devdb-ai-focus"));
        },
      },
      {
        id: "ai.runCommand",
        label: "AI: Run Command…",
        icon: <Zap className="w-4 h-4" />,
        category: "AI",
        keywords: ["command", "tool"],
        action: () => {
          ensureAssistantVisible();
          window.dispatchEvent(new CustomEvent("devdb-ai-open-commands"));
        },
      },
    ],
    [ensureAssistantVisible],
  );

  // Cleanup provider on unmount
  useEffect(() => {
    return () => {
      if (dbProvider) {
        dbProvider.dispose();
      }
    };
  }, [dbProvider]);

  // Build command items based on mode
  const commandItems = useMemo((): CommandItem[] => {
    switch (mode) {
      case ">": {
        const items: CommandItem[] = [];
        if (dbProvider) {
          items.push(...dbProvider.getAllCommands());
        }
        items.push(...aiCommands);
        return items;
      }
      case "@":
        return dbProvider ? dbProvider.getSchemaObjects() : [];

      case "?":
        return [
          {
            id: "help.shortcuts",
            label: "Keyboard Shortcuts",
            icon: <Terminal className="w-4 h-4" />,
            description: "View all keyboard shortcuts",
            category: "Help",
            action: () => {
              console.log("Show shortcuts");
            },
          },
          {
            id: "help.documentation",
            label: "Documentation",
            icon: <FileText className="w-4 h-4" />,
            description: "Open documentation",
            category: "Help",
            action: () => {
              console.log("Open docs");
            },
          },
        ];

      default:
        return [];
    }
  }, [mode, dbProvider, aiCommands]);

  // Filter and score items
  const filteredItems = useMemo(() => {
    if (!search) {
      // Show recent commands when no search
      const recent = commandItems.filter((item) =>
        recentCommands.includes(item.id),
      );
      const others = commandItems.filter(
        (item) => !recentCommands.includes(item.id),
      );
      return [...recent, ...others];
    }

    const searchLower = search.toLowerCase();
    const scored = commandItems
      .map((item) => {
        // Calculate match score
        let score = 0;

        // Exact match
        if (item.label.toLowerCase() === searchLower) {
          score = 1000;
        }
        // Starts with
        else if (item.label.toLowerCase().startsWith(searchLower)) {
          score = 500;
        }
        // Contains
        else if (item.label.toLowerCase().includes(searchLower)) {
          score = 200;
        }
        // Fuzzy match
        else {
          score = fuzzyMatch(search, item.label);
        }

        // Check keywords
        if (item.keywords?.some((k) => k.includes(searchLower))) {
          score += 100;
        }

        // Check description
        if (item.description?.toLowerCase().includes(searchLower)) {
          score += 50;
        }

        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);

    return scored;
  }, [search, commandItems, recentCommands]);

  // Group items by category
  const groupedItems = useMemo(() => {
    const groups = new Map<string, CommandItem[]>();

    filteredItems.forEach((item) => {
      const category = item.category || "Commands";
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)?.push(item);
    });

    return Array.from(groups.entries());
  }, [filteredItems]);

  // Handle search input
  const handleSearch = useCallback((value: string) => {
    // Check for mode prefix
    const firstChar = value[0] as PaletteMode;
    if (["@", ":", "?", "#", "!", "$"].includes(firstChar)) {
      setMode(firstChar);
      setSearch(value.slice(1));
    } else if (value.startsWith(">")) {
      setMode(">");
      setSearch(value.slice(1).trim());
    } else {
      setSearch(value);
    }
  }, []);

  // Handle command execution
  const handleExecute = useCallback(
    (item: CommandItem) => {
      // Track recent command
      setRecentCommands((prev) => {
        const filtered = prev.filter((id) => id !== item.id);
        return [item.id, ...filtered].slice(0, 10);
      });

      // Execute action
      Promise.resolve(item.action()).then(() => {
        onOpenChange(false);
        setSearch("");
      });
    },
    [onOpenChange],
  );

  // Handle special modes
  const handleSpecialMode = useCallback(() => {
    if (mode === ":" && search) {
      // Go to line
      const lineNumber = parseInt(search, 10);
      if (!isNaN(lineNumber)) {
        console.log("Go to line", lineNumber);
        onOpenChange(false);
      }
    }
  }, [mode, search, onOpenChange]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Enter in special modes
      if (e.key === "Enter" && mode === ":") {
        e.preventDefault();
        handleSpecialMode();
      }

      // Escape to close
      if (e.key === "Escape") {
        if (search || mode !== ">") {
          e.preventDefault();
          setSearch("");
          setMode(">");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, mode, search, handleSpecialMode]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setMode(initialMode);
    }
  }, [open, initialMode]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      showCloseButton={false}
    >
      <CommandInput
        ref={inputRef}
        placeholder={modePlaceholders[mode]}
        value={mode === ">" ? search : `${mode}${search}`}
        onValueChange={handleSearch}
        className="border-0 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
      />
      <CommandList>
        <CommandEmpty>
          {mode === ":" ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">
                Enter a line number to navigate
              </p>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">No results found</p>
              <p className="text-xs text-muted-foreground mt-2">
                Try different keywords or check the spelling
              </p>
            </div>
          )}
        </CommandEmpty>

        {search.length === 0 && recentCommands.length > 0 && (
          <>
            {commandItems
              .filter((item) => recentCommands.includes(item.id))
              .slice(0, 3)
              .map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    handleExecute(item);
                  }}
                  className="flex items-center justify-between px-3 py-1"
                >
                  <div className="flex items-center gap-2">
                    {item.icon && (
                      <span className="text-muted-foreground">{item.icon}</span>
                    )}
                    <span className="text-sm">{item.label}</span>
                  </div>
                  {item.shortcut && (
                    <CommandShortcut className="text-xs opacity-60">
                      {item.shortcut}
                    </CommandShortcut>
                  )}
                </CommandItem>
              ))}
            <div className="h-px bg-border mx-3 my-1" />
          </>
        )}

        {groupedItems.map(([category, items]) => (
          <div key={category}>
            {items.map((item) => (
              <CommandItem
                key={item.id}
                value={item.id}
                onSelect={() => {
                  handleExecute(item);
                }}
                className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-accent/50"
              >
                <div className="flex items-center gap-2 flex-1">
                  {item.icon && (
                    <span className="text-muted-foreground">{item.icon}</span>
                  )}
                  <span className="text-sm">{item.label}</span>
                </div>
                {item.shortcut && (
                  <CommandShortcut className="text-xs opacity-60">
                    {item.shortcut}
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </div>
        ))}
      </CommandList>

      <div className="border-t px-3 py-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex gap-4">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>⎋ Close</span>
          </div>
          <div className="flex gap-2">
            <span>&gt; Commands</span>
            <span>@ Symbols</span>
            <span>: Line</span>
          </div>
        </div>
      </div>
    </CommandDialog>
  );
}
