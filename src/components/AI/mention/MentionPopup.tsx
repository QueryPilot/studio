import { useEffect, useRef } from "react";
import {
  IconBolt,
  IconCode,
  IconEye,
  IconFileText,
  IconTable,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type { MentionItem, SuggestionGroup } from "@/hooks/useMentionSuggestions";

// =============================================================================
// Icons by mention type
// =============================================================================

const ICON_SIZE = 14;

const TYPE_ICON: Record<MentionItem["mentionType"], React.ReactNode> = {
  table: <IconTable size={ICON_SIZE} className="text-blue-400" />,
  view: <IconEye size={ICON_SIZE} className="text-purple-400" />,
  function: <IconCode size={ICON_SIZE} className="text-green-400" />,
  tab: <IconFileText size={ICON_SIZE} className="text-orange-400" />,
  connection: <IconBolt size={ICON_SIZE} className="text-yellow-400" />,
};

// =============================================================================
// Key generation
// =============================================================================

function itemKey(item: MentionItem): string {
  return `${item.mentionType}:${item.connectionId ?? ""}:${item.schema ?? ""}:${item.name}`;
}

// =============================================================================
// Props
// =============================================================================

interface MentionPopupProps {
  groups: SuggestionGroup[];
  selectedItem: MentionItem | null;
  onSelect: (item: MentionItem) => void;
  onHover: (item: MentionItem) => void;
}

// =============================================================================
// Component
// =============================================================================

export function MentionPopup({
  groups,
  selectedItem,
  onSelect,
  onHover,
}: MentionPopupProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // Auto-scroll to selected item
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedItem]);

  if (groups.length === 0) return null;

  const selectedKey = selectedItem ? itemKey(selectedItem) : null;

  return (
    <div className="absolute bottom-full left-0 mb-2 w-80 max-h-72 overflow-y-auto rounded-xl border-2 border-border bg-popover shadow-lg z-50">
      {groups.map((group) => (
        <div key={group.label}>
          {/* Group header */}
          {group.connectionItem ? (
            <GroupHeaderButton
              group={group}
              isSelected={itemKey(group.connectionItem) === selectedKey}
              selectedRef={
                itemKey(group.connectionItem) === selectedKey
                  ? selectedRef
                  : undefined
              }
              onSelect={onSelect}
              onHover={onHover}
            />
          ) : (
            <div className="sticky top-0 bg-popover/95 backdrop-blur-sm px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50">
              {group.label}
            </div>
          )}

          {/* Items */}
          {group.items.map((item) => {
            const key = itemKey(item);
            const isSelected = key === selectedKey;
            return (
              <button
                key={key}
                ref={isSelected ? selectedRef : undefined}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-left",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                onClick={() => { onSelect(item); }}
                onMouseEnter={() => { onHover(item); }}
              >
                {TYPE_ICON[item.mentionType]}
                <span className="truncate">{item.displayLabel}</span>
              </button>
            );
          })}

          {/* Overflow hint */}
          {group.overflowHint && (
            <div className="px-3 py-1 text-[10px] text-muted-foreground/60 italic">
              {group.overflowHint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Group header as selectable button
// =============================================================================

function GroupHeaderButton({
  group,
  isSelected,
  selectedRef,
  onSelect,
  onHover,
}: {
  group: SuggestionGroup;
  isSelected: boolean;
  selectedRef?: React.Ref<HTMLButtonElement>;
  onSelect: (item: MentionItem) => void;
  onHover: (item: MentionItem) => void;
}) {
  // connectionItem is guaranteed by caller — only rendered when group.connectionItem exists
  const connItem = group.connectionItem as MentionItem;
  return (
    <button
      ref={selectedRef}
      type="button"
      className={cn(
        "sticky top-0 flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold border-b border-border/50",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "bg-popover/95 backdrop-blur-sm text-muted-foreground hover:bg-accent/50",
      )}
      onClick={() => { onSelect(connItem); }}
      onMouseEnter={() => { onHover(connItem); }}
    >
      {TYPE_ICON.connection}
      <span className="uppercase tracking-wider">{group.label}</span>
      {group.subtitle && (
        <span className="ml-auto font-normal normal-case tracking-normal text-muted-foreground/50 truncate">
          {group.subtitle}
        </span>
      )}
    </button>
  );
}
