/**
 * Editor Context Menu
 *
 * A proper context menu for the SQL editor that wraps the editor
 * and shows contextual actions based on what's under the cursor.
 */

import { useState, useCallback, type ReactNode, type MutableRefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  IconCopy,
  IconCut,
  IconClipboard,
  IconArrowRight,
  IconEdit,
  IconCode,
  IconBinaryTree,
} from "@tabler/icons-react";
import type { EditorView } from "@codemirror/view";

export interface EditorContextTarget {
  type: "alias" | "table" | "column" | "cte" | "selection" | "empty";
  name?: string;
  sourceTable?: string;
  sourceSchema?: string;
  definitionPos?: { from: number; to: number };
  tableName?: string;
  selectionSpan?: { start: number; end: number };
}

export interface EditorContextMenuProps {
  children: ReactNode;
  editorRef: MutableRefObject<EditorView | null>;
  dialect: string;
  onGotoDefinition?: (pos: { from: number; to: number }) => void;
  onGotoTableStructure?: (table: string, schema?: string) => void;
  onRename?: () => void;
  onExtractCte?: (span: { start: number; end: number }) => void;
}

/**
 * Analyze what's under the cursor when context menu opens
 */
function analyzeContextTarget(view: EditorView): EditorContextTarget {
  const { state } = view;
  const selection = state.selection.main;
  
  // If there's a selection, offer selection-based actions
  if (selection.from !== selection.to) {
    const selectedText = state.doc.sliceString(selection.from, selection.to);
    // Check if selection looks like a subquery
    const isSubquery = selectedText.trim().toLowerCase().startsWith("select");
    return {
      type: "selection",
      name: selectedText.length > 30 ? selectedText.slice(0, 30) + "..." : selectedText,
      selectionSpan: { start: selection.from, end: selection.to },
    };
  }
  
  // Get word at cursor
  const pos = selection.head;
  const line = state.doc.lineAt(pos);
  const lineText = line.text;
  const lineOffset = pos - line.from;
  
  // Find word boundaries
  let start = lineOffset;
  let end = lineOffset;
  
  while (start > 0 && /\w/.test(lineText[start - 1])) start--;
  while (end < lineText.length && /\w/.test(lineText[end])) end++;
  
  if (start === end) {
    return { type: "empty" };
  }
  
  const word = lineText.slice(start, end);
  
  // Simple heuristics to detect what type of identifier this is
  // Look for patterns like "FROM word" or "JOIN word" for tables
  const beforeWord = lineText.slice(0, start).toLowerCase().trim();
  const tableKeywords = ["from", "join", "into", "update", "table"];
  
  if (tableKeywords.some(kw => beforeWord.endsWith(kw))) {
    return { type: "table", name: word };
  }
  
  // Look for "word." pattern (likely an alias)
  const afterWord = lineText.slice(end);
  if (afterWord.startsWith(".")) {
    return { type: "alias", name: word };
  }
  
  // Look for ".word" pattern (likely a column)
  if (start > 0 && lineText[start - 1] === ".") {
    // Find the table/alias before the dot
    let aliasStart = start - 2;
    while (aliasStart > 0 && /\w/.test(lineText[aliasStart])) aliasStart--;
    if (aliasStart < start - 2) {
      const alias = lineText.slice(aliasStart + 1, start - 1);
      return { type: "column", name: word, tableName: alias };
    }
    return { type: "column", name: word };
  }
  
  // Check if it might be a CTE (after WITH keyword)
  const fullTextBefore = state.doc.sliceString(0, line.from + start).toLowerCase();
  if (fullTextBefore.includes("with ") && !fullTextBefore.includes("select")) {
    return { type: "cte", name: word };
  }
  
  // Default: treat as potential alias or identifier
  return { type: "alias", name: word };
}

export function EditorContextMenu({
  children,
  editorRef,
  dialect,
  onGotoDefinition,
  onGotoTableStructure,
  onRename,
  onExtractCte,
}: EditorContextMenuProps) {
  const [target, setTarget] = useState<EditorContextTarget>({ type: "empty" });

  const handleOpenChange = useCallback((open: boolean) => {
    if (open && editorRef.current) {
      const newTarget = analyzeContextTarget(editorRef.current);
      setTarget(newTarget);
    }
  }, [editorRef]);

  const handleCopy = useCallback(() => {
    if (editorRef.current) {
      const selection = editorRef.current.state.selection.main;
      const text = editorRef.current.state.doc.sliceString(selection.from, selection.to);
      if (text) {
        navigator.clipboard.writeText(text);
      }
    }
  }, [editorRef]);

  const handleCut = useCallback(() => {
    if (editorRef.current) {
      const selection = editorRef.current.state.selection.main;
      const text = editorRef.current.state.doc.sliceString(selection.from, selection.to);
      if (text) {
        navigator.clipboard.writeText(text);
        editorRef.current.dispatch({
          changes: { from: selection.from, to: selection.to, insert: "" },
        });
      }
    }
  }, [editorRef]);

  const handlePaste = useCallback(async () => {
    if (editorRef.current) {
      const text = await navigator.clipboard.readText();
      if (text) {
        const selection = editorRef.current.state.selection.main;
        editorRef.current.dispatch({
          changes: { from: selection.from, to: selection.to, insert: text },
        });
      }
    }
  }, [editorRef]);

  const handleSelectAll = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.dispatch({
        selection: { anchor: 0, head: editorRef.current.state.doc.length },
      });
    }
  }, [editorRef]);

  const handleCopyName = useCallback(() => {
    if (target.name) {
      navigator.clipboard.writeText(target.name);
    }
  }, [target]);

  const handleRename = useCallback(() => {
    onRename?.();
  }, [onRename]);

  const handleExtractCte = useCallback(() => {
    if (target.selectionSpan) {
      onExtractCte?.(target.selectionSpan);
    }
  }, [target, onExtractCte]);

  const handleGotoTable = useCallback(() => {
    if (target.name && onGotoTableStructure) {
      onGotoTableStructure(target.name, target.sourceSchema);
    }
  }, [target, onGotoTableStructure]);

  const getTargetLabel = () => {
    switch (target.type) {
      case "alias":
        return `Alias: ${target.name}`;
      case "table":
        return `Table: ${target.name}`;
      case "column":
        return `Column: ${target.tableName ? `${target.tableName}.` : ""}${target.name}`;
      case "cte":
        return `CTE: ${target.name}`;
      case "selection":
        return `Selection`;
      default:
        return null;
    }
  };

  const targetLabel = getTargetLabel();
  const hasSelection = target.type === "selection";
  const isRenameable = target.type === "alias" || target.type === "cte";
  const isTable = target.type === "table";

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* Context-specific header */}
        {targetLabel && (
          <ContextMenuGroup>
            <ContextMenuLabel className="text-xs font-medium">
              {targetLabel}
            </ContextMenuLabel>
            <ContextMenuSeparator />
          </ContextMenuGroup>
        )}

        {/* Refactoring actions */}
        {(isRenameable || hasSelection) && (
          <ContextMenuGroup>
            {isRenameable && (
              <ContextMenuItem onClick={handleRename}>
                <IconEdit className="mr-2 h-4 w-4" />
                Rename "{target.name}"
                <ContextMenuShortcut>F2</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {hasSelection && target.selectionSpan && (
              <ContextMenuItem onClick={handleExtractCte}>
                <IconBinaryTree className="mr-2 h-4 w-4" />
                Extract to CTE
                <ContextMenuShortcut>⇧⌘E</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </ContextMenuGroup>
        )}

        {/* Navigation actions */}
        {isTable && onGotoTableStructure && (
          <ContextMenuGroup>
            <ContextMenuItem onClick={handleGotoTable}>
              <IconArrowRight className="mr-2 h-4 w-4" />
              Go to Table Structure
            </ContextMenuItem>
            <ContextMenuSeparator />
          </ContextMenuGroup>
        )}

        {/* Copy name */}
        {target.name && (
          <ContextMenuGroup>
            <ContextMenuItem onClick={handleCopyName}>
              <IconCode className="mr-2 h-4 w-4" />
              Copy "{target.name}"
            </ContextMenuItem>
            <ContextMenuSeparator />
          </ContextMenuGroup>
        )}

        {/* Standard edit actions */}
        <ContextMenuGroup>
          <ContextMenuItem onClick={handleCut}>
            <IconCut className="mr-2 h-4 w-4" />
            Cut
            <ContextMenuShortcut>⌘X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCopy}>
            <IconCopy className="mr-2 h-4 w-4" />
            Copy
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={handlePaste}>
            <IconClipboard className="mr-2 h-4 w-4" />
            Paste
            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleSelectAll}>
            Select All
            <ContextMenuShortcut>⌘A</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
