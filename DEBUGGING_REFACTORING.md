# Debugging SQL Refactoring Features

## Quick Debug Steps

### 1. Check if Outline Panel is Visible

**Should see**: Right panel with SQL outline showing CTEs, tables, etc.

**If not visible**:
```bash
# Restart app
make dev
```

The outline panel is now **enabled by default** as of the latest commit.

---

### 2. Test F2 Rename with Debug Logs

**Open Browser Console** (Cmd+Option+I or F12)

Type this query:
```sql
SELECT u.id, u.username, u.email
FROM users u
WHERE u.is_active = true;
```

**Test Steps:**
1. Place cursor on `u` (any occurrence)
2. Press **F2**
3. **Check console for logs:**

**Expected Logs:**
```
[inline-rename] Starting rename at position 7 dialect: postgresql
[inline-rename] Got actions: [{kind: "rename", label: "Rename alias 'u'", ...}]
[inline-rename] Showing rename widget for: u
```

**If you see:**
- ❌ `No rename available` → Backend didn't find renameable symbol
- ❌ `Error:` → Backend command failed
- ❌ No logs at all → F2 keybinding not registered

---

### 3. Test Outline with Debug Logs

**Type any SQL and watch console:**

```sql
WITH active_users AS (
  SELECT * FROM users WHERE is_active = true
)
SELECT * FROM active_users;
```

**Expected Logs:**
```
[refactor-service] Calling sql_get_outline {dialect: "postgresql", sqlLength: 98}
[refactor-service] Got outline {statements: [...], parse_status: "Full"}
```

**If you see:**
- ❌ `Tauri not available` → Running in browser mode, not Tauri
- ❌ `Error getting outline` → Backend command failed
- ❌ No logs → Outline component not calling backend

---

### 4. Check if Tauri Commands are Available

**Open browser console and run:**

```javascript
// Check if Tauri is available
console.log('Tauri available:', '__TAURI__' in window);

// Try calling command directly
await window.__TAURI__.invoke('sql_get_outline', {
  sql: 'SELECT * FROM users',
  dialect: 'postgresql'
});
```

**Expected:** Should return outline object or error message.

---

### 5. Common Issues & Fixes

#### Issue: "Tauri not available"
**Fix:** App is running in browser dev mode, not Tauri.
```bash
# Stop browser dev server
# Run Tauri dev instead:
make dev  # or pnpm tauri:dev
```

#### Issue: No logs in console
**Fix:** Logger might be set to wrong level.
```typescript
// In src/lib/logger.ts, ensure:
logger.setLevel("debug");
```

#### Issue: F2 does nothing
**Checks:**
1. Is cursor on a valid symbol? (alias, CTE name, column alias)
2. Check console for `[inline-rename]` logs
3. Try right-clicking → Should show context menu without crash

#### Issue: Outline shows "No structure detected"
**Checks:**
1. Is SQL valid?
2. Check console for `[refactor-service]` logs
3. Try simpler SQL: `SELECT * FROM users`

---

### 6. Manual Backend Test

**Test Rust backend directly:**

```bash
cd src-tauri
cargo test refactor -- --nocapture
```

**Expected:** All 18 tests should pass.

If tests fail, backend logic has issues.

---

### 7. Check Network/IPC

**In browser console:**

```javascript
// Monitor Tauri IPC calls
window.__TAURI__.event.listen('tauri://invoke', (event) => {
  console.log('Tauri invoke:', event);
});
```

---

## Current Known Issues

1. **Lightbulb disabled** - Temporarily off due to Base UI error
2. **Linter column validation** - Separate issue, not related to refactoring
3. **Performance** - Large queries (1000+ lines) might be slow

---

## Getting Help

**When reporting issues, include:**

1. **Browser console logs** (especially `[inline-rename]` and `[refactor-service]`)
2. **SQL query** that's not working
3. **Cursor position** (character offset)
4. **Dialect** (postgresql, mysql, sqlite, mssql)
5. **Steps to reproduce**

**Example:**
```
Issue: F2 rename doesn't work on CTE name

Query:
WITH my_cte AS (SELECT * FROM users)
SELECT * FROM my_cte;

Cursor: On "my_cte" (first occurrence)
Dialect: postgresql

Console logs:
[inline-rename] Starting rename at position 5
[inline-rename] Got actions: []
[inline-rename] No rename available

Expected: Should rename both occurrences of "my_cte"
```
