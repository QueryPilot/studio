# SQL Refactoring Tools - Testing Guide

Quick guide to test the new Smart Rename, Extract to CTE, and Query Outline features.

## Quick Start Testing

### 1. Launch the App

```bash
cd /Users/hieuvu/Workspaces/QueryPilot/studio
make dev  # or pnpm tauri:dev
```

### 2. Connect to a Database

Use any database connection (PostgreSQL, MySQL, SQLite, SQL Server).

For quick testing with dev databases:

```bash
make setup  # Starts Docker containers + seeds databases
```

Then connect to:

- **PostgreSQL**: `localhost:15432`, user: `devuser`, pass: `devpass123`
- **MySQL**: `localhost:13306`, user: `devuser`, pass: `devpass123`

---

## Feature Testing Checklist

### ✅ Test 1: Query Outline Panel (AST-based)

**What to test**: The outline panel now uses AST parsing instead of regex.

**Steps:**

1. Open any query editor tab
2. Make sure the **Outline panel** is visible on the right
3. Type a complex query with CTEs and joins:

```sql
WITH active_users AS (
  SELECT id, username, email, full_name
  FROM users
  WHERE is_active = true AND email_verified = true
),
user_todo_stats AS (
  SELECT
    user_id,
    COUNT(*) as total_todos,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
  FROM todos
  GROUP BY user_id
)
SELECT
  u.username,
  u.email,
  u.full_name,
  s.total_todos,
  s.completed_count,
  ROUND(s.completed_count::numeric / s.total_todos * 100, 2) as completion_rate
FROM active_users u
INNER JOIN user_todo_stats s ON u.id = s.user_id
WHERE s.total_todos > 10
ORDER BY completion_rate DESC;
```

**Expected:**

- ✅ Outline shows "SELECT" statement
- ✅ Lists both CTEs: `active_users` and `user_todo_stats`
- ✅ Lists tables: `users`, `todos`, `active_users` (CTE reference), `user_todo_stats` (CTE reference)
- ✅ Shows parse status: "Full" (green badge)
- ✅ Clicking on any item navigates cursor to that position

**Try these:**

- Type invalid SQL → Should show "Failed" with empty outline
- Type partial SQL → Should show "Partial" warning with what it could parse

---

### ✅ Test 2: Smart Rename (F2)

**What to test**: Rename table/CTE aliases, column aliases across entire query.

**Test Case 1: Rename Table Alias**

```sql
SELECT u.id, u.username, u.email, u.full_name
FROM users u
WHERE u.is_active = true AND u.email_verified = true;
```

**Steps:**

1. Place cursor on **any** `u` (the alias)
2. Press **F2**
3. Inline rename widget appears next to the symbol
4. Type new name: `usr`
5. Press **Enter**

**Expected:**

- ✅ All 4 occurrences of `u` renamed to `usr`
- ✅ Query becomes: `SELECT usr.id, usr.username, usr.email, usr.full_name FROM users usr WHERE usr.is_active = true AND usr.email_verified = true;`
- ✅ Cursor positioned at first renamed location

**Test Case 2: Rename CTE**

```sql
WITH high_priority_todos AS (
  SELECT * FROM todos WHERE priority IN ('high', 'critical')
)
SELECT
  t.id,
  t.title,
  t.priority,
  t.status
FROM high_priority_todos t
WHERE t.status != 'completed';
```

**Steps:**

1. Place cursor on `high_priority_todos` (either definition or reference)
2. Press **F2**
3. Type: `urgent_todos`
4. Press **Enter**

**Expected:**

- ✅ Both definition and reference renamed to `urgent_todos`
- ✅ No false positives (doesn't rename `todos` table)
- ✅ Query still valid after rename

**Test Case 3: Rename Column Alias**

```sql
SELECT
  user_id,
  COUNT(*) as todo_count,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as done_count,
  ROUND(done_count::numeric / todo_count * 100, 2) as completion_pct
FROM todos
GROUP BY user_id;
```

**Steps:**

1. Cursor on `todo_count` (first alias)
2. **F2** → rename to `total_todos`

**Expected:**

- ✅ Both occurrences of `todo_count` renamed to `total_todos`
- ✅ Query valid after rename

**Edge Cases to Test:**

- ❌ Try renaming with invalid name (like `123invalid`) → Should show error in widget
- ❌ Try renaming to SQL keyword (like `select`) → Should show error
- ✅ Try renaming a symbol not used elsewhere → Should still work (renames definition)

---

### ✅ Test 3: Extract to CTE (Cmd+Shift+E / Ctrl+Shift+E)

**What to test**: Extract a subquery into a CTE.

**Test Case 1: Extract Simple Subquery**

```sql
SELECT
  t.id,
  t.title,
  t.priority,
  t.status
FROM todos t
WHERE t.user_id IN (
  SELECT id FROM users WHERE is_active = true AND email_verified = true
);
```

**Steps:**

1. **Select** the entire subquery: `SELECT id FROM users WHERE is_active = true AND email_verified = true`
2. Press **Cmd+Shift+E** (Mac) or **Ctrl+Shift+E** (Windows/Linux)
3. Dialog opens asking for CTE name
4. Enter: `verified_users`
5. Click **Extract**

**Expected:**

```sql
WITH verified_users AS (
  SELECT id FROM users WHERE is_active = true AND email_verified = true
)
SELECT
  t.id,
  t.title,
  t.priority,
  t.status
FROM todos t
WHERE t.user_id IN (SELECT * FROM verified_users);
```

- ✅ New `WITH` clause created at top
- ✅ Subquery replaced with CTE reference
- ✅ Cursor positioned at CTE definition
- ✅ Query is valid SQL

**Test Case 2: Extract When WITH Clause Exists**

```sql
WITH overdue_todos AS (
  SELECT * FROM todos WHERE due_date < CURRENT_DATE AND status != 'completed'
)
SELECT
  t.id,
  t.title,
  u.username,
  u.email
FROM overdue_todos t
INNER JOIN users u ON t.user_id = u.id
WHERE u.id IN (
  SELECT id FROM users WHERE is_active = true
);
```

**Steps:**

1. Select the subquery: `SELECT id FROM users WHERE is_active = true`
2. **Cmd+Shift+E**
3. Enter CTE name: `active_users`
4. Extract

**Expected:**

```sql
WITH overdue_todos AS (
  SELECT * FROM todos WHERE due_date < CURRENT_DATE AND status != 'completed'
),
active_users AS (
  SELECT id FROM users WHERE is_active = true
)
SELECT
  t.id,
  t.title,
  u.username,
  u.email
FROM overdue_todos t
INNER JOIN users u ON t.user_id = u.id
WHERE u.id IN (SELECT * FROM active_users);
```

- ✅ New CTE appended to existing `WITH` clause
- ✅ Comma added correctly between CTEs
- ✅ Formatting preserved

**Test Case 3: Validation Errors**

Try these invalid names in the dialog:

- `123invalid` → ❌ "Name must start with letter or underscore"
- `my-cte` → ❌ "Can only contain letters, numbers, and underscores"
- `select` → ❌ "Cannot be a reserved keyword"
- `` (empty) → ❌ "Name cannot be empty"

**Edge Cases:**

- Try extracting non-subquery text (like `SELECT *`) → Should get backend error
- Try extracting with no selection → Should do nothing

---

### ✅ Test 4: Code Actions Lightbulb (Cmd+. / Ctrl+.)

**What to test**: Lightbulb appears when refactoring actions are available.

**Test Case 1: Lightbulb Shows for Renameable Symbol**

```sql
SELECT t.id, t.title, t.status, t.priority
FROM todos t
WHERE t.status = 'in_progress' AND t.priority IN ('high', 'critical');
```

**Steps:**

1. Place cursor on any `t`
2. Wait ~150ms (debounced)
3. Look for **💡 lightbulb icon** in the gutter (left margin)
4. Click the lightbulb **OR** press **Cmd+.** / **Ctrl+.**

**Expected:**

- ✅ Lightbulb appears next to the line
- ✅ Clicking opens menu with "Rename alias 't'" action
- ✅ Selecting action triggers rename flow (same as F2)

**Test Case 2: Lightbulb for Extractable Subquery**

```sql
SELECT
  u.username,
  (SELECT COUNT(*) FROM todos WHERE user_id = u.id AND status = 'completed') as completed_count
FROM users u
WHERE u.is_active = true;
```

**Steps:**

1. Cursor inside the subquery
2. Wait for lightbulb
3. Click or press **Cmd+.**

**Expected:**

- ✅ Menu shows "Extract to CTE" action
- ✅ Selecting opens Extract CTE dialog

**Test Case 3: No Lightbulb When Nothing Available**

```sql
SELECT 1 + 1;
```

**Expected:**

- ✅ No lightbulb appears (no refactoring available)
- ✅ Pressing **Cmd+.** does nothing

---

## Manual Testing Scenarios

### Scenario 1: Complex Multi-CTE Query Refactoring

Start with:

```sql
SELECT
  t.id,
  t.title,
  (SELECT username FROM users WHERE id = t.user_id) as username,
  (SELECT COUNT(*) FROM comments WHERE todo_id = t.id) as comment_count,
  (SELECT name FROM categories c
   INNER JOIN todo_categories tc ON c.id = tc.category_id
   WHERE tc.todo_id = t.id LIMIT 1) as category_name
FROM todos t
WHERE t.status = 'in_progress'
ORDER BY t.priority DESC;
```

**Refactoring Steps:**

1. Extract first subquery to CTE `user_lookup`
2. Extract second subquery to CTE `comment_counts`
3. Extract third subquery to CTE `todo_categories_lookup`
4. Rename alias `t` to `todo`
5. Verify query still works

**Final Result:**

```sql
WITH user_lookup AS (
  SELECT username FROM users WHERE id = t.user_id
),
comment_counts AS (
  SELECT COUNT(*) FROM comments WHERE todo_id = t.id
),
todo_categories_lookup AS (
  SELECT name FROM categories c
  INNER JOIN todo_categories tc ON c.id = tc.category_id
  WHERE tc.todo_id = t.id LIMIT 1
)
SELECT
  todo.id,
  todo.title,
  (SELECT * FROM user_lookup) as username,
  (SELECT * FROM comment_counts) as comment_count,
  (SELECT * FROM todo_categories_lookup) as category_name
FROM todos todo
WHERE todo.status = 'in_progress'
ORDER BY todo.priority DESC;
```

---

### Scenario 2: Test All Dialects

The refactoring works with all SQL dialects. Test with:

**PostgreSQL-specific:**

```sql
SELECT
  u.id,
  u.preferences->'theme' as theme,
  u.preferences->'language' as language,
  u.metadata->'subscription' as subscription_tier
FROM users u
WHERE u.is_active = true;
```

**MySQL-specific:**

```sql
SELECT
  t.id,
  t.title,
  JSON_EXTRACT(t.tags, '$[0]') as first_tag
FROM todos t
WHERE t.status = 'completed';
```

**SQL Server-specific:**

```sql
SELECT
  t.id,
  t.title,
  JSON_VALUE(t.tags, '$[0]') as first_tag
FROM todos t WITH (NOLOCK)
WHERE t.status = 'completed';
```

**Expected:**

- ✅ Rename works across all dialects
- ✅ Outline shows correct structure
- ✅ Extract CTE handles dialect-specific syntax

---

## Automated Testing

### Run Rust Unit Tests

```bash
cd src-tauri
cargo test refactor -- --nocapture
```

**Tests included (18 total):**

- `test_apply_rename_table_alias` - Basic alias rename
- `test_apply_rename_cte` - CTE rename (definition + usages)
- `test_apply_rename_column_alias` - Column alias in SELECT
- `test_rename_conflict_detection` - Prevents renaming to existing name
- `test_rename_invalid_identifier` - Rejects invalid SQL identifiers
- `test_get_actions_rename_table_alias` - Action detection for aliases
- `test_get_actions_rename_cte` - Action detection for CTEs
- `test_apply_extract_cte_simple` - Extract subquery (no existing WITH)
- `test_apply_extract_cte_with_existing_with` - Append to existing WITH
- `test_apply_extract_cte_invalid_selection` - Error for non-subquery
- `test_find_subquery_at_position` - Subquery detection logic
- And more...

**Expected:** All tests pass ✅

### Run Frontend Tests (if applicable)

```bash
pnpm test:unit refactor
```

---

## Performance Testing

### Test 1: Large Query Outline

**Query with 50+ tables and 10+ CTEs**

```sql
WITH cte1 AS (...), cte2 AS (...), ... cte10 AS (...)
SELECT *
FROM table1 t1
JOIN table2 t2 ON ...
JOIN table3 t3 ON ...
... (50 tables)
```

**Expected:**

- ✅ Outline renders within 500ms
- ✅ No UI lag when typing
- ✅ Debouncing prevents excessive backend calls

### Test 2: Rename in Large Query

**10,000+ character query with 50+ alias references**

**Expected:**

- ✅ F2 widget appears instantly (<100ms)
- ✅ Rename completes within 200ms
- ✅ No perceptible lag

---

## Troubleshooting

### Issue: Lightbulb Not Appearing

**Check:**

- Cursor is on a valid symbol (alias, CTE name)
- Wait 150ms for debounce
- Check browser console for errors

### Issue: Rename Widget Not Showing

**Check:**

- Press F2 directly (don't rely on context menu yet)
- Make sure cursor is on a valid identifier
- Check if Tauri backend is running (`ps aux | grep QueryPilot`)

### Issue: Extract CTE Dialog Not Opening

**Check:**

- Text is actually selected (not just cursor position)
- Selection contains a valid subquery
- Try Cmd+Shift+E (Mac) vs Ctrl+Shift+E (Windows/Linux)

### Issue: Backend Errors

**Check Rust logs:**

```bash
make dev  # Rust logs will show in terminal
```

Look for:

- `[refactor.rs]` log lines
- Parse errors
- Validation failures

---

## Developer Testing Tips

### Enable Debug Logging

In `src/lib/logger.ts`, set level to `debug`:

```typescript
logger.setLevel("debug");
```

### Test with Different Dialects

Change dialect in editor dropdown:

- PostgreSQL
- MySQL
- SQLite
- SQL Server (MSSQL)
- Oracle

### Test Edge Cases

**Incomplete SQL:**

```sql
SELECT * FROM users WHERE
```

- Should show "Partial" parse status
- Outline shows what it could parse

**Invalid SQL:**

```sql
SELECT FROM WHERE
```

- Should show "Failed" parse status
- Empty outline

**Unicode/Special Characters:**

```sql
SELECT "用户名" as 名字 FROM users;
```

- Should handle gracefully

---

## Success Criteria

All features working when:

- ✅ Outline panel updates in real-time
- ✅ F2 rename works on aliases/CTEs/columns
- ✅ Cmd+Shift+E extracts subqueries to CTEs
- ✅ Lightbulb (💡) appears for available actions
- ✅ Cmd+. opens code actions menu
- ✅ All dialects supported (PostgreSQL, MySQL, etc.)
- ✅ No crashes or errors in console
- ✅ Performance feels instant (<200ms for all operations)

---

## Reporting Issues

If you find bugs, check:

1. Browser console (F12) for JavaScript errors
2. Rust logs in terminal for backend errors
3. Specific SQL query that caused the issue
4. Dialect being used
5. Steps to reproduce

**Example Bug Report:**

```
Title: Rename fails for nested CTEs

Steps:
1. Open query with nested CTE
2. Place cursor on inner CTE name
3. Press F2
4. Type new name and press Enter

Expected: All references renamed
Actual: Error in console: "Symbol not found"

Query:
WITH outer_cte AS (
  WITH inner_cte AS (SELECT 1)
  SELECT * FROM inner_cte
)
SELECT * FROM outer_cte;

Dialect: PostgreSQL
```

---

## Quick Test Script

**Copy/paste this into a query editor to test all features:**

```sql
-- ============================================
-- SQL Refactoring Test Suite
-- Database: todoapp (seeded via make setup)
-- ============================================

-- Test 1: Rename table alias (press F2 on 't')
SELECT t.id, t.title, t.status, t.priority
FROM todos t
WHERE t.status = 'in_progress';

-- Test 2: Extract this subquery (select it, Cmd+Shift+E)
-- SELECT: SELECT id FROM users WHERE is_active = true
SELECT *
FROM todos
WHERE user_id IN (
  SELECT id FROM users WHERE is_active = true
);

-- Test 3: Rename CTE (press F2 on 'active_todos')
WITH active_todos AS (
  SELECT * FROM todos WHERE status IN ('pending', 'in_progress')
)
SELECT
  t.id,
  t.title,
  u.username
FROM active_todos t
INNER JOIN users u ON t.user_id = u.id;

-- Test 4: Lightbulb (move cursor to 'c', see 💡)
SELECT c.id, c.name, c.color
FROM categories c
WHERE c.user_id = 1;

-- Test 5: Complex query for outline panel
WITH overdue_todos AS (
  SELECT id, user_id, title, priority
  FROM todos
  WHERE due_date < CURRENT_DATE AND status != 'completed'
),
user_stats AS (
  SELECT
    user_id,
    COUNT(*) as overdue_count,
    MAX(priority::text) as max_priority
  FROM overdue_todos
  GROUP BY user_id
)
SELECT
  u.username,
  u.email,
  s.overdue_count,
  s.max_priority
FROM users u
INNER JOIN user_stats s ON u.id = s.user_id
WHERE u.is_active = true
ORDER BY s.overdue_count DESC;

-- Test 6: Column alias rename (F2 on 'todo_count')
SELECT
  user_id,
  COUNT(*) as todo_count,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as done_count,
  ROUND(done_count::numeric / todo_count * 100, 2) as completion_rate
FROM todos
GROUP BY user_id
HAVING todo_count > 5;
```

---

**Happy Testing! 🎉**

If everything works, you should be able to:

- See a detailed outline of your SQL
- Rename symbols across entire queries with F2
- Extract subqueries to CTEs with Cmd+Shift+E
- See smart refactoring suggestions via the lightbulb
