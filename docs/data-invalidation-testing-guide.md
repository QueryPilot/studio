# Data Invalidation System - Testing Guide

## Overview
The Data Invalidation System ensures that all components displaying table data automatically refresh when that data is modified, regardless of where the modification originated (QueryPanel or DataGridV2).

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                   Data Invalidation Flow                        │
└────────────────────────────────────────────────────────────────┘

User Action (Mutation/Commit)
        ↓
Component Detects Change
        ↓
Broadcast Invalidation
   (invalidateTable)
        ↓
dataInvalidationStore
        ↓
Notify All Subscribers
        ↓
Components Refetch Data
        ↓
UI Updates with Fresh Data
```

## Test Cases

### Test Case 1: QueryPanel Mutation → DataGridV2 Refresh

**Setup:**
1. Open a DataGridV2 panel showing the `users` table
2. Note a specific row's data (e.g., user with id=1, name="John")

**Action:**
3. Open a QueryPanel
4. Execute: `UPDATE users SET name = 'Jane Updated' WHERE id = 1`

**Expected Result:**
- ✅ Console shows: `[QueryPanel] Invalidating table: public.users`
- ✅ Console shows: `[DataInvalidation] Notifying X listener(s)`
- ✅ Console shows: `[TableDataGridV2] Data invalidated - refetching`
- ✅ DataGridV2 automatically refreshes and displays "Jane Updated"
- ✅ No page refresh needed
- ✅ Toast notification shows "Data modified - Refreshing results..."

**Failure Indicators:**
- ❌ DataGridV2 still shows "John"
- ❌ No console logs about invalidation
- ❌ Manual refresh needed to see changes

---

### Test Case 2: DataGridV2 Commit → QueryPanel Refresh

**Setup:**
1. Open QueryPanel with: `SELECT * FROM users ORDER BY id`
2. Execute the query and note results
3. Open a DataGridV2 panel for the `users` table

**Action:**
4. In DataGridV2, edit a cell (e.g., change name from "Alice" to "Alice Modified")
5. Click "Commit" button

**Expected Result:**
- ✅ Console shows: `[GlobalChangesModal] Invalidated table after commit`
- ✅ Toast shows "Changes committed"
- ✅ DataGridV2 refreshes (already had this functionality)
- ✅ QueryPanel result table automatically updates to show "Alice Modified"

**Failure Indicators:**
- ❌ QueryPanel still shows old "Alice"
- ❌ Need to re-run query manually

---

### Test Case 3: Multiple DataGridV2 Panels (Same Table)

**Setup:**
1. Split workspace into 3 panels
2. Open DataGridV2 for `orders` table in Panel 1
3. Open DataGridV2 for `orders` table in Panel 2
4. Open DataGridV2 for `orders` table in Panel 3

**Action:**
5. In Panel 1, edit a row and commit changes

**Expected Result:**
- ✅ All 3 panels refresh simultaneously
- ✅ Console shows: `[DataInvalidation] Notifying 3 listener(s) for table`
- ✅ All panels display the updated data

**Failure Indicators:**
- ❌ Only Panel 1 refreshes
- ❌ Other panels show stale data

---

### Test Case 4: Selective Invalidation (Different Tables)

**Setup:**
1. Open DataGridV2 for `users` table
2. Open DataGridV2 for `orders` table
3. Open QueryPanel

**Action:**
4. In QueryPanel, execute: `DELETE FROM users WHERE id = 999`

**Expected Result:**
- ✅ Only `users` DataGridV2 refreshes
- ✅ `orders` DataGridV2 remains unchanged (no unnecessary refresh)
- ✅ Console shows invalidation only for `users` table

**Failure Indicators:**
- ❌ Both tables refresh (inefficient)
- ❌ Neither table refreshes

---

### Test Case 5: Complex SQL with Multiple Tables

**Setup:**
1. Open DataGridV2 for `users` table
2. Open DataGridV2 for `audit_logs` table
3. Open QueryPanel

**Action:**
4. Execute complex query:
```sql
UPDATE users SET last_login = NOW() WHERE id = 1;
INSERT INTO audit_logs (user_id, action) VALUES (1, 'login');
```

**Expected Result:**
- ✅ SQL parser detects both `users` and `audit_logs`
- ✅ Console shows: `[SQLParser] Parsed 2 unique table(s)`
- ✅ Both DataGridV2 panels refresh
- ✅ Each table only receives one invalidation

**Failure Indicators:**
- ❌ Only one table refreshes
- ❌ SQL parser fails to detect tables

---

### Test Case 6: Schema-Qualified Tables

**Setup:**
1. Open DataGridV2 for `public.employees` table
2. Open QueryPanel

**Action:**
3. Execute: `UPDATE public.employees SET salary = 50000 WHERE id = 1`

**Expected Result:**
- ✅ SQL parser correctly extracts schema and table
- ✅ Console shows: `[QueryPanel] Invalidating table: public.employees`
- ✅ DataGridV2 refreshes

**Failure Indicators:**
- ❌ Parser fails to match schema-qualified name
- ❌ DataGridV2 doesn't refresh

---

### Test Case 7: Quoted Identifiers

**Setup:**
1. Open DataGridV2 for a table with special characters (e.g., `"User Profiles"`)
2. Open QueryPanel

**Action:**
3. Execute: `UPDATE "User Profiles" SET status = 'active' WHERE id = 1`

**Expected Result:**
- ✅ SQL parser handles quoted identifiers
- ✅ DataGridV2 refreshes correctly

**Failure Indicators:**
- ❌ Parser fails to extract table name
- ❌ Console shows warning about no tables parsed

---

### Test Case 8: Error Resilience

**Setup:**
1. Open DataGridV2 for `products` table
2. Open QueryPanel

**Action:**
3. Execute malformed SQL: `UPDATE products SET` (incomplete)

**Expected Result:**
- ✅ SQL parser returns empty array (no crash)
- ✅ Console shows: `[SQLParser] Error parsing SQL`
- ✅ App continues to function normally
- ✅ Error toast shown to user

**Failure Indicators:**
- ❌ App crashes
- ❌ Uncaught exception in console

---

### Test Case 9: Performance (Large Table)

**Setup:**
1. Open DataGridV2 for a large table (10,000+ rows)
2. Open QueryPanel

**Action:**
3. Execute: `UPDATE large_table SET flag = true WHERE id = 1`

**Expected Result:**
- ✅ Invalidation broadcast takes <50ms
- ✅ DataGridV2 starts refetch immediately
- ✅ UI remains responsive during refetch
- ✅ No memory leaks

**Failure Indicators:**
- ❌ UI freezes
- ❌ Visible delay before refetch starts
- ❌ Memory usage increases without cleanup

---

### Test Case 10: Component Lifecycle (Unmount/Remount)

**Setup:**
1. Open DataGridV2 for `customers` table
2. Note the subscription in console

**Action:**
3. Close the DataGridV2 panel
4. Reopen DataGridV2 for the same table

**Expected Result:**
- ✅ Console shows: `[TableDataGridV2] Unsubscribing from invalidations`
- ✅ Console shows: `[TableDataGridV2] Subscribing to invalidations`
- ✅ New subscription works correctly
- ✅ No duplicate listeners

**Failure Indicators:**
- ❌ Memory leak (listeners not cleaned up)
- ❌ Multiple invalidation events for same action
- ❌ Subscription doesn't work after remount

---

## Console Log Reference

### Expected Log Sequence for Successful Flow

```
[QueryPanel] Mutation detected - cache invalidated
[SQLParser] Parsed 1 unique table(s) from SQL: [{schema: "public", table: "users"}]
[QueryPanel] Invalidating table: public.users
[DataInvalidation] Invalidating table: conn123:mydb:public:users at 1234567890
[DataInvalidation] Notifying 2 listener(s) for table: conn123:mydb:public:users
[TableDataGridV2] Data invalidated for mydb.public.users - refetching
[TableDataGridV2] Data invalidated for mydb.public.users - refetching
```

### Expected Log Sequence for Commit Flow

```
[GlobalChangesModal] Invalidated table after commit: mydb.public.users
[DataInvalidation] Invalidating table: conn123:mydb:public:users at 1234567891
[DataInvalidation] Notifying 1 listener(s) for table: conn123:mydb:public:users
[TableDataGridV2] Data invalidated for mydb.public.users - refetching
```

---

## Debugging Tips

### Enable Detailed Logging

Open browser DevTools Console (F12) and ensure all log levels are enabled:
- Info ✓
- Warnings ✓
- Errors ✓

Filter by:
- `[DataInvalidation]` - Store events
- `[SQLParser]` - SQL parsing
- `[QueryPanel]` - Query execution
- `[TableDataGridV2]` - Grid refresh events
- `[GlobalChangesModal]` - Commit events

### Common Issues and Solutions

**Issue: No invalidation logs**
- Check if mutation query matches regex patterns in sqlParser.ts
- Verify `isMutationQuery()` returns true for your SQL
- Check if SQL has syntax errors

**Issue: Logs show invalidation but no refresh**
- Verify DataGridV2 subscription was registered
- Check if tableKey matches between broadcaster and subscriber
- Ensure schema names match (e.g., "public" vs undefined)

**Issue: Multiple refreshes for single action**
- Check for duplicate listeners (memory leak)
- Verify unsubscribe is called on unmount
- Check if multiple invalidations are triggered

**Issue: SQL parser fails to detect table**
- Check console for `[SQLParser] Error parsing SQL`
- Verify table name doesn't contain special characters without quotes
- Check if SQL uses uncommon syntax

---

## Performance Benchmarks

### Target Metrics

| Operation | Target Time | Acceptable Range |
|-----------|-------------|------------------|
| Invalidation broadcast | <10ms | <50ms |
| Listener notification | <5ms | <20ms |
| Grid refetch initiation | <20ms | <100ms |
| Total end-to-end | <50ms | <200ms |

### Memory Usage

- Subscriptions cleaned up on unmount: ✓
- No memory leaks after 100+ operations: ✓
- Store size remains constant: ✓

---

## Automated Testing Script

You can use this script in browser console to automate testing:

```javascript
// Test Data Invalidation System
async function testInvalidation() {
  const store = window.__ZUSTAND_STORES__?.dataInvalidation;
  if (!store) {
    console.error('Store not found');
    return;
  }

  const { invalidateTable, subscribe } = store.getState();

  let callbackCount = 0;
  const unsubscribe = subscribe('test-conn', 'test-db', 'public', 'test-table', () => {
    callbackCount++;
    console.log('✓ Callback triggered:', callbackCount);
  });

  // Test 1: Invalidation triggers callback
  invalidateTable('test-conn', 'test-db', 'public', 'test-table');

  setTimeout(() => {
    if (callbackCount === 1) {
      console.log('✓ Test 1 PASSED: Callback triggered correctly');
    } else {
      console.error('✗ Test 1 FAILED: Expected 1 callback, got', callbackCount);
    }

    // Test 2: Unsubscribe works
    unsubscribe();
    invalidateTable('test-conn', 'test-db', 'public', 'test-table');

    setTimeout(() => {
      if (callbackCount === 1) {
        console.log('✓ Test 2 PASSED: Unsubscribe works correctly');
      } else {
        console.error('✗ Test 2 FAILED: Callback should not trigger after unsubscribe');
      }
    }, 100);
  }, 100);
}

// Run test
testInvalidation();
```

---

## Rollback Plan

If issues are discovered in production:

1. **Disable invalidation broadcasting** (quick fix):
   - Comment out `invalidateTable()` calls in QueryPanel.tsx and GlobalChangesModal.tsx
   - Components will still work with manual refresh

2. **Disable auto-refresh** (safer):
   - Comment out subscription in TableDataGridV2.tsx
   - Users can manually refresh using existing mechanisms

3. **Full rollback**:
   - Revert commits for:
     - dataInvalidationStore.ts (delete file)
     - sqlParser.ts (delete file)
     - QueryPanel.tsx (revert changes)
     - TableDataGridV2.tsx (revert changes)
     - GlobalChangesModal.tsx (revert changes)

---

## Future Enhancements

1. **Rate limiting**: Debounce rapid invalidations
2. **Smart refresh**: Only refetch visible rows
3. **Row-level invalidation**: Track specific row IDs instead of entire tables
4. **Optimistic updates**: Show changes before backend confirms
5. **Conflict resolution**: Handle concurrent edits from multiple users
6. **WebSocket integration**: Real-time updates from backend
7. **Persistence**: Store invalidation timestamps in localStorage

---

## Support

If you encounter issues not covered in this guide:
1. Check browser console for detailed logs
2. Verify all components are properly mounted
3. Test with simpler queries first
4. Report issues with console logs and reproduction steps
