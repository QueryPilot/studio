# Inspector Tree View Redesign

## Problem

The current inspector tree view (`InspectorTreeView.tsx`) uses a two-line layout with `<details>`/`<summary>` HTML elements. Keys and values appear on separate lines, array items are extremely verbose (index on one line, value on the next), there's no type coloring, and the overall look is unprofessional compared to tools like MongoDB Compass or Studio 3T.

## Solution

Replace the tree renderer with a **syntax-highlighted JSON view** that supports **hybrid inline editing** — click-to-edit for primitives, inline CodeEditor expansion for objects/arrays.

## Display

### JSON Rendering
- Pretty-printed JSON with 2-space indentation
- Type-colored values:
  - Strings: green, wrapped in quotes
  - Numbers: orange
  - Booleans: yellow
  - Null: grey italic
  - Keys: blue, wrapped in quotes
  - Brackets/colons/commas: muted grey
- Monospace font throughout (`MONOSPACE_FONT_FAMILY` from render cache)
- Line-by-line hover highlighting (subtle background on hover)

### Collapsing
- Objects and arrays are collapsible via a chevron toggle (▶/▼) in the left gutter
- Collapsed state shows: `"skills": [...]` or `"experience": {...}` with item/field count hint
- Default: expand first 2 levels, collapse deeper
- When search is active: expand all matching paths

### Indentation
- 2-space indent per nesting level, matching standard JSON formatting
- No tree guide lines needed — the JSON structure itself provides visual hierarchy

## Editing

### Primitive Values (string, number, boolean, null)
- Click a value → it becomes an inline `<input>` field in-place
- The input is pre-filled with the raw value (strings without quotes, numbers as-is)
- **Enter** commits, **Escape** cancels, **blur** cancels
- Commit routes through the existing `onCellEdit(field, parsedValue)` callback
- Literal parsing: `"null"` → `null`, `"true"` → `true`, `"false"` → `false`; numeric strings stay as strings (CRUD pipeline handles type coercion)

### Object/Array Values
- Click the value region or an edit button → the subtree expands into an **editable CodeEditor block** inline
- The CodeEditor shows the JSON subtree with full syntax highlighting and editing
- **Save** and **Cancel** buttons appear below the editor
- On save: parse the edited JSON, replace the entire subtree value via `onCellEdit(field, parsedObject)`
- On parse error: show inline error message, don't close the editor
- Editor height: auto-sized to content, max ~300px with scroll

### What triggers edit mode
- Primitives: single click on the value text
- Objects/arrays: single click on an edit icon (pencil) that appears on hover, OR double-click on the collapsed summary

## Existing Features Preserved

These features from the current `InspectorTreeView` must continue to work:

- **Search filtering**: top input field, deferred search, filters by field name or value text
- **Multi-row merge**: when multiple rows selected, fields with identical values show normally; fields with different values show `<multiple>` with badges for distinct values
- **Pending edit highlighting**: amber background on fields with staged edits
- **Undo button**: revert staged edits per field
- **Data type tooltip**: show column db_type on hover (for top-level fields with column metadata)

## Component Structure

### InspectorTreeView (refactored)
- Same props interface as today (`documents`, `dataTypeMap`, `onCellEdit`, etc.)
- Renders the search input + a `<ScrollArea>` containing `JsonTreeNode` components

### JsonTreeNode (new, recursive)
- Renders a single key-value pair in JSON syntax
- Handles: primitives (inline display + click-to-edit), objects/arrays (collapsible + expand-to-edit)
- Receives: `fieldKey`, `value`, `depth`, `path`, `searchFilter`, `onEdit`, `editState`
- Memoized to prevent re-renders on sibling changes

### JsonSubtreeEditor (new)
- Wraps a CodeEditor instance for editing an object/array subtree
- Props: `initialValue: unknown`, `onSave: (value: unknown) => void`, `onCancel: () => void`
- Handles JSON parse + validation, shows error inline
- Uses the existing `CodeEditor` component from `@/components/CodeEditor`

## Files Modified

- `src/components/DataGrid/components/inspector/InspectorTreeView.tsx` — full rewrite

## Files Created

- `src/components/DataGrid/components/inspector/JsonTreeNode.tsx` — recursive JSON node renderer
- `src/components/DataGrid/components/inspector/JsonSubtreeEditor.tsx` — inline CodeEditor for object/array editing
