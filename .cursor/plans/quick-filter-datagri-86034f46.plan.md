<!-- 86034f46-076e-48be-a043-fba50bbbd0d8 33fe2cc0-57d6-4614-836d-b871db26fca4 -->
# Quick Filter for TableDataGridV2

## Overview

Add a toolbar row inside TableDataGridV2 with a quick filter input supporting 3 modes:

- **? (Simple Search)**: Match any column containing the text
- **WHERE clause**: Limited SQL WHERE expressions (simple comparisons with AND/OR)
- **# (AI Filter)**: Natural language → AI generates WHERE clause

All modes generate `FilterConfig` for server-side filtering via `useTableDataQuery`.

**Key Design Decisions**:

- WHERE mode supports **simple expressions only**: `column = 'value'`, `age > 25`, basic AND/OR joins (no subqueries/complex nesting)
- Mode selector is a **dropdown menu** (not cycling) for direct selection - better UX
- Keyboard shortcut: **`Cmd+Shift+F`** (avoids browser's native Cmd+F conflict)
- Filter state persists **within tab instance only**, clears on tab switch/close
- Empty results show **"No results" message** with "Clear filter" button
- AI responses are **validated** before applying to catch invalid SQL or missing columns

## Implementation Steps

### 1. Create Filter Parser Utilities

**File**: `src/utils/filterParser.ts` (new)

Core parsing functions:

- `parseSimpleSearch(text: string, columns: ColumnMeta[]): FilterConfig` - Generate OR conditions across all searchable columns (text, varchar, etc.)
- `parseWhereClause(whereExpr: string, columns: ColumnMeta[]): { success: boolean, filter?: FilterConfig, error?: string }` - Parse **simple** WHERE syntax into FilterConfig (support: =, !=, >, <, >=, <=, LIKE, IN, IS NULL, AND, OR)
- `validateWhereClause(clause: string, columns: ColumnMeta[]): { valid: boolean, error?: string }` - Validate column references and basic syntax
- `sanitizeInput(input: string, mode: FilterMode): string` - Remove mode prefixes (?, #) and trim
- Type: `type FilterMode = 'search' | 'where' | 'ai'`

**Limitations for WHERE mode** (keep it simple):

- Support basic operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `ILIKE`, `IN`, `IS NULL`, `IS NOT NULL`
- Support AND/OR joining (single level, no nested groups initially)
- No subqueries, no functions (initially)
- Column names must exist in schema

### 2. Create Quick Filter Component

**File**: `src/components/DataGridV2/components/QuickFilter.tsx` (new)

UI elements:

- **Mode selector dropdown** button (left side) - shows icon based on mode (?, SQL, #), opens menu on click
- **Input field** with debounced onChange (300ms) and mode-specific placeholder
- **Column autocomplete** popover (triggered by typing 1+ chars or Cmd+.)
- **Clear button** (X icon, right side, only shown when input has value)
- **Loading indicator** (shown during AI requests)
- **Error message** (inline below input, shown when parsing/validation fails)

Props interface:

```typescript
interface QuickFilterProps {
  columns: ColumnMeta[];
  value: string;
  mode: FilterMode;
  onValueChange: (value: string) => void;
  onModeChange: (mode: FilterMode) => void;
  onFilterApply: (filter: FilterConfig | null) => void;
  isLoading?: boolean;
  error?: string | null;
}
```

### 3. Create AI Filter Hook

**File**: `src/components/DataGridV2/hooks/useAIFilter.ts` (new)

Hook for AI-assisted filtering:

- Takes user prompt + column metadata
- Sends to AI with structured system prompt
- Returns WHERE clause (without "WHERE" keyword)
- Validates response before returning
- Handles errors gracefully

System prompt template:

```
You are a SQL expert. Generate a WHERE clause to filter table data.

Available columns:
- name (TEXT)
- age (INTEGER)
- status (TEXT)
...

User request: "{prompt}"

Return ONLY the WHERE clause expression without the "WHERE" keyword.
Use only the columns listed above. Keep it simple.

Example: age > 25 AND status = 'active'
```

Interface:

```typescript
interface UseAIFilterResult {
  generateFilter: (prompt: string) => Promise<{ clause: string } | { error: string }>;
  isLoading: boolean;
  reset: () => void;
}
```

### 4. Create Column Autocomplete Hook

**File**: `src/components/DataGridV2/hooks/useQuickFilterAutocomplete.ts` (new)

Features:

- Monitor input cursor position and text
- Detect potential column references (word at cursor)
- Show popover with filtered column list
- Support Cmd+. to force show all columns
- Keyboard navigation (Arrow keys, Enter, Esc)
- Insert column name at cursor position with proper quoting

Interface:

```typescript
interface UseQuickFilterAutocompleteResult {
  suggestions: Array<{ name: string; type: string }>;
  showSuggestions: boolean;
  selectedIndex: number;
  popoverPosition: { top: number; left: number } | null;
  handleKeyDown: (e: React.KeyboardEvent) => boolean; // true if handled
  selectSuggestion: (index: number) => void;
  closeSuggestions: () => void;
}
```

### 5. Integrate into TableDataGridV2

**File**: `src/components/DataGridV2/adapters/TableDataGridV2.tsx`

Changes needed:

1. Add filter state (session-based, not persisted):
   ```typescript
   const [quickFilterValue, setQuickFilterValue] = useState<string>("");
   const [quickFilterMode, setQuickFilterMode] = useState<FilterMode>('where');
   ```

2. Parse filter and merge with existing filters:
   ```typescript
   const quickFilter = useMemo(() => {
     if (!quickFilterValue.trim()) return null;
     
     switch (quickFilterMode) {
       case 'search':
         return parseSimpleSearch(quickFilterValue, columnMeta);
       case 'where':
         const result = parseWhereClause(quickFilterValue, columnMeta);
         return result.success ? result.filter : null;
       case 'ai':
         // Handled separately via useAIFilter hook
         return null;
     }
   }, [quickFilterValue, quickFilterMode, columnMeta]);
   ```

3. Pass merged filter to `useTableDataQuery`:
   ```typescript
   const tableDataQuery = useTableDataQuery({
     // ... existing params
     filters: quickFilter || undefined,
   });
   ```

4. Update layout structure:
   ```tsx
   return (
     <div className="flex flex-col h-full">
       {/* QuickFilter toolbar - only in table mode */}
       {isTableMode && (
         <div className="flex-none border-b px-2 py-1">
           <QuickFilter
             columns={columnMeta}
             value={quickFilterValue}
             mode={quickFilterMode}
             onValueChange={setQuickFilterValue}
             onModeChange={setQuickFilterMode}
             onFilterApply={handleFilterApply}
           />
         </div>
       )}
       
       {/* Existing grid + status bar */}
       <div className="flex-1 min-h-0">
         <EditableDataGrid ... />
       </div>
       <DataGridStatusBar ... />
     </div>
   );
   ```


### 6. Add Keyboard Shortcuts

**File**: `src/components/DataGridV2/adapters/TableDataGridV2.tsx`

Register shortcuts using existing `useCommand` hook:

- **`Cmd+Shift+F`** / **`Ctrl+Shift+F`**: Focus quick filter input (only when grid is focused)
- **`Escape`**: Clear filter and blur input (when input is focused)
- **`Cmd+.`**: Show column suggestions (when input is focused)

Implementation:

```typescript
useCommand(
  'dataGrid.action.focusQuickFilter',
  () => {
    quickFilterInputRef.current?.focus();
  },
  {
    label: 'Focus Quick Filter',
    category: 'Data Grid',
    when: 'dataGridFocus',
  }
);
```

### 7. Handle Empty Results State

**File**: `src/components/DataGridV2/adapters/TableDataGridV2.tsx`

Update empty state rendering logic:

```typescript
if (!isLoading && rowsRef.current.length === 0) {
  // Check if filter is active
  if (quickFilterValue.trim()) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">
          No results found for filter: <code>{quickFilterValue}</code>
        </p>
        <Button onClick={() => setQuickFilterValue('')}>
          Clear Filter
        </Button>
      </div>
    );
  }
  
  return <DataGridEmptyState />;
}
```

## Technical Details

### Filter Parser Examples

**Simple Search Mode (?)**:

```typescript
Input: "john"
Output FilterConfig: {
  root: {
    id: 'root',
    type: 'group',
    logical: 'OR',
    conditions: [
      { id: '1', column: 'name', operator: 'ILIKE', value: '%john%' },
      { id: '2', column: 'email', operator: 'ILIKE', value: '%john%' },
      { id: '3', column: 'description', operator: 'ILIKE', value: '%john%' },
      // ... for all text/varchar columns
    ]
  }
}
```

**WHERE Clause Mode** (simple expressions):

```typescript
Input: "age > 25 AND status = 'active'"
Output FilterConfig: {
  root: {
    id: 'root',
    type: 'group',
    logical: 'AND',
    conditions: [
      { id: '1', column: 'age', operator: '>', value: 25 },
      { id: '2', column: 'status', operator: '=', value: 'active' }
    ]
  }
}
```

**AI Mode (#)**:

```
Input: "show active users from last month"
AI Response: "created_at > NOW() - INTERVAL '1 month' AND status = 'active'"
→ Validate columns exist
→ Parse as WHERE clause
→ Apply filter
```

### UI/UX Details

**Mode Selector Dropdown**:

- Button shows: `?` (Search), `</>` (WHERE), or `#` (AI)
- Click opens small menu with 3 options:
  - 🔍 Simple Search - Match any column
  - 💻 WHERE Clause - SQL expressions  
  - ✨ AI Assistant - Natural language

**Placeholder Text** (changes per mode):

- Search: "Search all columns..."
- WHERE: "e.g., age > 25 AND status = 'active'"
- AI: "Describe what you want to filter..."

**Visual States**:

- Active filter: Input border changes to accent color
- Loading (AI): Spinner shown, input slightly dimmed
- Error: Red border + error message below input
- Success: Brief green flash on border after valid filter applied

**Column Autocomplete**:

- Triggered automatically after 1+ chars typed
- Or manually with Cmd+.
- Shows: `column_name (TYPE)` in dropdown
- Inserts with proper quoting for special chars

## Files to Create

1. **`src/utils/filterParser.ts`** - Parser and validation logic (~300 lines)
2. **`src/components/DataGridV2/components/QuickFilter.tsx`** - Main UI component (~250 lines)
3. **`src/components/DataGridV2/hooks/useAIFilter.ts`** - AI integration hook (~100 lines)
4. **`src/components/DataGridV2/hooks/useQuickFilterAutocomplete.ts`** - Column suggestions (~150 lines)

## Files to Modify

1. **`src/components/DataGridV2/adapters/TableDataGridV2.tsx`** - Add filter state, toolbar, empty state handling (~100 lines changed)

## Testing Strategy

**Unit Tests**:

- Test `parseSimpleSearch` with various column types
- Test `parseWhereClause` with valid and invalid expressions
- Test `validateWhereClause` error detection

**Integration Tests**:

- Verify mode switching updates placeholder
- Verify column autocomplete shows correct columns
- Verify filter triggers server refetch (check network)
- Verify empty results shows correct message
- Verify AI mode error handling

**Edge Cases**:

- Very long filter expressions
- Special characters in column names
- AI returns invalid response
- Rapid mode switching
- Filter during data streaming

### To-dos

- [ ] Create filterParser.ts with parsing, validation for all 3 modes
- [ ] Build QuickFilter.tsx UI component with mode indicator and input
- [ ] Create useAIFilter.ts hook for AI-assisted filtering
- [ ] Build useQuickFilterAutocomplete.ts for column suggestions
- [ ] Integrate QuickFilter into TableDataGridV2 with state management
- [ ] Add Cmd+F and Cmd+. keyboard shortcuts for filter
- [ ] Test all 3 filter modes with various inputs and edge cases