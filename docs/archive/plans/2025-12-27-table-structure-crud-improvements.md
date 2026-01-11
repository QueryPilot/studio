# TableStructure CRUD Improvements Design

## Overview

Comprehensive overhaul of the `src/components/TableStructure/` component to fix existing bugs and add new CRUD features for a fully functional, easy-to-use table structure editing UI.

## Bug Fixes

### 1. Fix PK/FK Icons (Currently Broken)

**Problem:** `ColumnNameCellRenderer` checks for `kind: "column-name-cell"` but cells are created with `kind: "text-single-cell"` - the renderer never matches, so PK/FK icons never display.

**Solution:**
- Unify the cell kind to `"column-name-cell"` in `getCellContent`
- Enhance `ColumnNameCellRenderer` to:
  - Draw column name with proper text ellipsis (following existing renderer patterns)
  - Render Tabler icons (`IconKey`, `IconLink`) on the right side
  - Provide an editor for inline renaming (currently returns `undefined`)

### 2. Fix Text Ellipsis

**Problem:** `truncateTextToWidth()` truncates but may not add "..." indicator consistently.

**Solution:** Follow the pattern from existing cell renderers in `DataGrid/renderers/` - ensure truncation adds ellipsis and respects cell padding.

### 3. Replace Emoji Icons with Tabler

**Current:** Actions column uses 🗑️ and ↩️ emojis.

**Replace with:**
- `IconTrash` for delete action
- `IconArrowBackUp` for undo pending delete

## New Features

### 1. Duplicate Column (Cmd+D)

**Trigger:** Right-click context menu → "Duplicate Column" or Cmd+D keyboard shortcut

**Behavior:**
- Creates a new pending column with copied properties (type, nullable, default, comment)
- Auto-generates name: `{original_name}_copy` (or `_copy2`, `_copy3` if exists)
- New row appears at bottom in pending state (green background)
- Column name cell auto-focuses for immediate renaming

### 2. Batch Row Selection

**Enable:** Change `rowSelect="none"` to `rowSelect="multi"` in DataGridBase

**Selection UX:**
- Click row to select single
- Shift+click for range selection
- Cmd/Ctrl+click to toggle individual rows
- Visual: Selected rows get highlighted background (Glide Data Grid built-in)

### 3. Batch Actions

**Toolbar (appears when selection active):**
- "Delete Selected (X)" - stages drop commands for all selected columns
- "Set Nullable" dropdown - YES/NO to apply to all selected
- "Set Type" dropdown - type picker to apply to all selected

**Context Menu (on selected rows):**
- Same three actions available via right-click

## Inline Validation & UX Polish

### Inline Cell Validation

**Visual Feedback:**
- Invalid cells get red border (`border: 1px solid red-500`)
- Tooltip on hover shows error message (e.g., "Column name already exists")
- Validation state tracked per-cell in component state

**Validation Rules (column name):**
- Required (non-empty)
- Valid identifier format (letters, numbers, underscores)
- Unique among existing + pending columns
- Not a reserved SQL keyword

**When Validated:**
- On blur (when leaving cell)
- On edit commit attempt
- Block commit if any pending column has validation errors

### Context Menu Implementation

**Menu Items:**
- "Duplicate Column" (Cmd+D)
- ---separator---
- "Delete Column" (when single row)
- "Delete Selected (X)" (when multiple selected)
- "Set Nullable" → submenu: YES / NO
- "Set Type" → submenu: type picker

**Implementation:** Use Glide Data Grid's `onCellContextMenu` callback + shadcn `ContextMenu` component

## Component Architecture & File Changes

### Files to Modify

| File | Changes |
|------|---------|
| `index.tsx` | Enable row selection, add batch action handlers, add context menu, keyboard shortcuts |
| `ColumnNameCellRenderer.tsx` | Fix cell kind, add Tabler icons for PK/FK, add editor support, text ellipsis |
| `columns.ts` | Update actions column width if needed for icons |
| `types.ts` | Add validation state types |

### New Files

| File | Purpose |
|------|---------|
| `StructureContextMenu.tsx` | Right-click context menu with duplicate, delete, batch actions |
| `BatchActionsToolbar.tsx` | Toolbar section for batch operations (or extend `TableActionsToolbar`) |
| `useStructureValidation.ts` | Hook for tracking cell validation states |
| `ActionsCellRenderer.tsx` | Custom renderer for action icons (Tabler icons via canvas) |

### Actions Column Renderer

**Current:** Text cell with emoji string

**New:** Custom renderer that draws Tabler icons using canvas API:
- Draws `IconTrash` (or `IconArrowBackUp` for pending delete)
- Handles click to trigger delete/undo
- Consistent 16px icon size, muted until hover

## Implementation Order

1. **Phase 1 - Bug Fixes**
   - Fix ColumnNameCellRenderer cell kind mismatch
   - Add PK/FK Tabler icons (IconKey, IconLink)
   - Fix text ellipsis following existing patterns
   - Create ActionsCellRenderer with Tabler icons

2. **Phase 2 - Duplicate Column**
   - Add context menu infrastructure
   - Implement duplicate column logic
   - Add Cmd+D keyboard shortcut

3. **Phase 3 - Batch Operations**
   - Enable multi-row selection
   - Add batch actions to toolbar
   - Add batch actions to context menu

4. **Phase 4 - Inline Validation**
   - Create useStructureValidation hook
   - Add visual validation feedback (red border, tooltip)
   - Block commit on validation errors

## Summary

| Category | Items |
|----------|-------|
| Bug Fixes | 3 (PK/FK icons, ellipsis, emoji→icons) |
| New Features | 3 (duplicate, batch select, batch actions) |
| UX Improvements | 2 (inline validation, context menu) |
| Files Modified | 4 |
| Files Created | 4 |
