import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Table, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export type MentionType = "table" | "view" | "query" | "schema";

export interface MentionItem {
  type: MentionType;
  schema?: string;
  name: string;
  label: string;
  icon?: React.ReactNode;
}

interface MentionAutocompleteProps {
  connectionId: string;
  query: string;
  position: { top: number; left: number };
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
}

export function MentionAutocomplete({
  connectionId,
  query,
  position,
  onSelect,
  onClose,
}: MentionAutocompleteProps) {
  const [items, setItems] = useState<MentionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Load suggestions based on query
  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        // Determine what to search for based on query prefix
        let suggestions: MentionItem[] = [];

        if (query.startsWith("table/") || query === "") {
          // Load tables
          const tables: Array<{ schema: string; name: string }> = await invoke(
            "get_tables",
            {
              connectionId,
            },
          );

          suggestions = tables.map((t) => ({
            type: "table" as const,
            schema: t.schema,
            name: t.name,
            label: `${t.schema}.${t.name}`,
            icon: <Table className="h-4 w-4" />,
          }));
        } else if (query.startsWith("view/")) {
          // Load views
          const views: Array<{ schema: string; name: string }> = await invoke(
            "get_views",
            {
              connectionId,
            },
          );

          suggestions = views.map((v) => ({
            type: "view" as const,
            schema: v.schema,
            name: v.name,
            label: `${v.schema}.${v.name}`,
            icon: <Eye className="h-4 w-4" />,
          }));
        }

        // Filter by query
        const searchTerm = query.split("/").pop()?.toLowerCase() || "";
        const filtered = suggestions.filter((item) =>
          item.label.toLowerCase().includes(searchTerm),
        );

        setItems(filtered.slice(0, 10)); // Limit to 10 results
        setSelectedIndex(0);
      } catch (error) {
        console.error("Failed to load mention suggestions:", error);
        setItems([]);
      }
    };

    void loadSuggestions();
  }, [connectionId, query]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (items[selectedIndex]) {
          onSelect(items[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => { window.removeEventListener("keydown", handleKeyDown); };
  }, [items, selectedIndex, onSelect, onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => { document.removeEventListener("mousedown", handleClickOutside); };
  }, [onClose]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      ref={ref}
      className="absolute z-50 w-80 rounded-md border bg-popover shadow-md"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <Command className="rounded-md border-none">
        <CommandList>
          <CommandGroup>
            {items.map((item, index) => (
              <CommandItem
                key={`${item.type}-${item.label}`}
                onSelect={() => { onSelect(item); }}
                className={cn(
                  "flex items-center gap-2 cursor-pointer",
                  index === selectedIndex && "bg-accent",
                )}
              >
                {item.icon}
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {item.name}
                  </span>
                  {item.schema && (
                    <span className="text-xs text-muted-foreground">
                      {item.schema}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground capitalize">
                  {item.type}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
