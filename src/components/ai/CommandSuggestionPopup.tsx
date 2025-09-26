import { useEffect, useMemo, useState } from "react";
import type { AICommandDefinition } from "@/services/opencodeService";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface CommandSuggestionPopupProps {
  isOpen: boolean;
  searchQuery: string;
  position: { top: number; left: number };
  commands: AICommandDefinition[];
  loading?: boolean;
  onSelect: (command: AICommandDefinition) => void;
  onClose?: () => void;
}

export function CommandSuggestionPopup({
  isOpen,
  searchQuery,
  position,
  commands,
  loading = false,
  onSelect,
  onClose,
}: CommandSuggestionPopupProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    if (!commands.length) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter((command) => {
      const name = command.name.toLowerCase();
      const description = (command.description ?? "").toLowerCase();
      return name.includes(query) || description.includes(query);
    });
  }, [commands, searchQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, filteredCommands.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : prev,
          );
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        }
        case "Enter":
        case "Tab": {
          if (filteredCommands[selectedIndex]) {
            event.preventDefault();
            onSelect(filteredCommands[selectedIndex]);
          }
          break;
        }
        case "Escape": {
          event.preventDefault();
          onClose?.();
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, filteredCommands, onSelect, onClose, selectedIndex]);

  if (!isOpen) return null;

  const showEmpty = !loading && filteredCommands.length === 0;

  return (
    <div
      className="absolute z-50 w-72 max-h-64 overflow-hidden rounded-lg border bg-popover shadow-lg"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="max-h-64 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading commands...
          </div>
        ) : null}

        {showEmpty ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No commands found.
          </div>
        ) : null}

        {!loading && filteredCommands.length > 0
          ? filteredCommands.map((command, index) => (
              <button
                type="button"
                key={command.name}
                className={cn(
                  "w-full text-left px-3 py-2 text-xs transition-colors",
                  "flex flex-col gap-0.5",
                  selectedIndex === index ? "bg-accent" : "hover:bg-accent/50",
                )}
                onMouseEnter={() => {
                  setSelectedIndex(index);
                }}
                onClick={() => {
                  onSelect(command);
                }}
              >
                <span className="font-medium">/{command.name}</span>
                {command.description ? (
                  <span className="text-[10px] text-muted-foreground">
                    {command.description}
                  </span>
                ) : null}
              </button>
            ))
          : null}
      </div>
    </div>
  );
}
