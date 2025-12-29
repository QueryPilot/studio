import { useRef, useEffect } from "react";
import { IconSearch } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { Input } from "@/components/ui/input";

export function SidebarSearch() {
  const searchQuery = useHomeScreenStore((s) => s.searchQuery);
  const setSearchQuery = useHomeScreenStore((s) => s.setSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global "/" shortcut to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInInput =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA";

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !isInInput) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      inputRef.current?.blur();
    } else if (e.key === "Tab" && !e.shiftKey) {
      // Tab from search jumps to first connection item
      const firstItem = document.querySelector(
        "[data-connection-item]",
      ) as HTMLElement;
      if (firstItem) {
        e.preventDefault();
        firstItem.focus();
      }
    } else if (e.key === "ArrowDown") {
      // Arrow down also focuses first item
      const firstItem = document.querySelector(
        "[data-connection-item]",
      ) as HTMLElement;
      if (firstItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
  };

  return (
    <div className="px-3 py-2">
      <div
        className={cn(
          "relative",
          // "flex items-center gap-2 px-3 py-2 rounded-lg",
          // "bg-sidebar-accent/50 border border-transparent",
          // "transition-all duration-150",
          // "focus-within:border-primary/50 focus-within:bg-background/50",
          // "focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-2",
        )}
      >
        <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground shrink-0" />
        {!searchQuery && (
          <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">/</Kbd>
        )}
        <Input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          className={cn(
            "px-8 h-8 text-xs",
            "flex-1 bg-transparent text-sm outline-none",
            "placeholder:text-muted-foreground",
          )}
        />
      </div>
    </div>
  );
}
