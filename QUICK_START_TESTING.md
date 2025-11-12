# Quick Start - Testing Data Invalidation System

## 🚀 Start Testing in 2 Minutes

### Step 1: Start the Application (30 seconds)

```bash
make dev
# or
pnpm tauri:dev
```

Wait for the app to open and connect to your database.

---

### Step 2: Open Browser DevTools (5 seconds)

Press **F12** or **Cmd+Option+I** (Mac) to open DevTools.
Go to the **Console** tab.

---

### Step 3: Run First Test (60 seconds)

#### Test: QueryPanel → DataGridV2 Auto-Refresh

1. **Open a DataGridV2 panel** for any table (e.g., `users`)
   - Click on a table in the sidebar
   - Note the current data in the grid

2. **Open a QueryPanel** (split the workspace)
   - Click "+" icon to add new panel
   - Select "Query" panel type

3. **Execute a mutation query**:
   ```sql
   UPDATE users SET name = 'Auto Refresh Test' WHERE id = 1
   ```

4. **Watch the magic! ✨**
   - Look at the DataGridV2 panel
   - **It should automatically refresh** without you doing anything!
   - Check the console logs:
     ```
     ✅ [QueryPanel] Invalidating table: public.users
     ✅ [DataInvalidation] Notifying X listener(s)
     ✅ [TableDataGridV2] Data invalidated - refetching
     ```

**Expected Result**: DataGridV2 shows "Auto Refresh Test" immediately.

**If it doesn't work**: Check console for error messages and see troubleshooting section below.

---

### Step 4: Run Second Test (30 seconds)

#### Test: DataGridV2 Commit → DataGridV2 Auto-Refresh

1. **Open TWO DataGridV2 panels** for the same table (side by side)
   - Split workspace
   - Both showing `users` table

2. **In Panel 1**: Edit a cell (e.g., change a name)

3. **Click "Commit" button** in Panel 1

4. **Watch Panel 2** - it should automatically refresh and show the same change!

**Expected Result**: Both panels show the updated data.

---

### Step 5: Use Debug Tools (Optional - 30 seconds)

Open console and type:

```javascript
// Check system status
window.debugInvalidation.logStatus()

// Run automatic system test
window.debugInvalidation.runSystemTest()

// Monitor invalidations in real-time (30 seconds)
window.debugInvalidation.monitor(30000)
```

---

## 🎯 What You Should See

### Console Logs (Success Pattern)

```
[QueryPanel] Mutation detected - cache invalidated
[SQLParser] Parsed 1 unique table(s) from SQL: [{schema: "public", table: "users"}]
[QueryPanel] Invalidating table: public.users
[DataInvalidation] Invalidating table: conn123:mydb:public:users at 1234567890
[DataInvalidation] Notifying 2 listener(s) for table: conn123:mydb:public:users
[TableDataGridV2] Data invalidated for mydb.public.users - refetching
[TableDataGridV2] Data invalidated for mydb.public.users - refetching
```

### Visual Indicators

- ✅ DataGridV2 shows loading spinner briefly
- ✅ Data updates within 1 second
- ✅ Toast notification: "Data modified - Refreshing results..."
- ✅ No manual refresh needed

---

## 🐛 Troubleshooting

### Issue: No automatic refresh

**Check 1**: Are you in the right mode?
- DataGridV2 must be in "table" mode (not "query" mode)
- Look for "Commit" button in toolbar - if present, you're in table mode

**Check 2**: Did the mutation execute successfully?
- Check for SQL errors in console
- Verify the query affected rows: `1 row(s) affected`

**Check 3**: Is the SQL parser detecting tables?
```javascript
window.debugInvalidation.testSqlParser('UPDATE users SET name = "test"')
```
Should show: `Parsed 1 table(s)`

**Check 4**: Are there any listeners?
```javascript
window.debugInvalidation.logStatus()
```
Look for listeners for your table.

---

### Issue: Console shows errors

**Error**: `[DataInvalidation] Invalid parameters`
- **Fix**: Check connection is active
- **Fix**: Verify database/table names are correct

**Error**: `[SQLParser] Error parsing SQL`
- **Fix**: Check SQL syntax
- **Fix**: Try simpler query first

**Error**: Network errors
- **Fix**: Check backend is running
- **Fix**: Verify database connection

---

### Issue: Multiple refreshes happening

This might indicate:
- Multiple DataGridV2 panels open (expected)
- Memory leak (check with `debugInvalidation.logStatus()`)

To verify it's normal:
```javascript
const status = window.debugInvalidation.logStatus()
// Check if listener count matches number of open DataGridV2 panels
```

---

## 📋 5-Minute Complete Test Checklist

Run through this checklist to verify everything works:

- [ ] **Test 1**: QueryPanel UPDATE → DataGridV2 refreshes
- [ ] **Test 2**: QueryPanel INSERT → DataGridV2 shows new row
- [ ] **Test 3**: QueryPanel DELETE → DataGridV2 removes row
- [ ] **Test 4**: DataGridV2 edit + commit → other DataGridV2 refreshes
- [ ] **Test 5**: Console logs show expected pattern
- [ ] **Test 6**: Debug tools work (`window.debugInvalidation.runSystemTest()`)

**All checked?** ✅ System is working perfectly!

**Some failed?** ⚠️ See troubleshooting or check full testing guide.

---

## 📚 Next Steps

### For Quick Testing
- Continue with `docs/data-invalidation-testing-guide.md` (10 comprehensive test cases)

### For Understanding Implementation
- Read `DATA_INVALIDATION_IMPLEMENTATION.md` (architecture and design)

### For Development
- Check `src/stores/dataInvalidationStore.ts` (core logic)
- Check `src/utils/sqlParser.ts` (SQL parsing)

---

## 🆘 Still Having Issues?

1. **Check logs**: Console should show detailed error messages
2. **Run system test**: `window.debugInvalidation.runSystemTest()`
3. **Review implementation doc**: `DATA_INVALIDATION_IMPLEMENTATION.md`
4. **Check backend**: Ensure Rust backend is running without errors

---

## 🎉 Success!

If you see automatic refreshes working, **congratulations!** The data invalidation system is working perfectly. Your UI will now always stay in sync with the database automatically! 🚀

**Time to celebrate**: No more stale data issues! 🎊
