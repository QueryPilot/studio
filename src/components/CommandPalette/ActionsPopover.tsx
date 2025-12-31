import React, { useEffect, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { ActionItem } from "./actions";

interface ActionsPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: ActionItem[];
  onActionSelect: (actionId: string) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}

export function ActionsPopover({
  open,
  onOpenChange,
  actions,
  onActionSelect,
  children,
}: ActionsPopoverProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset selection when popover opens
  useEffect(() => {
    if (open) {
      // Reset to first item - this intentional cascading render only happens on open
      setSelectedIndex(0); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [open]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => (prev + 1) % actions.length);
          break;

        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) =>
            prev === 0 ? actions.length - 1 : prev - 1
          );
          break;

        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (actions[selectedIndex]) {
            onActionSelect(actions[selectedIndex].id);
            onOpenChange(false);
          }
          break;

        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onOpenChange(false);
          break;

        default: {
          // Check for shortcut keys
          const key = e.key.toUpperCase();
          const shiftKey = e.shiftKey;

          const matchingAction = actions.find((action) => {
            if (!action.shortcut) return false;
            const shortcut = action.shortcut.toUpperCase();

            if (shortcut.startsWith("SHIFT+")) {
              return shiftKey && shortcut === `SHIFT+${key}`;
            }
            return !shiftKey && shortcut === key;
          });

          if (matchingAction) {
            e.preventDefault();
            e.stopPropagation();
            onActionSelect(matchingAction.id);
            onOpenChange(false);
          }
          break;
        }
      }
    };

    // Use capture phase to intercept before Command component
    document.addEventListener("keydown", handleKeyDown, true);
    return () => { document.removeEventListener("keydown", handleKeyDown, true); };
  }, [open, actions, selectedIndex, onActionSelect, onOpenChange]);

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selectedElement = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, open]);

  if (actions.length === 0) {
    return <>{children}</>;
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<span />}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-56 p-1 outline-none"
      >
        <div ref={listRef} className="flex flex-col">
          {actions.map((action, index) => (
            <ActionRow
              key={action.id}
              action={action}
              index={index}
              isSelected={index === selectedIndex}
              onSelect={() => {
                onActionSelect(action.id);
                onOpenChange(false);
              }}
              onHover={() => { setSelectedIndex(index); }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ActionRowProps {
  action: ActionItem;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}

function ActionRow({
  action,
  index,
  isSelected,
  onSelect,
  onHover,
}: ActionRowProps): React.ReactElement {
  return (
    <button
      type="button"
      data-index={index}
      className={cn(
        "flex items-center justify-between w-full px-2 py-1.5 rounded-md text-xs text-left outline-none",
        "hover:bg-muted cursor-default",
        isSelected && "bg-muted",
        action.disabled && "opacity-50 pointer-events-none",
        action.destructive && "text-destructive"
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
      disabled={action.disabled}
    >
      <span>{action.label}</span>
      {action.shortcut && (
        <Kbd className="text-[9px] h-4 min-w-4">{action.shortcut}</Kbd>
      )}
    </button>
  );
}
