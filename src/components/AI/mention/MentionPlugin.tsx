import { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";

import type { AIContext } from "@/types/aiContext";
import type { MentionItem } from "@/hooks/useMentionSuggestions";
import { useMentionSuggestions } from "@/hooks/useMentionSuggestions";

import { $createMentionNode } from "./MentionNode";
import { MentionPopup } from "./MentionPopup";

// =============================================================================
// Trigger detection
// =============================================================================

interface TriggerMatch {
  filter: string;
  matchStart: number;
}

/**
 * Scan backwards from cursor to find an `@` trigger.
 * Returns null if no valid trigger found.
 */
function findMentionTrigger(
  text: string,
  cursorOffset: number,
): TriggerMatch | null {
  let i = cursorOffset - 1;
  let inQuote = false;

  while (i >= 0) {
    const ch = text[i];

    if (ch === "\n") return null;

    if (ch === '"') {
      inQuote = !inQuote;
      i--;
      continue;
    }

    // Space is allowed inside quotes (for quoted connection names)
    if (ch === " " && !inQuote) return null;

    if (ch === "@") {
      // Reject if preceded by a word character (email address)
      const prev = text[i - 1];
      if (i > 0 && prev !== undefined && /\w/.test(prev)) return null;

      return {
        filter: text.slice(i + 1, cursorOffset),
        matchStart: i,
      };
    }

    i--;
  }

  return null;
}

// =============================================================================
// Props
// =============================================================================

interface MentionPluginProps {
  aiContext: AIContext;
  openTabs: Array<{ id: string; name: string; type: string; panelId: string }>;
  focusedConnectionId?: string;
}

// =============================================================================
// Plugin
// =============================================================================

export function MentionPlugin({
  aiContext,
  openTabs,
  focusedConnectionId,
}: MentionPluginProps) {
  const [editor] = useLexicalComposerContext();

  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [matchStart, setMatchStart] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { groups, flatItems } = useMentionSuggestions(
    aiContext,
    openTabs,
    filter,
    focusedConnectionId,
  );

  // Close menu if no items and filter is long (derive during render)
  const effectiveMenuOpen =
    menuOpen && !(flatItems.length === 0 && filter.length > 2);

  // ---------------------------------------------------------------------------
  // Trigger detection via editor update listener
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          setMenuOpen(false);
          return;
        }

        const anchor = selection.anchor;
        if (anchor.type !== "text") {
          setMenuOpen(false);
          return;
        }

        const anchorNode = anchor.getNode();
        if (!$isTextNode(anchorNode)) {
          setMenuOpen(false);
          return;
        }

        const text = anchorNode.getTextContent();
        const cursorOffset = anchor.offset;
        const trigger = findMentionTrigger(text, cursorOffset);

        if (trigger) {
          setMenuOpen(true);
          setFilter((prev) => {
            if (prev !== trigger.filter) {
              setSelectedIndex(0);
            }
            return trigger.filter;
          });
          setMatchStart(trigger.matchStart);
        } else {
          setMenuOpen(false);
        }
      });
    });
  }, [editor]);

  // ---------------------------------------------------------------------------
  // Mention insertion
  // ---------------------------------------------------------------------------

  const insertMention = useCallback(
    (item: MentionItem) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();
        if (!$isTextNode(anchorNode)) return;

        const text = anchorNode.getTextContent();
        const cursorOffset = anchor.offset;

        const beforeText = text.slice(0, matchStart);
        const afterText = text.slice(cursorOffset);

        const mentionNode = $createMentionNode({
          mentionType: item.mentionType,
          name: item.name,
          displayLabel: item.displayLabel,
          connectionId: item.connectionId,
          connectionName: item.connectionName,
          database: item.database,
          schema: item.schema,
        });

        const spaceNode = $createTextNode(" ");

        if (beforeText) {
          // Split: set current node to before text, then insert mention + space + after
          anchorNode.setTextContent(beforeText);
          const afterNode = afterText ? $createTextNode(afterText) : null;

          anchorNode.insertAfter(mentionNode);
          mentionNode.insertAfter(spaceNode);
          if (afterNode) {
            spaceNode.insertAfter(afterNode);
          }
        } else {
          // No text before @ — replace current node
          const afterNode = afterText ? $createTextNode(afterText) : null;

          anchorNode.replace(mentionNode);
          mentionNode.insertAfter(spaceNode);
          if (afterNode) {
            spaceNode.insertAfter(afterNode);
          }
        }

        // Move cursor after the space
        spaceNode.select(1, 1);
      });

      setMenuOpen(false);
    },
    [editor, matchStart],
  );

  // ---------------------------------------------------------------------------
  // Keyboard navigation (only when menu is open)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!effectiveMenuOpen || flatItems.length === 0) return;

    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          event?.preventDefault();
          const item = flatItems[selectedIndex];
          if (item) insertMention(item);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          event.preventDefault();
          const item = flatItems[selectedIndex];
          if (item) insertMention(item);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          setMenuOpen(false);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, effectiveMenuOpen, flatItems, selectedIndex, insertMention]);

  // ---------------------------------------------------------------------------
  // Hover handler — update selected index
  // ---------------------------------------------------------------------------

  const handleHover = useCallback(
    (item: MentionItem) => {
      const idx = flatItems.indexOf(item);
      if (idx >= 0) setSelectedIndex(idx);
    },
    [flatItems],
  );

  // ---------------------------------------------------------------------------
  // Selected item
  // ---------------------------------------------------------------------------

  const selectedItem = useMemo(
    () => flatItems[selectedIndex] ?? null,
    [flatItems, selectedIndex],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!effectiveMenuOpen || flatItems.length === 0) return null;

  return (
    <MentionPopup
      groups={groups}
      selectedItem={selectedItem}
      onSelect={insertMention}
      onHover={handleHover}
    />
  );
}
