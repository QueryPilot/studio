# Status Bar Streaming Design

## Visual Layout

### While Streaming (Loading More)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Left Side                    │ Right Side                           │
│ • 3 pending changes          │ 🔄 Streaming 19% ▓▓▓▓░░░░ • 2,496 / │
│ • 5 rows selected            │   12,887 rows • 145ms                │
└─────────────────────────────────────────────────────────────────────┘
```

### Completed Loading

```
┌─────────────────────────────────────────────────────────────────────┐
│ Left Side                    │ Right Side                           │
│ • 3 pending changes          │ 12,887 rows • 2,341ms                │
│ • 5 rows selected            │                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Initial Load (First Page)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Left Side                    │ Right Side                           │
│                              │ 🔄 Streaming 2% ▓░░░░░░░ • 300 /    │
│                              │   12,887 rows • 89ms                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### Status Bar Elements (Left to Right)

**Left Section:**

1. **Pending Edits** (amber) - Shows unsaved changes

   - "3 pending changes"
   - Only shown when `pendingEdits > 0`

2. **Selected Rows** (primary color) - Shows selection
   - "5 rows selected"
   - Only shown when `selectedRows > 0`

**Right Section (Streaming Active):**

1. **Spinner Icon** - Animated loader (3x3 px)
2. **Progress Text** - "Streaming 19%"
3. **Progress Bar** - Visual indicator (24px wide, 1px tall)
4. **Separator** - "•"
5. **Row Count** - "2,496 / 12,887 rows"
6. **Separator** - "•"
7. **Execution Time** - "145ms"

**Right Section (Completed):**

1. **Row Count** - "12,887 rows"
2. **Separator** - "•"
3. **Execution Time** - "2,341ms"

---

## States

### 1. Initial Empty

- No data loaded yet
- Shows: "0 rows"

### 2. Initial Streaming (First Page)

- Loading first page (0 → 300 rows)
- Shows: "🔄 Streaming 2% ▓░░░ • 156 / 12,887 rows"
- Updates in real-time as batches arrive

### 3. First Page Complete

- Initial 300 rows loaded
- Shows: "300 / 12,887 rows • 145ms"
- User can scroll to trigger next page

### 4. Streaming Additional Pages

- User scrolled down, loading more
- Shows: "🔄 Streaming 19% ▓▓▓▓░░░ • 2,496 / 12,887 rows"
- Progress bar animates smoothly

### 5. All Data Loaded

- All 12,887 rows loaded
- Shows: "12,887 rows • 2,341ms"
- No more streaming indicator

### 6. With Pending Edits

- User made changes
- Shows: "3 pending changes • 12,887 rows • 2,341ms"

### 7. With Selection + Edits

- User selected rows and made changes
- Shows: "3 pending changes • 5 rows selected • 12,887 rows"

---

## Progress Calculation

```typescript
const getProgressPercentage = () => {
  if (!estimatedTotal || estimatedTotal === 0) return 0;
  return Math.min(Math.round((loadedRows / estimatedTotal) * 100), 99);
};
```

**Examples:**

- 156 / 12,887 rows = 1%
- 2,496 / 12,887 rows = 19%
- 6,443 / 12,887 rows = 50%
- 12,887 / 12,887 rows = 100% (but capped at 99% while streaming)

---

## Animation Details

### Progress Bar

- Width: 24px (w-24)
- Height: 1px (h-1)
- Background: muted color
- Fill: primary color
- Transition: `transition-all duration-300 ease-out`
- Updates smoothly as rows accumulate

### Spinner

- Size: 3x3 px (h-3 w-3)
- Animation: `animate-spin`
- Color: Primary
- Rotates continuously while streaming

### Text Updates

- Row count updates in real-time
- No flicker due to RAF throttling
- Smooth percentage increases

---

## Advantages Over Overlay Indicator

### Before (Overlay)

❌ Obscures data grid content  
❌ Takes up vertical space  
❌ Feels like a blocking operation  
❌ Separate from other status info

### After (Status Bar)

✅ Always visible, never blocks content  
✅ Integrated with other status info  
✅ Compact and professional  
✅ Shows more detailed progress (percentage + bar)  
✅ Consistent with modern database tools

---

## Similar to Industry Standards

**DataGrip / DBeaver:**

- Status bar with row count
- Progress indicator integrated

**pgAdmin:**

- Bottom status bar
- Shows rows retrieved / total

**MySQL Workbench:**

- Status bar with execution time
- Inline progress indicators

Our implementation combines the best of these approaches! 🚀
