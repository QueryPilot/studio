# CRUD Indexes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable full inline CRUD operations for indexes in TableIndexes component with staging/commit workflow.

**Architecture:** Extend existing TableIndexes component with editable cell renderers following TableStructure patterns. Add command selector for columns, dropdown for index types, and CodeMirror popover for conditions. Integrate with crudStore for staging commands.

**Tech Stack:** React 19, Glide Data Grid, CodeMirror 6, Zustand, Tailwind CSS, shadcn/ui

---

## Task 1: Update Types for Editable Index Grid

**Files:**
- Modify: `src/components/TableIndexes/types.ts`

**Step 1: Add new cell type interfaces**

```typescript
// Add after existing IndexNameCustomCell interface

// Editable index name cell (for rename)
export interface EditableIndexNameCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "editable-index-name-cell";
    name: string;
    isPrimary: boolean;
    isUnique: boolean;
    isLocked: boolean; // true for PK indexes
  };
  copyData: string;
  readonly?: boolean;
}

// Index columns cell with tag display
export interface IndexColumnsCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-columns-cell";
    columns: string[];
    availableColumns: string[];
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}

// Index type dropdown cell
export interface IndexTypeCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-type-cell";
    value: string;
    options: string[];
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}

// Unique toggle cell (YES/NO)
export interface IndexUniqueCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-unique-cell";
    value: "YES" | "NO";
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}

// Condition cell with SQL editor
export interface IndexConditionCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-condition-cell";
    value: string;
    requiresRecreate: boolean;
    isLocked: boolean;
    dialect: string;
  };
  copyData: string;
  readonly?: boolean;
}
```

**Step 2: Update IndexGridRow interface**

```typescript
// Update IndexGridRow to add new fields
export interface IndexGridRow {
  [key: string]: unknown;
  row_number: number;
  name: string;
  name_meta: {
    primary: boolean;
    unique: boolean;
  };
  columns: string; // Display string
  columns_array: string[]; // Actual array for editing
  index_type: string;
  unique: string;
  statistics: string;
  stats?: IndexUsageStats;
  condition: string; // Renamed from 'condition'
  _original?: TableIndex;
  _tempId?: string;
  _isPending?: boolean;
  _isPendingDelete?: boolean;
  _isModified?: boolean;
  _requiresRecreate?: boolean; // True when non-name fields changed
}
```

**Step 3: Commit**

```bash
git add src/components/TableIndexes/types.ts
git commit -m "feat(indexes): add cell type interfaces for editable index grid"
```

---

## Task 2: Create IndexNameCellEditor Component

**Files:**
- Modify: `src/components/TableIndexes/IndexNameCellRenderer.tsx`
- Create: `src/components/TableIndexes/IndexNameCellEditor.tsx`

**Step 1: Create the editor component**

Create `src/components/TableIndexes/IndexNameCellEditor.tsx`:

```typescript
import React, { useRef, useCallback, useEffect } from "react";
import { type EditableIndexNameCell } from "./types";
import { IconKey, IconLock } from "@tabler/icons-react";
import { useCommitOnUnmount } from "@/components/DataGrid/renderers/hooks/useCommitOnUnmount";

interface IndexNameCellEditorProps {
  value: EditableIndexNameCell;
  onFinishedEditing: (
    newValue?: EditableIndexNameCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const IndexNameCellEditor: React.FC<IndexNameCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentValueRef = useRef(value.data.name);

  useEffect(() => {
    const timer = setTimeout(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(0, input.value.length);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const commit = useCallback(
    (nextValue: string) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const trimmedValue = nextValue.trim();

      if (trimmedValue === value.data.name || trimmedValue === "") {
        onFinishedEditing(undefined);
        return;
      }

      const newCell: EditableIndexNameCell = {
        kind: value.kind,
        data: { ...value.data, name: trimmedValue },
        copyData: trimmedValue,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (finishedRef.current) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      onFinishedEditing(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit(inputRef.current?.value ?? "");
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      const text = inputRef.current?.value ?? "";
      const trimmed = text.trim();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey ? [-1, 0] : [1, 0];

      if (trimmed === value.data.name || trimmed === "") {
        onFinishedEditing(undefined, movement);
        return;
      }

      const newCell: EditableIndexNameCell = {
        kind: value.kind,
        data: { ...value.data, name: trimmed },
        copyData: trimmed,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };
      onFinishedEditing(newCell, movement);
    }
  };

  const commitCurrent = useCallback(() => {
    commit(currentValueRef.current);
  }, [commit]);

  useCommitOnUnmount(finishedRef, commitCurrent);

  const { isPrimary, isUnique } = value.data;

  return (
    <div className="flex flex-col click-outside-ignore z-50 bg-popover border shadow-lg min-w-[200px] max-w-[400px] w-max">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
        {isPrimary && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
        )}
        {isUnique && !isPrimary && (
          <span className="text-[10px] font-medium text-emerald-600">UNIQUE</span>
        )}
        <span className="text-[10px] font-medium text-foreground/80">Index Name</span>
      </div>
      <div className="flex items-center flex-1">
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          ref={inputRef}
          type="text"
          defaultValue={value.data.name}
          autoFocus
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            currentValueRef.current = e.target.value;
          }}
          className="w-full h-full bg-transparent py-1.5 px-2 text-xs outline-none font-mono"
          placeholder="index_name"
        />
      </div>
    </div>
  );
};

export const IndexNameCellEditorWithProps = Object.assign(IndexNameCellEditor, {
  disablePadding: true,
  disableStyling: false,
});

export default IndexNameCellEditorWithProps;
```

**Step 2: Update renderer to support editing**

Update `src/components/TableIndexes/IndexNameCellRenderer.tsx`:

```typescript
import {
  type CustomCell,
  type CustomRenderer,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import { type EditableIndexNameCell } from "./types";
import { IndexNameCellEditorWithProps } from "./IndexNameCellEditor";

const IndexNameCellRenderer: CustomRenderer<EditableIndexNameCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is EditableIndexNameCell => {
    return (
      typeof cell.data === "object" &&
      "kind" in cell.data &&
      (cell.data.kind === "index-name-cell" || cell.data.kind === "editable-index-name-cell")
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { name, isPrimary, isLocked } = cell.data;

    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `500 12px ${fontFamily}`;

    const padding = 8;
    const centerY = rect.y + rect.height / 2;

    // Draw lock icon for PK indexes
    let textStartX = rect.x + padding;
    if (isLocked) {
      ctx.save();
      ctx.fillStyle = theme.textMedium;
      ctx.font = "10px";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("🔒", textStartX, centerY);
      ctx.restore();
      textStartX += 16;
    }

    // Draw index name
    ctx.fillStyle = isLocked ? theme.textMedium : theme.textDark;
    ctx.font = baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(name, textStartX, centerY);

    // Draw key emoji for primary key (right-aligned)
    if (isPrimary) {
      ctx.save();
      const scale = 0.75;
      ctx.font = "12px";
      ctx.textAlign = "right";
      const emojiX = rect.x + rect.width - padding;
      ctx.translate(emojiX, centerY);
      ctx.scale(scale, scale);
      ctx.translate(-emojiX, -centerY);
      ctx.fillText("🔑", emojiX, centerY);
      ctx.restore();
    }

    return true;
  },

  provideEditor: (cell) => {
    // No editor for locked (PK) indexes
    if (cell.data.isLocked) {
      return undefined;
    }
    return {
      editor: IndexNameCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default IndexNameCellRenderer;
```

**Step 3: Commit**

```bash
git add src/components/TableIndexes/IndexNameCellEditor.tsx src/components/TableIndexes/IndexNameCellRenderer.tsx
git commit -m "feat(indexes): add editable index name cell with PK lock support"
```

---

## Task 3: Create IndexUniqueCell Renderer and Editor

**Files:**
- Create: `src/components/TableIndexes/IndexUniqueCellRenderer/index.ts`
- Create: `src/components/TableIndexes/IndexUniqueCellRenderer/IndexUniqueCellRenderer.tsx`
- Create: `src/components/TableIndexes/IndexUniqueCellRenderer/IndexUniqueCellEditor.tsx`
- Create: `src/components/TableIndexes/IndexUniqueCellRenderer/types.ts`

**Step 1: Create types file**

Create `src/components/TableIndexes/IndexUniqueCellRenderer/types.ts`:

```typescript
import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface IndexUniqueCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-unique-cell";
    value: "YES" | "NO";
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}
```

**Step 2: Create renderer**

Create `src/components/TableIndexes/IndexUniqueCellRenderer/IndexUniqueCellRenderer.tsx`:

```typescript
import type { CustomCell, CustomRenderer } from "@glideapps/glide-data-grid";
import type { IndexUniqueCell } from "./types";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { IndexUniqueCellEditor } from "./IndexUniqueCellEditor";

export const IndexUniqueCellRenderer: CustomRenderer<IndexUniqueCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is IndexUniqueCell => {
    return (cell.data as Record<string, unknown>).kind === "index-unique-cell";
  },
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isLocked } = cell.data;

    const text = value;
    const isYes = value === "YES";

    ctx.save();

    if (isLocked) {
      ctx.fillStyle = theme.textMedium;
    } else {
      ctx.fillStyle = isYes ? "#22c55e" : "#ef4444";
    }

    ctx.font = `600 ${theme.baseFontStyle.split(" ").slice(1).join(" ")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();

    return true;
  },
  provideEditor: (cell) => {
    if (cell.data.isLocked) {
      return undefined;
    }
    return {
      editor: IndexUniqueCellEditor,
      disablePadding: true,
      disableStyling: false,
    };
  },
};
```

**Step 3: Create editor with recreate confirmation**

Create `src/components/TableIndexes/IndexUniqueCellRenderer/IndexUniqueCellEditor.tsx`:

```typescript
import React, { useState, useCallback, useRef, useEffect } from "react";
import type { IndexUniqueCell } from "./types";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle } from "@tabler/icons-react";

interface IndexUniqueCellEditorProps {
  value: IndexUniqueCell;
  onFinishedEditing: (
    newValue?: IndexUniqueCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const IndexUniqueCellEditor: React.FC<IndexUniqueCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const [showConfirm, setShowConfirm] = useState(value.data.requiresRecreate);
  const [confirmed, setConfirmed] = useState(false);
  const finishedRef = useRef(false);

  const handleConfirm = useCallback(() => {
    setConfirmed(true);
    setShowConfirm(false);
  }, []);

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const handleSelect = useCallback(
    (newValue: "YES" | "NO") => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      if (newValue === value.data.value) {
        onFinishedEditing(undefined);
        return;
      }

      const newCell: IndexUniqueCell = {
        ...value,
        data: { ...value.data, value: newValue },
        copyData: newValue,
      };
      onFinishedEditing(newCell);
    },
    [value, onFinishedEditing],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCancel]);

  if (showConfirm && !confirmed) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-popover border shadow-lg rounded-md min-w-[240px]">
        <div className="flex items-center gap-2 text-amber-600">
          <IconAlertTriangle className="h-4 w-4" />
          <span className="text-xs font-medium">Recreate Required</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing uniqueness will drop and recreate this index.
        </p>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-popover border shadow-lg rounded-md overflow-hidden min-w-[100px]">
      <button
        type="button"
        className={`px-3 py-2 text-xs text-left hover:bg-muted/50 ${
          value.data.value === "YES" ? "bg-muted/30 font-medium text-emerald-600" : ""
        }`}
        onClick={() => handleSelect("YES")}
      >
        YES
      </button>
      <button
        type="button"
        className={`px-3 py-2 text-xs text-left hover:bg-muted/50 ${
          value.data.value === "NO" ? "bg-muted/30 font-medium text-red-600" : ""
        }`}
        onClick={() => handleSelect("NO")}
      >
        NO
      </button>
    </div>
  );
};

export default IndexUniqueCellEditor;
```

**Step 4: Create index file**

Create `src/components/TableIndexes/IndexUniqueCellRenderer/index.ts`:

```typescript
export { IndexUniqueCellRenderer } from "./IndexUniqueCellRenderer";
export { IndexUniqueCellEditor } from "./IndexUniqueCellEditor";
export type { IndexUniqueCell } from "./types";
```

**Step 5: Commit**

```bash
git add src/components/TableIndexes/IndexUniqueCellRenderer/
git commit -m "feat(indexes): add unique toggle cell with recreate confirmation"
```

---

## Task 4: Create IndexTypeCell Renderer and Editor

**Files:**
- Create: `src/components/TableIndexes/IndexTypeCellRenderer/index.ts`
- Create: `src/components/TableIndexes/IndexTypeCellRenderer/IndexTypeCellRenderer.tsx`
- Create: `src/components/TableIndexes/IndexTypeCellRenderer/IndexTypeCellEditor.tsx`
- Create: `src/components/TableIndexes/IndexTypeCellRenderer/types.ts`

**Step 1: Create types file**

Create `src/components/TableIndexes/IndexTypeCellRenderer/types.ts`:

```typescript
import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface IndexTypeCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-type-cell";
    value: string;
    options: string[];
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}
```

**Step 2: Create renderer**

Create `src/components/TableIndexes/IndexTypeCellRenderer/IndexTypeCellRenderer.tsx`:

```typescript
import type { CustomCell, CustomRenderer } from "@glideapps/glide-data-grid";
import type { IndexTypeCell } from "./types";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { IndexTypeCellEditor } from "./IndexTypeCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";

const CELL_PADDING = 8;

export const IndexTypeCellRenderer: CustomRenderer<IndexTypeCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is IndexTypeCell => {
    return (cell.data as Record<string, unknown>).kind === "index-type-cell";
  },
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isLocked } = cell.data;

    ctx.save();
    ctx.fillStyle = isLocked ? theme.textMedium : theme.textDark;
    ctx.font = "400 12px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const maxWidth = Math.max(0, rect.width - CELL_PADDING * 2);
    const displayText = truncateTextToWidth(value.toUpperCase(), maxWidth, ctx.font);

    const x = rect.x + CELL_PADDING;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);
    ctx.restore();

    return true;
  },
  provideEditor: (cell) => {
    if (cell.data.isLocked || cell.data.options.length <= 1) {
      return undefined;
    }
    return {
      editor: IndexTypeCellEditor,
      disablePadding: true,
      disableStyling: false,
    };
  },
};
```

**Step 3: Create editor with recreate confirmation**

Create `src/components/TableIndexes/IndexTypeCellRenderer/IndexTypeCellEditor.tsx`:

```typescript
import React, { useState, useCallback, useRef, useEffect } from "react";
import type { IndexTypeCell } from "./types";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";

interface IndexTypeCellEditorProps {
  value: IndexTypeCell;
  onFinishedEditing: (
    newValue?: IndexTypeCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const IndexTypeCellEditor: React.FC<IndexTypeCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const finishedRef = useRef(false);

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const handleSelect = useCallback(
    (newValue: string) => {
      if (finishedRef.current) return;

      if (newValue === value.data.value) {
        finishedRef.current = true;
        onFinishedEditing(undefined);
        return;
      }

      // Show confirmation if recreate required
      if (value.data.requiresRecreate) {
        setPendingValue(newValue);
        setShowConfirm(true);
        return;
      }

      finishedRef.current = true;
      const newCell: IndexTypeCell = {
        ...value,
        data: { ...value.data, value: newValue },
        copyData: newValue,
      };
      onFinishedEditing(newCell);
    },
    [value, onFinishedEditing],
  );

  const handleConfirm = useCallback(() => {
    if (finishedRef.current || !pendingValue) return;
    finishedRef.current = true;

    const newCell: IndexTypeCell = {
      ...value,
      data: { ...value.data, value: pendingValue },
      copyData: pendingValue,
    };
    onFinishedEditing(newCell);
  }, [value, pendingValue, onFinishedEditing]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCancel]);

  if (showConfirm) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-popover border shadow-lg rounded-md min-w-[240px]">
        <div className="flex items-center gap-2 text-amber-600">
          <IconAlertTriangle className="h-4 w-4" />
          <span className="text-xs font-medium">Recreate Required</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing index type will drop and recreate this index.
        </p>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Command className="bg-popover border shadow-lg rounded-md min-w-[160px]">
      <CommandInput placeholder="Search type..." className="h-8 text-xs" />
      <CommandList className="max-h-[200px]">
        <CommandEmpty className="text-xs py-2">No type found</CommandEmpty>
        {value.data.options.map((option) => (
          <CommandItem
            key={option}
            value={option}
            onSelect={() => handleSelect(option)}
            className="text-xs font-mono"
          >
            <span className="flex-1">{option.toUpperCase()}</span>
            {option === value.data.value && (
              <IconCheck className="h-3 w-3 text-primary" />
            )}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
};

export default IndexTypeCellEditor;
```

**Step 4: Create index file**

Create `src/components/TableIndexes/IndexTypeCellRenderer/index.ts`:

```typescript
export { IndexTypeCellRenderer } from "./IndexTypeCellRenderer";
export { IndexTypeCellEditor } from "./IndexTypeCellEditor";
export type { IndexTypeCell } from "./types";
```

**Step 5: Commit**

```bash
git add src/components/TableIndexes/IndexTypeCellRenderer/
git commit -m "feat(indexes): add index type dropdown with recreate confirmation"
```

---

## Task 5: Create IndexColumnsCell Renderer with Tag Display

**Files:**
- Create: `src/components/TableIndexes/IndexColumnsCellRenderer/index.ts`
- Create: `src/components/TableIndexes/IndexColumnsCellRenderer/IndexColumnsCellRenderer.tsx`
- Create: `src/components/TableIndexes/IndexColumnsCellRenderer/IndexColumnsCellEditor.tsx`
- Create: `src/components/TableIndexes/IndexColumnsCellRenderer/types.ts`

**Step 1: Create types file**

Create `src/components/TableIndexes/IndexColumnsCellRenderer/types.ts`:

```typescript
import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface IndexColumnsCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-columns-cell";
    columns: string[];
    availableColumns: string[];
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}
```

**Step 2: Create renderer with tag display**

Create `src/components/TableIndexes/IndexColumnsCellRenderer/IndexColumnsCellRenderer.tsx`:

```typescript
import type { CustomCell, CustomRenderer } from "@glideapps/glide-data-grid";
import type { IndexColumnsCell } from "./types";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { IndexColumnsCellEditor } from "./IndexColumnsCellEditor";

const CELL_PADDING = 8;
const TAG_GAP = 4;
const TAG_PADDING_H = 6;
const TAG_PADDING_V = 2;
const TAG_RADIUS = 3;

export const IndexColumnsCellRenderer: CustomRenderer<IndexColumnsCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is IndexColumnsCell => {
    return (cell.data as Record<string, unknown>).kind === "index-columns-cell";
  },
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { columns, isLocked } = cell.data;

    ctx.save();

    const tagFont = "400 11px monospace";
    ctx.font = tagFont;

    const tagBgColor = isLocked ? "rgba(127, 127, 127, 0.1)" : "rgba(59, 130, 246, 0.1)";
    const tagTextColor = isLocked ? theme.textMedium : "#3b82f6";

    let x = rect.x + CELL_PADDING;
    const centerY = rect.y + rect.height / 2;
    const maxX = rect.x + rect.width - CELL_PADDING;

    let hiddenCount = 0;

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const textWidth = ctx.measureText(col).width;
      const tagWidth = textWidth + TAG_PADDING_H * 2;

      // Check if tag fits
      if (x + tagWidth > maxX - 30) { // Reserve space for "+N"
        hiddenCount = columns.length - i;
        break;
      }

      // Draw tag background
      ctx.fillStyle = tagBgColor;
      ctx.beginPath();
      ctx.roundRect(x, centerY - 10, tagWidth, 20, TAG_RADIUS);
      ctx.fill();

      // Draw tag text
      ctx.fillStyle = tagTextColor;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(col, x + TAG_PADDING_H, centerY);

      x += tagWidth + TAG_GAP;
    }

    // Draw "+N more" if needed
    if (hiddenCount > 0) {
      ctx.fillStyle = theme.textMedium;
      ctx.font = "400 10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`+${hiddenCount}`, x, centerY);
    }

    ctx.restore();
    return true;
  },
  provideEditor: (cell) => {
    if (cell.data.isLocked) {
      return undefined;
    }
    return {
      editor: IndexColumnsCellEditor,
      disablePadding: true,
      disableStyling: false,
    };
  },
};
```

**Step 3: Create editor with command selector**

Create `src/components/TableIndexes/IndexColumnsCellRenderer/IndexColumnsCellEditor.tsx`:

```typescript
import React, { useState, useCallback, useRef, useEffect } from "react";
import type { IndexColumnsCell } from "./types";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle, IconCheck, IconX, IconChevronUp, IconChevronDown } from "@tabler/icons-react";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";

interface IndexColumnsCellEditorProps {
  value: IndexColumnsCell;
  onFinishedEditing: (
    newValue?: IndexColumnsCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const IndexColumnsCellEditor: React.FC<IndexColumnsCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(value.data.columns);
  const [search, setSearch] = useState("");
  const finishedRef = useRef(false);

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const handleSave = useCallback(() => {
    if (finishedRef.current) return;

    // Check if columns changed
    const columnsChanged =
      selectedColumns.length !== value.data.columns.length ||
      selectedColumns.some((col, i) => col !== value.data.columns[i]);

    if (!columnsChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Show confirmation if recreate required
    if (value.data.requiresRecreate && !showConfirm) {
      setShowConfirm(true);
      return;
    }

    finishedRef.current = true;
    const newCell: IndexColumnsCell = {
      ...value,
      data: { ...value.data, columns: selectedColumns },
      copyData: selectedColumns.join(", "),
    };
    onFinishedEditing(newCell);
  }, [value, selectedColumns, showConfirm, onFinishedEditing]);

  const toggleColumn = useCallback((column: string) => {
    setSelectedColumns((prev) => {
      if (prev.includes(column)) {
        return prev.filter((c) => c !== column);
      }
      return [...prev, column];
    });
  }, []);

  const removeColumn = useCallback((column: string) => {
    setSelectedColumns((prev) => prev.filter((c) => c !== column));
  }, []);

  const moveColumn = useCallback((index: number, direction: "up" | "down") => {
    setSelectedColumns((prev) => {
      const newArr = [...prev];
      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= newArr.length) return prev;
      [newArr[index], newArr[newIndex]] = [newArr[newIndex], newArr[index]];
      return newArr;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCancel]);

  const filteredColumns = value.data.availableColumns.filter((col) =>
    col.toLowerCase().includes(search.toLowerCase())
  );

  if (showConfirm) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-popover border shadow-lg rounded-md min-w-[280px]">
        <div className="flex items-center gap-2 text-amber-600">
          <IconAlertTriangle className="h-4 w-4" />
          <span className="text-xs font-medium">Recreate Required</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing index columns will drop and recreate this index.
        </p>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-popover border shadow-lg rounded-md min-w-[280px] max-w-[400px]">
      {/* Selected columns as tags */}
      {selectedColumns.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 border-b">
          {selectedColumns.map((col, idx) => (
            <div
              key={col}
              className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 text-blue-600 rounded text-xs font-mono"
            >
              <span>{col}</span>
              <div className="flex items-center gap-0.5 ml-1">
                <button
                  type="button"
                  onClick={() => moveColumn(idx, "up")}
                  disabled={idx === 0}
                  className="p-0.5 hover:bg-blue-500/20 rounded disabled:opacity-30"
                >
                  <IconChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => moveColumn(idx, "down")}
                  disabled={idx === selectedColumns.length - 1}
                  className="p-0.5 hover:bg-blue-500/20 rounded disabled:opacity-30"
                >
                  <IconChevronDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeColumn(col)}
                  className="p-0.5 hover:bg-red-500/20 rounded"
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Column selector */}
      <Command className="border-0 shadow-none">
        <CommandInput
          placeholder="Search columns..."
          className="h-8 text-xs"
          value={search}
          onValueChange={setSearch}
        />
        <CommandList className="max-h-[160px]">
          <CommandEmpty className="text-xs py-2">No columns found</CommandEmpty>
          {filteredColumns.map((col) => (
            <CommandItem
              key={col}
              value={col}
              onSelect={() => toggleColumn(col)}
              className="text-xs font-mono"
            >
              <span className="flex-1">{col}</span>
              {selectedColumns.includes(col) && (
                <IconCheck className="h-3 w-3 text-primary" />
              )}
            </CommandItem>
          ))}
        </CommandList>
      </Command>

      {/* Actions */}
      <div className="flex justify-end gap-2 p-2 border-t">
        <Button size="sm" variant="ghost" onClick={handleCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={selectedColumns.length === 0}
        >
          {value.data.requiresRecreate ? "Apply" : "Save"}
        </Button>
      </div>
    </div>
  );
};

export default IndexColumnsCellEditor;
```

**Step 4: Create index file**

Create `src/components/TableIndexes/IndexColumnsCellRenderer/index.ts`:

```typescript
export { IndexColumnsCellRenderer } from "./IndexColumnsCellRenderer";
export { IndexColumnsCellEditor } from "./IndexColumnsCellEditor";
export type { IndexColumnsCell } from "./types";
```

**Step 5: Commit**

```bash
git add src/components/TableIndexes/IndexColumnsCellRenderer/
git commit -m "feat(indexes): add columns cell with tag display and command selector"
```

---

## Task 6: Create ConditionCell Renderer with CodeMirror Popover

**Files:**
- Create: `src/components/TableIndexes/ConditionCellRenderer/index.ts`
- Create: `src/components/TableIndexes/ConditionCellRenderer/ConditionCellRenderer.tsx`
- Create: `src/components/TableIndexes/ConditionCellRenderer/ConditionCellEditor.tsx`
- Create: `src/components/TableIndexes/ConditionCellRenderer/types.ts`

**Step 1: Create types file**

Create `src/components/TableIndexes/ConditionCellRenderer/types.ts`:

```typescript
import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface IndexConditionCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-condition-cell";
    value: string;
    requiresRecreate: boolean;
    isLocked: boolean;
    dialect: string;
  };
  copyData: string;
  readonly?: boolean;
}
```

**Step 2: Create renderer**

Create `src/components/TableIndexes/ConditionCellRenderer/ConditionCellRenderer.tsx`:

```typescript
import type { CustomCell, CustomRenderer } from "@glideapps/glide-data-grid";
import type { IndexConditionCell } from "./types";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { ConditionCellEditor } from "./ConditionCellEditor";
import { truncateTextToWidth } from "@/components/DataGrid/utils/textUtils";

const CELL_PADDING = 8;

export const ConditionCellRenderer: CustomRenderer<IndexConditionCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell: CustomCell): cell is IndexConditionCell => {
    return (cell.data as Record<string, unknown>).kind === "index-condition-cell";
  },
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, isLocked } = cell.data;

    ctx.save();

    const hasValue = value && value.trim() !== "";

    if (!hasValue) {
      // Draw placeholder
      ctx.fillStyle = theme.textMedium;
      ctx.font = "italic 11px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("—", rect.x + CELL_PADDING, rect.y + rect.height / 2);
      ctx.restore();
      return true;
    }

    ctx.fillStyle = isLocked ? theme.textMedium : "#3b82f6";
    ctx.font = "400 11px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const maxWidth = Math.max(0, rect.width - CELL_PADDING * 2);
    const displayText = truncateTextToWidth(value, maxWidth, ctx.font);

    ctx.fillText(displayText, rect.x + CELL_PADDING, rect.y + rect.height / 2);
    ctx.restore();

    return true;
  },
  provideEditor: (cell) => {
    if (cell.data.isLocked) {
      return undefined;
    }
    return {
      editor: ConditionCellEditor,
      disablePadding: true,
      disableStyling: false,
    };
  },
};
```

**Step 3: Create editor with CodeMirror**

Create `src/components/TableIndexes/ConditionCellRenderer/ConditionCellEditor.tsx`:

```typescript
import React, { useState, useCallback, useRef, useEffect } from "react";
import type { IndexConditionCell } from "./types";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle } from "@tabler/icons-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";

interface ConditionCellEditorProps {
  value: IndexConditionCell;
  onFinishedEditing: (
    newValue?: IndexConditionCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const ConditionCellEditor: React.FC<ConditionCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [code, setCode] = useState(value.data.value);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const finishedRef = useRef(false);

  const handleCancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedEditing(undefined);
  }, [onFinishedEditing]);

  const validateSql = useCallback((sql: string): string | null => {
    if (!sql.trim()) return null;

    // Basic syntax validation
    const trimmed = sql.trim();

    // Check for obvious syntax errors
    const openParens = (trimmed.match(/\(/g) || []).length;
    const closeParens = (trimmed.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      return "Unbalanced parentheses";
    }

    // Check for unclosed quotes
    const singleQuotes = (trimmed.match(/'/g) || []).length;
    if (singleQuotes % 2 !== 0) {
      return "Unclosed string quote";
    }

    return null;
  }, []);

  const handleSave = useCallback(() => {
    if (finishedRef.current) return;

    const trimmedCode = code.trim();

    // Validate syntax
    const error = validateSql(trimmedCode);
    if (error) {
      setSyntaxError(error);
      return;
    }

    // Check if value changed
    if (trimmedCode === value.data.value) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Show confirmation if recreate required
    if (value.data.requiresRecreate && !showConfirm) {
      setShowConfirm(true);
      return;
    }

    finishedRef.current = true;
    const newCell: IndexConditionCell = {
      ...value,
      data: { ...value.data, value: trimmedCode },
      copyData: trimmedCode,
    };
    onFinishedEditing(newCell);
  }, [value, code, showConfirm, validateSql, onFinishedEditing]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCancel]);

  // Clear syntax error when code changes
  useEffect(() => {
    setSyntaxError(null);
  }, [code]);

  if (showConfirm) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-popover border shadow-lg rounded-md min-w-[280px]">
        <div className="flex items-center gap-2 text-amber-600">
          <IconAlertTriangle className="h-4 w-4" />
          <span className="text-xs font-medium">Recreate Required</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing the condition will drop and recreate this index.
        </p>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-popover border shadow-lg rounded-md min-w-[320px] max-w-[480px]">
      <div className="px-2 py-1.5 border-b bg-muted/30">
        <span className="text-[10px] font-medium text-muted-foreground">
          WHERE Condition (partial index)
        </span>
      </div>

      <div className="p-1">
        <CodeMirror
          value={code}
          height="120px"
          extensions={[
            sql(),
            EditorView.lineWrapping,
          ]}
          onChange={setCode}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
          }}
          className="text-xs border rounded"
        />
      </div>

      {syntaxError && (
        <div className="px-2 py-1 text-xs text-red-600 bg-red-50 dark:bg-red-950/30">
          {syntaxError}
        </div>
      )}

      <div className="flex justify-between items-center gap-2 p-2 border-t">
        <span className="text-[10px] text-muted-foreground">
          e.g., status = 'active'
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            {value.data.requiresRecreate ? "Apply" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConditionCellEditor;
```

**Step 4: Create index file**

Create `src/components/TableIndexes/ConditionCellRenderer/index.ts`:

```typescript
export { ConditionCellRenderer } from "./ConditionCellRenderer";
export { ConditionCellEditor } from "./ConditionCellEditor";
export type { IndexConditionCell } from "./types";
```

**Step 5: Commit**

```bash
git add src/components/TableIndexes/ConditionCellRenderer/
git commit -m "feat(indexes): add condition cell with CodeMirror SQL editor"
```

---

## Task 7: Create Hook for Supported Index Types

**Files:**
- Create: `src/hooks/useSupportedIndexTypes.ts`

**Step 1: Create the hook**

Create `src/hooks/useSupportedIndexTypes.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { databaseService } from "@/services/databaseService";
import { getAdapter } from "@/adapters";
import { DbType } from "@/services/backend";

interface UseSupportedIndexTypesParams {
  connectionId: string;
  dbType: DbType;
  enabled?: boolean;
}

interface UseSupportedIndexTypesReturn {
  indexTypes: string[];
  defaultType: string;
  isLoading: boolean;
  error: string | null;
}

const DEFAULT_INDEX_TYPES: Record<DbType, { types: string[]; default: string }> = {
  [DbType.PostgreSQL]: {
    types: ["btree", "hash", "gist", "gin", "spgist", "brin"],
    default: "btree",
  },
  [DbType.MySQL]: {
    types: ["btree", "hash", "fulltext", "spatial"],
    default: "btree",
  },
  [DbType.SQLite]: {
    types: ["btree"],
    default: "btree",
  },
  [DbType.SQLServer]: {
    types: ["clustered", "nonclustered", "columnstore"],
    default: "nonclustered",
  },
};

export function useSupportedIndexTypes({
  connectionId,
  dbType,
  enabled = true,
}: UseSupportedIndexTypesParams): UseSupportedIndexTypesReturn {
  const { data, isPending, error } = useQuery({
    queryKey: ["indexTypes", connectionId, dbType],
    queryFn: async () => {
      try {
        const adapter = getAdapter(dbType, connectionId);
        const query = adapter.getSupportedIndexTypesQuery();
        const result = await databaseService.execute(connectionId, query);

        const types = result.rows.map((row) => {
          const val = row[0];
          return typeof val === "string" ? val.toLowerCase() : String(val).toLowerCase();
        });

        return types.length > 0 ? types : DEFAULT_INDEX_TYPES[dbType].types;
      } catch {
        return DEFAULT_INDEX_TYPES[dbType].types;
      }
    },
    enabled: enabled && Boolean(connectionId),
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  return {
    indexTypes: data ?? DEFAULT_INDEX_TYPES[dbType].types,
    defaultType: DEFAULT_INDEX_TYPES[dbType].default,
    isLoading: isPending,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
```

**Step 2: Commit**

```bash
git add src/hooks/useSupportedIndexTypes.ts
git commit -m "feat(indexes): add hook for fetching supported index types per database"
```

---

## Task 8: Update columns.ts for New Column Layout

**Files:**
- Modify: `src/components/TableIndexes/columns.ts`

**Step 1: Update column definitions**

Replace content of `src/components/TableIndexes/columns.ts`:

```typescript
import type { GridColumnV2 } from "@/components/DataGrid/types";

export const indexColumns: GridColumnV2[] = [
  {
    id: "row_number",
    field: "row_number",
    title: "#",
    name: "#",
    width: 48,
    minWidth: 48,
    maxWidth: 80,
  } as GridColumnV2,
  {
    id: "name",
    field: "name",
    title: "Name",
    name: "Name",
    width: 200,
    minWidth: 120,
    maxWidth: 400,
  } as GridColumnV2,
  {
    id: "columns",
    field: "columns",
    title: "Columns",
    name: "Columns",
    width: 260,
    minWidth: 160,
    maxWidth: 500,
  } as GridColumnV2,
  {
    id: "index_type",
    field: "index_type",
    title: "Type",
    name: "Type",
    width: 100,
    minWidth: 80,
    maxWidth: 160,
  } as GridColumnV2,
  {
    id: "unique",
    field: "unique",
    title: "Unique",
    name: "Unique",
    width: 80,
    minWidth: 72,
    maxWidth: 120,
  } as GridColumnV2,
  {
    id: "statistics",
    field: "statistics",
    title: "Usage Stats",
    name: "Usage Stats",
    width: 180,
    minWidth: 120,
    maxWidth: 280,
  } as GridColumnV2,
  {
    id: "condition",
    field: "condition",
    title: "Condition",
    name: "Condition",
    width: 280,
    minWidth: 160,
  } as GridColumnV2,
  {
    id: "actions",
    field: "actions",
    title: "",
    name: "",
    width: 48,
    minWidth: 48,
    maxWidth: 48,
  } as GridColumnV2,
];
```

**Step 2: Commit**

```bash
git add src/components/TableIndexes/columns.ts
git commit -m "refactor(indexes): update column definitions with Condition field"
```

---

## Task 9: Update utils.ts for New Row Transformations

**Files:**
- Modify: `src/components/TableIndexes/utils.ts`

**Step 1: Update transformIndexesToRows function**

Update `src/components/TableIndexes/utils.ts`:

```typescript
import type { TableIndex } from "@/services/databaseService";
import type { IndexUsageStats } from "@/services/backend";
import type { IndexGridRow } from "./types";
import type { CrudCommand, IndexCreatePayload, IndexDropPayload, IndexRenamePayload } from "@/types/crud";

function formatStatistics(stats?: IndexUsageStats): string {
  if (!stats) return "—";

  const parts: string[] = [];

  if (stats.scan_count !== undefined) {
    parts.push(`${stats.scan_count.toLocaleString()} scans`);
  }

  if (stats.size_pretty) {
    parts.push(stats.size_pretty);
  }

  if (stats.cache_hit_ratio !== undefined && stats.cache_hit_ratio > 0) {
    parts.push(`${stats.cache_hit_ratio.toFixed(1)}% cache`);
  }

  if (stats.is_unused) {
    parts.push("unused");
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function transformIndexesToRows(
  indexes: TableIndex[],
  pendingCommands: CrudCommand[] = [],
  statsMap?: Map<string, IndexUsageStats>,
): IndexGridRow[] {
  // Extract pending operations by type
  const pendingAdds = pendingCommands.filter(
    (cmd) => cmd.type === "index.create",
  ) as CrudCommand<IndexCreatePayload>[];

  const pendingDeletes = pendingCommands.filter(
    (cmd) => cmd.type === "index.drop",
  ) as CrudCommand<IndexDropPayload>[];

  const pendingRenames = pendingCommands.filter(
    (cmd) => cmd.type === "index.rename",
  ) as CrudCommand<IndexRenamePayload>[];

  // Build lookup sets
  const deletedIndexNames = new Set(
    pendingDeletes.map((cmd) => cmd.payload.indexName),
  );

  const renamedIndexes = new Map(
    pendingRenames.map((cmd) => [cmd.payload.indexName, cmd.payload.newName]),
  );

  // Check for recreate commands (drop + create with same temp marker)
  const recreateIndexes = new Set<string>();
  for (const dropCmd of pendingDeletes) {
    const matchingCreate = pendingAdds.find(
      (addCmd) => addCmd.metadata?.tags?.includes(`recreate:${dropCmd.payload.indexName}`),
    );
    if (matchingCreate) {
      recreateIndexes.add(dropCmd.payload.indexName);
    }
  }

  // Transform actual indexes
  const actualRows: IndexGridRow[] = indexes.map((index, idx) => {
    const stats = statsMap?.get(index.name);
    const isPendingDelete = deletedIndexNames.has(index.name) && !recreateIndexes.has(index.name);
    const newName = renamedIndexes.get(index.name);
    const isRenamed = Boolean(newName);
    const isRecreating = recreateIndexes.has(index.name);

    return {
      row_number: idx + 1,
      name: newName ?? index.name,
      name_meta: {
        primary: index.primary,
        unique: index.unique,
      },
      columns: index.columns.join(", "),
      columns_array: index.columns,
      index_type: index.index_type,
      unique: index.unique ? "YES" : "NO",
      statistics: formatStatistics(stats),
      stats,
      condition: index.condition || "",
      _original: index,
      _isPendingDelete: isPendingDelete,
      _isModified: isRenamed || isRecreating,
      _requiresRecreate: isRecreating,
    };
  });

  // Create virtual rows for pending additions (at bottom)
  const virtualRows: IndexGridRow[] = pendingAdds
    .filter((cmd) => !cmd.metadata?.tags?.some((t) => t.startsWith("recreate:")))
    .map((cmd, idx) => {
      const def = cmd.payload.definition;
      return {
        row_number: actualRows.length + idx + 1,
        name: def.name || "",
        name_meta: {
          primary: false,
          unique: def.unique ?? false,
        },
        columns: (def.columns || []).join(", "),
        columns_array: def.columns || [],
        index_type: def.using || "btree",
        unique: def.unique ? "YES" : "NO",
        statistics: "—",
        condition: def.where ?? "",
        _tempId: cmd.payload.tempId,
        _isPending: true,
      };
    });

  return [...actualRows, ...virtualRows];
}
```

**Step 2: Commit**

```bash
git add src/components/TableIndexes/utils.ts
git commit -m "refactor(indexes): update row transformation with rename and recreate support"
```

---

## Task 10: Update Main TableIndexes Component

**Files:**
- Modify: `src/components/TableIndexes/index.tsx`

**Step 1: Update imports and add new cell renderers**

This is a large update. Key changes:
1. Import new cell renderers
2. Add `useSupportedIndexTypes` and `useTableColumns` hooks
3. Update `getCellContent` to return new cell types
4. Add `handleCellEdited` for inline editing
5. Add `handleAddIndex` for creating new indexes
6. Wire up rename and recreate command generation

Due to the size of this file, here are the key sections to update:

**Add imports at top:**

```typescript
// Add to existing imports
import { IndexColumnsCellRenderer } from "./IndexColumnsCellRenderer";
import { IndexTypeCellRenderer } from "./IndexTypeCellRenderer";
import { IndexUniqueCellRenderer } from "./IndexUniqueCellRenderer";
import { ConditionCellRenderer } from "./ConditionCellRenderer";
import { useSupportedIndexTypes } from "@/hooks/useSupportedIndexTypes";
import { useTableColumns } from "@/hooks/useTableFullStructure";
import { createIndexCreateCommand, createIndexRenameCommand } from "./commandFactory";
import type {
  EditableIndexNameCell,
  IndexColumnsCell,
  IndexTypeCell,
  IndexUniqueCell,
  IndexConditionCell
} from "./types";
```

**Add hooks in component:**

```typescript
// After existing hooks, add:
const { columns: tableColumns } = useTableColumns({
  connectionId,
  database,
  table,
  schema,
});

const { indexTypes, defaultType } = useSupportedIndexTypes({
  connectionId,
  dbType: DbType.PostgreSQL, // TODO: Get from connection
  enabled: true,
});

const availableColumnNames = useMemo(
  () => tableColumns.map((col) => col.name),
  [tableColumns],
);
```

**Update customRenderers:**

```typescript
const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
  () => [
    IndexNameCellRenderer as unknown as CustomRenderer<AnyCell>,
    IndexColumnsCellRenderer as unknown as CustomRenderer<AnyCell>,
    IndexTypeCellRenderer as unknown as CustomRenderer<AnyCell>,
    IndexUniqueCellRenderer as unknown as CustomRenderer<AnyCell>,
    ConditionCellRenderer as unknown as CustomRenderer<AnyCell>,
    TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
  ],
  [],
);
```

**Add handleAddIndex:**

```typescript
const handleAddIndex = useCallback(() => {
  const target: CrudCommandTarget = {
    connectionId,
    database,
    schema,
    table,
  };

  const command = createIndexCreateCommand(target, {
    name: "",
    columns: [],
    unique: false,
    using: defaultType,
  });

  stageCommand(command);
  toast.success("New index added", {
    description: "Fill in the index details and commit when ready",
  });
}, [connectionId, database, schema, table, defaultType, stageCommand]);
```

**Add handleCellEdited:**

```typescript
const handleCellEdited = useCallback(
  (cell: Item, newValue: EditableGridCell) => {
    const [colIndex, rowIndex] = cell;
    const column = sizedColumns[colIndex];
    const row = gridRows[rowIndex];

    if (!column || !row) return;

    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table,
    };

    // Handle name rename
    if (column.field === "name" && "data" in newValue) {
      const data = newValue.data as { name?: string };
      const newName = data.name?.trim();

      if (row._isPending) {
        // Update pending create command
        const cmd = pendingCommands.find(
          (c) => c.type === "index.create" &&
                 (c.payload as IndexCreatePayload).tempId === row._tempId,
        );
        if (cmd) {
          const payload = cmd.payload as IndexCreatePayload;
          stageCommand({
            ...cmd,
            payload: {
              ...payload,
              definition: { ...payload.definition, name: newName || "" },
            },
          });
        }
      } else if (newName && newName !== row._original?.name) {
        // Stage rename command
        const renameCmd = createIndexRenameCommand(target, row._original!.name, newName);
        stageCommand(renameCmd);
      }
    }

    // Handle columns change - requires recreate for existing indexes
    if (column.field === "columns" && "data" in newValue) {
      const data = newValue.data as { columns?: string[] };
      const newColumns = data.columns || [];

      if (row._isPending) {
        updatePendingIndexColumns(row._tempId!, newColumns);
      } else {
        recreateIndex(row, { columns: newColumns });
      }
    }

    // Handle other fields similarly...
  },
  [/* dependencies */],
);
```

**Step 2: Update getCellContent for new cell types**

Update the getCellContent callback to return the new cell types with proper data.

**Step 3: Commit**

```bash
git add src/components/TableIndexes/index.tsx
git commit -m "feat(indexes): integrate editable cells and CRUD operations"
```

---

## Task 11: Add Validation for Index Names

**Files:**
- Create: `src/components/TableIndexes/validation.ts`

**Step 1: Create validation utilities**

Create `src/components/TableIndexes/validation.ts`:

```typescript
export interface IndexValidationResult {
  valid: boolean;
  error?: string;
}

export function validateIndexName(
  name: string,
  existingNames: string[],
  currentName?: string,
): IndexValidationResult {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "Index name is required" };
  }

  if (trimmed.length > 63) {
    return { valid: false, error: "Index name too long (max 63 characters)" };
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return {
      valid: false,
      error: "Index name must start with letter/underscore and contain only letters, numbers, underscores",
    };
  }

  const lowerName = trimmed.toLowerCase();
  const isDuplicate = existingNames.some(
    (existing) =>
      existing.toLowerCase() === lowerName &&
      existing.toLowerCase() !== currentName?.toLowerCase(),
  );

  if (isDuplicate) {
    return { valid: false, error: "Index name already exists" };
  }

  return { valid: true };
}

export function validateIndexColumns(columns: string[]): IndexValidationResult {
  if (columns.length === 0) {
    return { valid: false, error: "At least one column is required" };
  }

  return { valid: true };
}

export function validateIndexDefinition(
  name: string,
  columns: string[],
  existingNames: string[],
  currentName?: string,
): IndexValidationResult {
  const nameResult = validateIndexName(name, existingNames, currentName);
  if (!nameResult.valid) return nameResult;

  const columnsResult = validateIndexColumns(columns);
  if (!columnsResult.valid) return columnsResult;

  return { valid: true };
}
```

**Step 2: Commit**

```bash
git add src/components/TableIndexes/validation.ts
git commit -m "feat(indexes): add validation utilities for index definitions"
```

---

## Task 12: Final Integration and Testing

**Files:**
- Modify: `src/components/TableIndexes/index.tsx` (final polish)

**Step 1: Run dev server and test manually**

```bash
pnpm tauri:dev
```

**Step 2: Test checklist**

- [ ] Create new index with empty row at bottom
- [ ] Edit index name inline
- [ ] Select columns via command selector
- [ ] Reorder columns with up/down buttons
- [ ] Change index type via dropdown
- [ ] Toggle unique YES/NO
- [ ] Edit condition via CodeMirror popover
- [ ] Verify recreate confirmation appears for existing indexes
- [ ] Verify PK indexes are locked
- [ ] Commit changes and verify SQL generation
- [ ] Undo pending changes

**Step 3: Run linting and type check**

```bash
pnpm lint && pnpm typecheck
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(indexes): complete CRUD indexes implementation with full inline editing"
```

---

## Summary

This plan implements CRUD indexes in 12 tasks:

1. **Types** - Add cell type interfaces
2. **IndexNameCell** - Editable name with PK lock
3. **IndexUniqueCell** - YES/NO toggle with recreate confirm
4. **IndexTypeCell** - Dynamic dropdown with recreate confirm
5. **IndexColumnsCell** - Tag display + command selector
6. **ConditionCell** - CodeMirror SQL editor
7. **useSupportedIndexTypes** - Hook for DB-specific types
8. **columns.ts** - Update column layout
9. **utils.ts** - Update row transformations
10. **index.tsx** - Main component integration
11. **validation.ts** - Name and definition validation
12. **Testing** - Manual verification

Each task is designed to be completed in 15-30 minutes with clear file paths, code, and commit messages.
