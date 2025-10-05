import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ChordIndicator - Shows visual feedback when waiting for chord completion
 *
 * Displays a small indicator in the bottom-right corner when a chord prefix
 * is pressed (e.g., "cmd+k"), showing the user that the system is waiting
 * for the next key.
 */
export function ChordIndicator() {
  const [prefix, setPrefix] = useState<string | null>(null);

  useEffect(() => {
    const handleChordStart = (e: Event) => {
      const event = e as CustomEvent<{ prefix: string }>;
      setPrefix(event.detail.prefix);
    };

    const handleChordClear = () => {
      setPrefix(null);
    };

    // Listen for chord events from KeyboardManager
    window.addEventListener("keyboard:chord-started", handleChordStart);
    window.addEventListener("keyboard:chord-cleared", handleChordClear);

    return () => {
      window.removeEventListener("keyboard:chord-started", handleChordStart);
      window.removeEventListener("keyboard:chord-cleared", handleChordClear);
    };
  }, []);

  // Don't render if no active chord
  if (!prefix) return null;

  // Format the prefix for display (e.g., "cmd+k" -> "⌘K" on Mac)
  const displayPrefix = formatKeyForDisplay(prefix);

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50",
        "bg-accent/95 text-accent-foreground border border-border",
        "px-3 py-2 rounded-md shadow-lg backdrop-blur-sm",
        "animate-in fade-in slide-in-from-bottom-2 duration-150",
      )}
      role="status"
      aria-live="polite"
      aria-label={`Chord prefix ${displayPrefix} pressed, waiting for next key`}
    >
      <div className="flex items-center gap-2">
        <Keyboard className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-mono font-semibold">
          {displayPrefix}
        </span>
        <span className="text-xs text-muted-foreground animate-pulse">
          waiting...
        </span>
      </div>
    </div>
  );
}

/**
 * Format a key combination for display
 * Converts platform-specific keys to symbols
 */
function formatKeyForDisplay(key: string): string {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("mac");

  let formatted = key;

  if (isMac) {
    // Mac symbols
    formatted = formatted
      .replace(/cmd\+/g, "⌘")
      .replace(/shift\+/g, "⇧")
      .replace(/alt\+/g, "⌥")
      .replace(/ctrl\+/g, "⌃");
  } else {
    // Windows/Linux
    formatted = formatted
      .replace(/cmd\+/g, "Ctrl+")
      .replace(/shift\+/g, "Shift+")
      .replace(/alt\+/g, "Alt+")
      .replace(/ctrl\+/g, "Ctrl+");
  }

  // Capitalize letters
  formatted = formatted
    .split("+")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(isMac ? "" : "+");

  return formatted;
}
