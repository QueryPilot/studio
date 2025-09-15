# Custom Cell Implementation Plan for DataGrid

## Executive Summary

This document outlines the comprehensive plan for implementing custom cell renderers and editors in the DataGrid component. The goal is to create a type-aware, interactive data grid that leverages database metadata to provide specialized rendering and editing capabilities for different data types.

### Key Features

- **Context-Aware Hover Actions**: Cells display contextual action buttons on hover with type-specific icons
- **Type-Specific Rendering**: Each database type gets a tailored visual representation (badges for booleans, calendars for dates, etc.)
- **Smart Editing**: Inline editors using shadcn/ui components that match the data type
- **Nullable Support**: All cells properly handle NULL values with appropriate UI
- **Foreign Key Navigation**: Direct navigation to referenced records from cells

## Current State Analysis

### Existing Infrastructure

- **Library**: `@glideapps/glide-data-grid` (in use) and `@glideapps/glide-data-grid-cells` (installed but not wired)
- **Wrapper**: `EnhancedGlideWrapper` with virtual scrolling, context menu, copy as CSV/JSON
- **Type System**: Basic mapping in `getGridCellKind()` and `cellValueToGridCell` (renders Text/Number/Boolean only)
- **UI Components**: Full shadcn/ui component library available

### Critical Gaps

1. **No Cell Editing**: No `Custom` cells or `provideEditor` implementations are in use; only read-only Text/Number/Boolean
2. **No Metadata Pipeline**: Column metadata (e.g., `enum_values`, `is_fk`, `is_json`, `nullable`) isn’t propagated to cells
3. **Custom Renderers Not Wired**: No `customRenderers` passed to `DataEditor`; `glide-data-grid-cells` and any custom cells are unused
4. **Validation Missing**: No validation layer for edits
5. **Dead Code**: `GlideDataGridWrapper` is unused and should be removed

## Architecture Design

### Leveraging @glideapps/glide-data-grid-cells

We'll wire `@glideapps/glide-data-grid-cells` and extend with database-specific functionality, exposing a `useDatabaseCells()` hook and a renderer registry. `EnhancedGlideWrapper` will pass `customRenderers` to `DataEditor`.

#### Available Pre-built Cells to Use

- **StarCell** → Can adapt for rating columns
- **SparklineCell** → For numeric trend data
- **DropdownCell** → Base for our ENUM/SET cells
- **RangeCell** → For numeric ranges
- **TagsCell** → For array/set columns
- **UserProfileCell** → For user/contact columns

#### Our Extensions

```typescript
// src/components/DataGrid/glide/cells/index.ts
import {
  DropdownCell as BaseDropdownCell,
  TagsCell as BaseTagsCell,
  useExtraCells,
} from "@glideapps/glide-data-grid-cells";

// Extend base cells with database awareness
export const DatabaseDropdownCell = {
  ...BaseDropdownCell,
  // Add null handling
  // Add enum_values from ColumnMeta
  // Add hover actions
};

export const BooleanCell = {
  ...BaseDropdownCell, // Reuse dropdown logic
  // Custom badge rendering
  // Fixed options: TRUE/FALSE/NULL
  // Hover actions with dropdown icon
};

// Combine all cells
export const useDatabaseCells = () => {
  const { customRenderers: baseCells } = useExtraCells();

  return {
    customRenderers: [
      ...baseCells,
      BooleanCell,
      DateCell,
      DateTimeCell,
      JsonCell,
      ForeignKeyCell,
      // ... our custom cells
    ],
  };
};
```

### Hover Actions System

Each cell will display contextual action buttons on hover, positioned at the right edge of the cell. The buttons appear based on cell type and data state.

```typescript
// src/components/DataGrid/glide/cells/hoverActions.ts
export interface HoverAction {
  id: "edit" | "copy" | "navigate";
  icon: React.ComponentType;
  tooltip: string;
  visible: (cell: CustomCell) => boolean;
  onClick: (cell: CustomCell, coords: { x: number; y: number }) => void;
}

export const getHoverActions = (cell: CustomCell): HoverAction[] => {
  const actions: HoverAction[] = [];
  const { kind, value, metadata } = cell.data;

  // Edit action - always visible, icon varies by type
  actions.push({
    id: "edit",
    icon: getEditIcon(kind),
    tooltip: "Edit",
    visible: () => !cell.readonly,
    onClick: (cell) => triggerCellEdit(cell),
  });

  // Copy action - only if has value
  if (value !== null && value !== undefined && value !== "") {
    actions.push({
      id: "copy",
      icon: Copy,
      tooltip: "Copy value",
      visible: () => true,
      onClick: (cell) => copyToClipboard(cell.data.value),
    });
  }

  // Navigate action - only for foreign keys
  if (metadata?.is_fk && value) {
    actions.push({
      id: "navigate",
      icon: ArrowUpRight,
      tooltip: "Navigate to referenced record",
      visible: () => true,
      onClick: (cell) => navigateToReference(cell),
    });
  }

  return actions;
};

export const getEditIcon = (cellKind: string): React.ComponentType => {
  const iconMap = {
    "enum-cell": ChevronDown,
    "select-cell": ChevronDown,
    "date-cell": Calendar,
    "datetime-cell": Calendar,
    "time-cell": Clock,
    "boolean-cell": ChevronDown,
    "json-cell": Code,
    "lookup-cell": Search,
    default: Pencil,
  };

  return iconMap[cellKind] || iconMap.default;
};
```

### Cell Renderer Registry Pattern

```typescript
// src/components/DataGrid/glide/cellRegistry.ts
export class CellRendererRegistry {
  private renderers: Map<string, CustomRenderer>;

  register(typePattern: string | RegExp, renderer: CustomRenderer): void;
  getRenderer(column: ColumnMeta): CustomRenderer;
  getPriority(dbType: string): number;
}
```

### Type-to-Renderer Mapping

| Database Type           | Cell Renderer  | shadcn Component     | Features                                        | Hover Actions                      |
| ----------------------- | -------------- | -------------------- | ----------------------------------------------- | ---------------------------------- |
| `ENUM`/`SET`            | `SelectCell`   | `Select`             | Dropdown with predefined values, NULL option    | Edit (dropdown icon), Copy         |
| `BOOLEAN`/`BIT`         | `BooleanCell`  | `Select`             | TRUE/FALSE/NULL badges, dropdown editor         | Edit (dropdown icon), Copy         |
| `DATE`                  | `DateCell`     | `Calendar`           | Date picker with format options, clear for NULL | Edit (calendar icon), Copy         |
| `DATETIME`/`TIMESTAMP`  | `DateTimeCell` | `Calendar` + Time    | Combined picker with NULL support               | Edit (calendar icon), Copy         |
| `TIME`                  | `TimeCell`     | Custom time input    | Hour/minute/second with NULL                    | Edit (clock icon), Copy            |
| `JSON`/`JSONB`          | `JsonCell`     | `Textarea`           | Syntax highlighting, validation, NULL as empty  | Edit (code icon), Copy             |
| `TEXT`/`LONGTEXT`       | `TextAreaCell` | `Textarea`           | Multi-line editing with NULL                    | Edit (pencil icon), Copy           |
| `INT`/`DECIMAL`/`FLOAT` | `NumberCell`   | `Input[type=number]` | Min/max, precision, NULL support                | Edit (pencil icon), Copy           |
| `UUID`                  | `UuidCell`     | `Input` + copy       | Read-only with copy button                      | Copy only                          |
| `FOREIGN KEY`           | `LookupCell`   | `Command`            | Searchable dropdown, NULL option                | Edit (search icon), Copy, Navigate |
| `BINARY`/`BLOB`         | `BinaryCell`   | Custom               | Preview/download, NULL display                  | Download, Copy (hash)              |
| `ARRAY`                 | `ArrayCell`    | Custom list          | Add/remove items, empty for NULL                | Edit (pencil icon), Copy           |

## Implementation Phases

### Phase 0: Install Dependencies (Day 1)

```bash
# Install the cells package
pnpm add @glideapps/glide-data-grid-cells

# Install additional dependencies for advanced cells
pnpm add react-day-picker  # For date picker if not using shadcn Calendar
```

### Phase 1: Core Infrastructure (Week 1)

#### 1.1 Cell Registry System

```typescript
// src/components/DataGrid/glide/cells/base.ts
export interface CustomCellProps<T = any> {
  kind: string;
  value: T;
  metadata: ColumnMeta;
  readonly?: boolean;
  validation?: ValidationRule[];
  hoverPosition?: { x: number; y: number };
  isHovered?: boolean;
}

export abstract class BaseCustomCell<T> {
  abstract kind: string;
  needsHover = true;
  needsHoverPosition = true;

  abstract draw(args: DrawArgs, cell: CustomCell<T>): boolean;
  abstract provideEditor(cell: CustomCell<T>): EditorComponent;
  abstract validate(value: T, metadata: ColumnMeta): ValidationResult;

  // Draw hover buttons on canvas
  drawHoverButtons(
    args: DrawArgs,
    cell: CustomCell<T>,
    actions: HoverAction[],
  ): void {
    const { ctx, rect, theme, hoverX = 0 } = args;
    const buttonSize = 20;
    const buttonSpacing = 4;
    const totalWidth =
      actions.length * buttonSize + (actions.length - 1) * buttonSpacing;

    let x = rect.x + rect.width - totalWidth - 8;
    const y = rect.y + (rect.height - buttonSize) / 2;

    actions.forEach((action, index) => {
      const buttonX = x + index * (buttonSize + buttonSpacing);

      // Check if mouse is over this button
      const isHoveredButton =
        hoverX >= buttonX && hoverX <= buttonX + buttonSize;

      // Draw button background
      ctx.fillStyle = isHoveredButton ? theme.accentLight : theme.bgIconHeader;
      ctx.strokeStyle = theme.borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(buttonX, y, buttonSize, buttonSize, 3);
      ctx.fill();
      ctx.stroke();

      // Draw icon (simplified representation)
      ctx.fillStyle = isHoveredButton ? theme.accentColor : theme.textMedium;
      ctx.font = "12px " + theme.fontFamily;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Icon representation (in real implementation, use icon paths)
      const iconChar = this.getIconChar(action.id);
      ctx.fillText(iconChar, buttonX + buttonSize / 2, y + buttonSize / 2);
    });
  }

  getIconChar(actionId: string): string {
    const chars = {
      edit: "✎",
      copy: "⊡",
      navigate: "↗",
    };
    return chars[actionId] || "?";
  }

  onClick(args: GridMouseEventArgs): GridMouseEventArgs | undefined {
    const { bounds, location } = args;
    const actions = getHoverActions(args.cell);

    // Calculate button positions and check for clicks
    const buttonSize = 20;
    const buttonSpacing = 4;
    const totalWidth =
      actions.length * buttonSize + (actions.length - 1) * buttonSpacing;

    let x = bounds.x + bounds.width - totalWidth - 8;
    const y = bounds.y + (bounds.height - buttonSize) / 2;

    for (let i = 0; i < actions.length; i++) {
      const buttonX = x + i * (buttonSize + buttonSpacing);

      if (
        location.x >= buttonX &&
        location.x <= buttonX + buttonSize &&
        location.y >= y &&
        location.y <= y + buttonSize
      ) {
        actions[i].onClick(args.cell, { x: location.x, y: location.y });
        return args; // Consume the click
      }
    }

    return undefined; // Let click pass through
  }
}
```

#### 1.2 Editor Wrapper Component

```typescript
// src/components/DataGrid/glide/cells/EditorWrapper.tsx
export const EditorWrapper: React.FC<{
  cell: CustomCell;
  onSave: (value: any) => void;
  onCancel: () => void;
}> = ({ cell, onSave, onCancel }) => {
  return (
    <Popover open onOpenChange={(open) => !open && onCancel()}>
      <PopoverContent className="p-0" align="start">
        {/* Dynamic editor component based on cell type */}
      </PopoverContent>
    </Popover>
  );
};
```

#### 1.3 Update Type Mapping

```typescript
// src/components/DataGrid/glide/types.ts
export const getCellRenderer = (column: ColumnMeta): string => {
  const { db_type, enum_values, is_fk, is_json } = column;

  if (enum_values?.length) return "enum-cell";
  if (is_fk) return "lookup-cell";
  if (is_json) return "json-cell";

  const typeMap = {
    boolean: "boolean-cell",
    date: "date-cell",
    datetime: "datetime-cell",
    timestamp: "datetime-cell",
    time: "time-cell",
    text: "textarea-cell",
    uuid: "uuid-cell",
    // ... more mappings
  };

  return typeMap[db_type.toLowerCase()] || "text-cell";
};
```

### Phase 2: Basic Cell Types (Week 2)

#### 2.1 Boolean Cell

```typescript
// src/components/DataGrid/glide/cells/BooleanCell.tsx
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Copy } from "lucide-react";

export const BooleanCell: CustomRenderer<BooleanCellProps> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is BooleanCell => c.data.kind === "boolean-cell",
  needsHover: true,
  needsHoverPosition: true,

  draw: (args, cell) => {
    const { ctx, rect, theme, hoverAmount = 0, hoverX = 0 } = args;
    const { value } = cell.data;

    // Draw badge-style visualization
    const text = value === null ? "NULL" : value ? "TRUE" : "FALSE";
    const bgColor =
      value === null
        ? theme.textLight
        : value
        ? "#10b981" // green for true
        : "#ef4444"; // red for false

    // Measure text
    ctx.font = "11px " + theme.fontFamily;
    const metrics = ctx.measureText(text);
    const badgeWidth = metrics.width + 12;
    const badgeHeight = 18;

    const x = rect.x + 8;
    const y = rect.y + (rect.height - badgeHeight) / 2;

    // Draw badge background
    ctx.fillStyle = bgColor + "20"; // 20% opacity
    ctx.strokeStyle = bgColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, badgeWidth, badgeHeight, 4);
    ctx.fill();
    ctx.stroke();

    // Draw text
    ctx.fillStyle = bgColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + badgeWidth / 2, y + badgeHeight / 2);

    // Draw hover buttons if cell is hovered
    if (hoverAmount > 0) {
      const actions = [];
      const buttonSize = 20;
      const buttonSpacing = 4;

      // Edit button (dropdown icon for boolean)
      actions.push({ id: "edit", icon: "▼" });

      // Copy button (only if has value)
      if (value !== null) {
        actions.push({ id: "copy", icon: "⊡" });
      }

      // Draw buttons
      let buttonX = rect.x + rect.width - 8;

      actions.reverse().forEach((action) => {
        buttonX -= buttonSize;

        // Check if mouse is over this button
        const isHoveredButton =
          hoverX >= buttonX && hoverX <= buttonX + buttonSize;

        // Draw button with opacity based on hover
        ctx.globalAlpha = 0.3 + (isHoveredButton ? 0.4 : 0) + hoverAmount * 0.3;

        // Button background
        ctx.fillStyle = isHoveredButton
          ? theme.accentLight
          : theme.bgIconHeader;
        ctx.fillRect(
          buttonX,
          rect.y + (rect.height - buttonSize) / 2,
          buttonSize,
          buttonSize,
        );

        // Button icon
        ctx.fillStyle = theme.textDark;
        ctx.font = "11px " + theme.fontFamily;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          action.icon,
          buttonX + buttonSize / 2,
          rect.y + rect.height / 2,
        );

        ctx.globalAlpha = 1;
        buttonX -= buttonSpacing;
      });
    }

    return true;
  },

  onClick: (args) => {
    const { bounds, location, cell } = args;
    const { value } = cell.data;

    // Check if click is on any hover button
    const buttonSize = 20;
    const buttonSpacing = 4;
    const actions = [];

    actions.push({ id: "edit" });
    if (value !== null) actions.push({ id: "copy" });

    let buttonX = bounds.x + bounds.width - 8;

    for (const action of actions.reverse()) {
      buttonX -= buttonSize;

      if (
        location.x >= buttonX &&
        location.x <= buttonX + buttonSize &&
        location.y >= bounds.y + (bounds.height - buttonSize) / 2 &&
        location.y <= bounds.y + (bounds.height + buttonSize) / 2
      ) {
        if (action.id === "edit") {
          // Trigger edit mode
          return { ...args, preventDefault: () => {} };
        } else if (action.id === "copy") {
          // Copy to clipboard
          navigator.clipboard.writeText(String(value));
          return { ...args, preventDefault: () => {} };
        }
      }

      buttonX -= buttonSpacing;
    }

    return undefined;
  },

  provideEditor: () => ({
    editor: (props) => {
      const options = [
        { value: "true", label: "TRUE", variant: "success" },
        { value: "false", label: "FALSE", variant: "destructive" },
        { value: "null", label: "NULL", variant: "secondary" },
      ];

      const currentValue =
        props.value.data.value === null
          ? "null"
          : String(props.value.data.value);

      return (
        <div className="p-2 min-w-[150px]">
          <Select
            value={currentValue}
            onValueChange={(value) => {
              const newValue = value === "null" ? null : value === "true";

              props.onChange({
                ...props.value,
                data: { ...props.value.data, value: newValue },
              });
            }}
          >
            <SelectTrigger className="w-full h-8">
              <SelectValue>
                {options.find((o) => o.value === currentValue)?.label ||
                  "Select..."}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <Badge variant={option.variant} className="text-xs">
                    {option.label}
                  </Badge>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    },
    disablePadding: true,
  }),
};
```

#### 2.2 Date Cell

```typescript
// src/components/DataGrid/glide/cells/DateCell.tsx
export const DateCell: CustomRenderer<DateCellProps> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is DateCell => c.data.kind === "date-cell",

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value, format = "yyyy-MM-dd" } = cell.data;

    const formatted = value ? formatDate(value, format) : "NULL";

    ctx.fillStyle = value ? theme.textDark : theme.textLight;
    ctx.fillText(
      formatted,
      rect.x + theme.cellHorizontalPadding,
      rect.y + rect.height / 2,
    );

    return true;
  },

  provideEditor: () => ({
    editor: (props) => (
      <Calendar
        mode="single"
        selected={props.value.data.value}
        onSelect={(date) => {
          props.onChange({
            ...props.value,
            data: { ...props.value.data, value: date },
          });
        }}
      />
    ),
    disablePadding: true,
  }),
};
```

#### 2.3 Enum/Select Cell (Extending DropdownCell)

```typescript
// src/components/DataGrid/glide/cells/EnumCell.tsx
import { DropdownCell } from "@glideapps/glide-data-grid-cells";

export const EnumCell: CustomRenderer<EnumCellProps> = {
  ...DropdownCell, // Inherit base functionality
  kind: GridCellKind.Custom,
  isMatch: (c): c is EnumCell => c.data.kind === "enum-cell",

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    // Draw value with dropdown indicator
    ctx.fillStyle = theme.textDark;
    ctx.fillText(
      value || "Select...",
      rect.x + theme.cellHorizontalPadding,
      rect.y + rect.height / 2,
    );

    // Draw dropdown arrow
    const arrowX = rect.x + rect.width - 20;
    const arrowY = rect.y + rect.height / 2;
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY - 3);
    ctx.lineTo(arrowX + 6, arrowY - 3);
    ctx.lineTo(arrowX + 3, arrowY + 3);
    ctx.closePath();
    ctx.fill();

    return true;
  },

  provideEditor: () => ({
    editor: (props) => {
      const { enum_values } = props.value.data.metadata;

      return (
        <Select
          value={props.value.data.value}
          onValueChange={(value) => {
            props.onChange({
              ...props.value,
              data: { ...props.value.data, value },
            });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {enum_values?.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    },
    disablePadding: false,
  }),
};
```

### Phase 3: Advanced Cell Types (Week 3)

#### 3.1 JSON Cell with Syntax Highlighting

```typescript
// src/components/DataGrid/glide/cells/JsonCell.tsx
export const JsonCell: CustomRenderer<JsonCellProps> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is JsonCell => c.data.kind === "json-cell",

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    // Draw JSON badge
    ctx.fillStyle = theme.accentLight;
    ctx.fillRect(rect.x + 4, rect.y + 4, 35, 20);
    ctx.fillStyle = theme.accentColor;
    ctx.font = "10px monospace";
    ctx.fillText("JSON", rect.x + 8, rect.y + 16);

    // Draw truncated value
    const jsonStr = JSON.stringify(value, null, 2);
    const truncated = jsonStr.substring(0, 50) + "...";
    ctx.fillStyle = theme.textDark;
    ctx.font = theme.baseFontStyle;
    ctx.fillText(truncated, rect.x + 45, rect.y + rect.height / 2);

    return true;
  },

  provideEditor: () => ({
    editor: (props) => (
      <div className="p-4 min-w-[400px]">
        <Textarea
          className="font-mono text-xs"
          rows={15}
          value={JSON.stringify(props.value.data.value, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              props.onChange({
                ...props.value,
                data: { ...props.value.data, value: parsed },
              });
            } catch {
              // Invalid JSON, don't update
            }
          }}
        />
      </div>
    ),
    disablePadding: true,
  }),
};
```

#### 3.2 Foreign Key Lookup Cell

```typescript
// src/components/DataGrid/glide/cells/LookupCell.tsx
export const LookupCell: CustomRenderer<LookupCellProps> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is LookupCell => c.data.kind === "lookup-cell",

  provideEditor: () => ({
    editor: (props) => {
      const [options, setOptions] = useState([]);
      const [loading, setLoading] = useState(false);

      useEffect(() => {
        const loadOptions = async () => {
          setLoading(true);
          const { fk_reference } = props.value.data.metadata;
          const data = await databaseService.getTableData({
            table: fk_reference.referenced_table,
            schema: fk_reference.referenced_schema,
            limit: 100,
          });
          setOptions(data.rows);
          setLoading(false);
        };
        loadOptions();
      }, []);

      return (
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            {loading && <CommandLoading />}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  onSelect={(value) => {
                    props.onChange({
                      ...props.value,
                      data: { ...props.value.data, value },
                    });
                  }}
                >
                  {option.display_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      );
    },
    disablePadding: true,
  }),
};
```

### Phase 4: Integration & Optimization (Week 4)

#### 4.1 Wire Up Registry in DataGrid

```typescript
// src/components/DataGrid/glide/GlideTableDataGrid.tsx
import { useDatabaseCells } from './cells';
import { useExtraCells } from "@glideapps/glide-data-grid-cells";

const GlideTableDataGrid = () => {
  // Combine base cells with our custom database cells
  const { customRenderers: baseCells } = useExtraCells();
  const { customRenderers: dbCells } = useDatabaseCells();

  const customRenderers = [
    ...baseCells,  // Star, Sparkline, Tags, etc.
    ...dbCells,    // Boolean, Date, Foreign Key, etc.
  ];

  // src/components/DataGrid/glide/EnhancedGlideWrapper.tsx
  <DataEditor customRenderers={customRenderers} />

// Update getCellContent to use custom renderers
const getCellContent = useCallback((cell: Item): GridCell => {
  const [col, row] = cell;
  const column = columns[col]; // enriched ColumnMeta
  const value = rows[row]?.[column.name];

  const rendererType = getCellRenderer(column);

  return {
    kind: GridCellKind.Custom,
    allowOverlay: true,
    copyData: String((value as any)?.value ?? value ?? ''),
    data: {
      kind: rendererType,
      value: (value as any)?.value ?? value,
      metadata: column,
    },
  };
}, [columns, rows]);
```

#### 4.2 Performance Optimizations

```typescript
// Lazy load editor components
const editorComponents = lazy(() => import("./cells/editors"));

// Memoize cell renderers
const memoizedRenderers = useMemo(
  () =>
    Array.from(cellRegistry.getAll()).map((renderer) =>
      memoizeRenderer(renderer),
    ),
  [cellRegistry],
);

// Implement renderer caching
const rendererCache = new Map<string, CustomRenderer>();
```

## Validation Framework

```typescript
// src/components/DataGrid/glide/validation.ts
export interface ValidationRule {
  type: "required" | "pattern" | "range" | "custom";
  message: string;
  validate: (value: any, metadata: ColumnMeta) => boolean;
}

export class CellValidator {
  static validate(value: any, column: ColumnMeta): ValidationResult {
    const rules: ValidationRule[] = [];

    // Add rules based on column metadata
    if (!column.nullable) {
      rules.push({
        type: "required",
        message: "This field is required",
        validate: (v) => v !== null && v !== undefined && v !== "",
      });
    }

    if (column.check_constraint) {
      rules.push({
        type: "custom",
        message: "Value violates check constraint",
        validate: (v) => evaluateConstraint(v, column.check_constraint),
      });
    }

    // Run all validations
    for (const rule of rules) {
      if (!rule.validate(value, column)) {
        return { valid: false, error: rule.message };
      }
    }

    return { valid: true };
  }
}
```

## Hover Actions Implementation Details

### Visual Design

- Buttons appear on hover with smooth opacity transition
- Positioned at the right edge of the cell with 8px padding
- 20x20px button size with 4px spacing between buttons
- Semi-transparent background that becomes more opaque on direct hover

### Button Order (Left to Right)

1. **Edit Button**: Always visible when cell is editable

   - Pencil icon (default)
   - Dropdown/ChevronDown for select-type cells (enum, boolean)
   - Calendar for date cells
   - Clock for time cells
   - Code icon for JSON cells
   - Search icon for lookup cells

2. **Copy Button**: Only visible when cell has a value (not null/empty)

   - Copy icon
   - Copies raw value to clipboard

3. **Navigate Button**: Only visible for foreign key references with values
   - Arrow-up-right icon
   - Opens referenced record in new tab/panel

### Interaction Flow

1. User hovers over cell → buttons fade in
2. User hovers over specific button → button highlights
3. User clicks button → action triggered
4. Edit button click → opens inline editor
5. Copy button click → copies value, shows toast
6. Navigate button click → navigates to referenced record

### Keyboard Shortcuts

- **F2** or **Enter** on focused cell → Open editor
- **Escape** in editor → Cancel edit
- **Tab** in editor → Save and move to next cell
- **Ctrl/Cmd + C** on focused cell → Copy value
- **Ctrl/Cmd + Enter** on foreign key cell → Navigate to reference

### Canvas Drawing Optimization

```typescript
// Optimized button drawing with caching
const buttonCache = new Map<string, ImageData>();

function drawButton(
  ctx: CanvasRenderingContext2D,
  action: HoverAction,
  x: number,
  y: number,
) {
  const cacheKey = `${action.id}-${x}-${y}`;

  if (buttonCache.has(cacheKey)) {
    ctx.putImageData(buttonCache.get(cacheKey), x, y);
  } else {
    // Draw button and cache
    const imageData = ctx.getImageData(x, y, 20, 20);
    buttonCache.set(cacheKey, imageData);
  }
}
```

## Testing Strategy

### Unit Tests

- Test each cell renderer's draw method
- Test editor component interactions
- Test validation rules for each type
- Test registry pattern and type matching

### Integration Tests

- Test cell editing workflow end-to-end
- Test keyboard navigation between cells
- Test copy/paste operations
- Test undo/redo functionality

### Performance Tests

- Measure render performance with 10,000+ cells
- Test scrolling performance
- Test editor open/close performance
- Memory leak testing for editor components

## Migration Plan

1. **Preparation**: Create feature flag for new cell system
2. **Gradual Rollout**: Enable for specific tables/columns first
3. **Monitoring**: Track performance metrics and errors
4. **Feedback Loop**: Gather user feedback on new editors
5. **Full Migration**: Remove old TextCellRenderer once stable

## Success Metrics

- **User Engagement**: 50% increase in cell edit operations
- **Performance**: <16ms render time for 95% of cells
- **Data Quality**: 30% reduction in invalid data entries
- **Developer Velocity**: 60% faster to add new cell types

## Risk Mitigation

| Risk                            | Impact | Mitigation                                            |
| ------------------------------- | ------ | ----------------------------------------------------- |
| Performance degradation         | High   | Canvas rendering, virtual scrolling, lazy loading     |
| Breaking existing functionality | High   | Feature flags, gradual rollout, comprehensive testing |
| Complex validation logic        | Medium | Validation framework with clear error messages        |
| Browser compatibility           | Low    | Test on all major browsers, polyfills where needed    |

## Timeline

- **Week 1**: Core infrastructure and registry system
- **Week 2**: Basic cell types (boolean, date, enum, number)
- **Week 3**: Advanced cells (JSON, foreign key, array)
- **Week 4**: Integration, optimization, and testing
- **Week 5**: Documentation and deployment

## Implementation Strategy with @glideapps/glide-data-grid-cells

### Advantages of Using the Package

1. **Proven Components**: Battle-tested cells with proper editor implementations
2. **Reduced Development Time**: Reuse DropdownCell for enums/booleans, TagsCell for arrays
3. **Consistent API**: All cells follow the same CustomRenderer interface
4. **Maintained**: Regular updates from Glide team

### Our Value-Add Extensions

1. **Database Awareness**: Integrate ColumnMeta for constraints and validation
2. **Null Handling**: All cells support NULL values properly
3. **Hover Actions**: Context-aware buttons for edit/copy/navigate
4. **Type-Specific Icons**: Visual cues for different data types
5. **Foreign Key Navigation**: Direct links to referenced records

### Migration Path

1. Install and integrate base cells package
2. Extend existing cells with database features
3. Add custom cells for missing types (DateTime, JSON, etc.)
4. Implement hover action system on top
5. Add validation layer using column metadata

## Conclusion

This implementation plan provides a comprehensive roadmap for transforming the DataGrid from a read-only viewer into a fully interactive, type-aware data management tool. By leveraging both the `@glideapps/glide-data-grid-cells` package and shadcn/ui components, we can rapidly build a best-in-class editing experience that respects database constraints and provides intuitive interfaces for each data type.
