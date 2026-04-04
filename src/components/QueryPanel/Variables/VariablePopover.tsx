import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QueryVariable, VariableType } from "@/lib/queryVariables/types";
import type { VariableClickDetail } from "@/components/CodeEditor/extensions/variable-highlight";
import { VariableValueEditor } from "./VariableValueEditor";

interface VariablePopoverProps {
  containerRef: React.RefObject<HTMLElement | null>;
  variables: Record<string, QueryVariable>;
  onValueChange: (key: string, value: string) => void;
  onTypeChange: (key: string, type: VariableType) => void;
}

interface PopoverState {
  key: string;
  name: string;
  rect: DOMRect;
}

export const VariablePopover = memo(function VariablePopover({
  containerRef,
  variables,
  onValueChange,
  onTypeChange,
}: VariablePopoverProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const focusEditor = useCallback(() => {
    requestAnimationFrame(() => {
      const cm = containerRef.current?.querySelector<HTMLElement>(".cm-content");
      cm?.focus();
    });
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: Event) => {
      const detail = (e as CustomEvent<VariableClickDetail>).detail;
      setPopover({ key: detail.key, name: detail.name, rect: detail.rect });
    };

    container.addEventListener("variable-click", handleClick);
    return () => { container.removeEventListener("variable-click", handleClick); };
  }, [containerRef]);

  useEffect(() => {
    if (!popover) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        if (target.closest(".cm-variable-pill")) return;
        setPopover(null);
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopover(null);
        focusEditor();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        setPopover(null);
        focusEditor();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeydown, true);

    const timer = requestAnimationFrame(() => {
      const el = popoverRef.current;
      if (!el) return;
      const input = el.querySelector<HTMLElement>("input:not([type=hidden]), textarea");
      input?.focus();
    });

    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeydown, true);
    };
  }, [popover, focusEditor]);

  const handleValueChange = useCallback(
    (value: string) => {
      if (popover) {
        onValueChange(popover.key, value);
      }
    },
    [popover, onValueChange],
  );

  const handleTypeChange = useCallback(
    (type: VariableType) => {
      if (popover) {
        onTypeChange(popover.key, type);
      }
    },
    [popover, onTypeChange],
  );

  if (!popover) return null;

  const variable = variables[popover.key];
  if (!variable) return null;

  const top = popover.rect.bottom + 4;
  const left = popover.rect.left;

  const isList = variable.type === "list";
  const hint = isList
    ? "Tab / Enter to add \u00b7 \u2318\u23ce to close"
    : "\u2318\u23ce to close \u00b7 Esc to cancel";

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 bg-popover text-popover-foreground rounded-lg shadow-lg ring-1 ring-border/60 w-64 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ top, left }}
    >
      <div className="p-3 pb-2">
        <VariableValueEditor
          name={variable.name}
          value={variable.value}
          type={variable.type}
          onValueChange={handleValueChange}
          onTypeChange={handleTypeChange}
          compact
        />
      </div>
      <div className="px-3 pb-2 pt-0">
        <p className="text-[10px] text-muted-foreground/70">{hint}</p>
      </div>
    </div>,
    document.body,
  );
});
