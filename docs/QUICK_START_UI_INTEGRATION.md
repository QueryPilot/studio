# Quick Start: Wire Up UI Integration

## TL;DR - 3 Simple Steps

### Step 1: Import the Hook

```typescript
import { useActiveTable } from "@/hooks/useActiveItem";
// or useActiveCollection for MongoDB
// or useActiveKey for Redis
```

### Step 2: Call It

```typescript
const setActiveTable = useActiveTable(connectionId);
```

### Step 3: Use It When User Clicks

```typescript
const handleTableClick = (tableName: string) => {
  setActiveTable(tableName); // That's it!
  // Your existing navigation code...
};
```

---

## Complete Examples

### SQL Table Browser

```typescript
import { useActiveTable } from "@/hooks/useActiveItem";

function TableBrowser({ connectionId }: { connectionId: string }) {
  const setActiveTable = useActiveTable(connectionId);

  return (
    <div>
      {tables.map(table => (
        <button
          key={table.name}
          onClick={() => {
            setActiveTable(table.name);
            // Navigate to table...
          }}
        >
          {table.name}
        </button>
      ))}
    </div>
  );
}
```

### MongoDB Collection Browser

```typescript
import { useActiveCollection } from "@/hooks/useActiveItem";

function CollectionList({ connectionId }: { connectionId: string }) {
  const setActiveCollection = useActiveCollection(connectionId);

  return (
    <div>
      {collections.map(coll => (
        <div onClick={() => setActiveCollection(coll.name)}>
          {coll.name}
        </div>
      ))}
    </div>
  );
}
```

### Redis Key Browser

```typescript
import { useActiveKey } from "@/hooks/useActiveItem";

function KeyList({ connectionId }: { connectionId: string }) {
  const setActiveKey = useActiveKey(connectionId);

  return (
    <div>
      {keys.map(key => (
        <div onClick={() => setActiveKey(key)}>
          {key}
        </div>
      ))}
    </div>
  );
}
```

---

## Alternative: Manual Tracking

If you can't change existing code, just add tracking:

```typescript
import { useTrackRecentItems } from "@/hooks/useTrackRecentItems";

function TableBrowser({ connectionId }: { connectionId: string }) {
  const setCurrentTableName = useUIStore(state => state.setCurrentTableName);
  const { trackTable } = useTrackRecentItems(connectionId);

  const handleClick = (tableName: string) => {
    setCurrentTableName(tableName);
    trackTable(tableName); // Add this one line
  };
}
```

---

## How to Verify It Works

### 1. Check Recent Items Store

Open DevTools > Application > Local Storage > look for `recent-items-store`.

Should see something like:
```json
{
  "state": {
    "items": [
      {
        "connectionId": "abc-123",
        "type": "table",
        "name": "users",
        "timestamp": 1705449600000
      }
    ]
  }
}
```

### 2. Check AI Request

1. Click on a table
2. Open AI Assistant
3. Send any message
4. Open DevTools > Network tab
5. Find the `chat` request
6. Inspect request body:

```json
{
  "messages": [...],
  "provider": "openai",
  "model": "gpt-4",
  "context": {
    "connectionId": "abc-123",
    "database": "mydb",
    "schema": "public",
    "activeTable": "users",  // ← Should be here!
    "activeCollection": null,
    "activeKey": null,
    "recentTables": ["users", "orders"], // ← And here!
    "recentCollections": [],
    "recentKeys": [],
    "activeQuery": null,
    "lastAction": "browse"
  }
}
```

### 3. Check AI Suggestions

1. Click on a table (e.g., "users")
2. Open AI Assistant sidebar
3. Look at suggestion chips

Should show:
- "Explain the structure of **users**"
- "Show me sample data from **users**"
- "What are the relationships for **users**?"

(Note: table name should match what you clicked!)

---

## Files to Update

Search your codebase for these patterns:

### SQL (PostgreSQL, MySQL, SQLite)
```bash
# Find table click handlers
grep -r "onClick.*table" src/components --include="*.tsx"
grep -r "onTableClick\|handleTableClick" src/components --include="*.tsx"
```

### MongoDB
```bash
# Find collection click handlers
grep -r "onClick.*collection" src/components --include="*.tsx"
grep -r "onCollectionClick\|handleCollectionClick" src/components --include="*.tsx"
```

### Redis
```bash
# Find key click handlers
grep -r "onClick.*key" src/components --include="*.tsx"
grep -r "onKeyClick\|handleKeyClick" src/components --include="*.tsx"
```

---

## Common Issues

### "Hook returns null"
**Problem:** `connectionId` is null
**Fix:** Ensure component receives valid `connectionId` prop

### "Recent items not saving"
**Problem:** Zustand persist middleware not initialized
**Fix:** Check browser console for errors, clear localStorage and retry

### "AI still gets null context"
**Problem:** Store setter called but not the hook
**Fix:** Make sure you're calling `setActiveTable()` not `useUIStore.getState().setCurrentTableName()`

### "Context shows old table"
**Problem:** Hook called before store updated
**Fix:** The hook auto-syncs, wait 100ms or check if the store actually updated

---

## That's It!

Add **one hook call** + **one line** = **context-aware AI**

For full docs, see `docs/UI_INTEGRATION_COMPLETE.md`
