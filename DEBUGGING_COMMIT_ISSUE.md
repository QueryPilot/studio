# 🐛 Debugging: Data Reverts After Commit

## Issue Description
After editing `user_4` to `user_4 2324` and committing (Cmd+S), the grid shows the old value `user_4`.

---

## ✅ Enhanced Debugging (Just Added)

I've added comprehensive logging to help diagnose the issue. After restarting the app, you should see these logs:

### 1. **During Edit**
```
[TableDataGridV2] Cell edit committed
```

### 2. **During Commit (Cmd+S)**
```
[CrudStore] Calling executeCrudTransaction with connectionId: ...
[CrudStore] Commands count: 1
[CrudStore] Commands to commit: [...]
[CrudStore] Backend execution result: { success: true/false, ... }
```

### 3. **After Commit Success**
```
[GlobalChangesModal] Commit succeeded, waiting 100ms before invalidating...
[GlobalChangesModal] Invalidated table after commit: ...
[DataInvalidation] Invalidating table: ... at timestamp
[DataInvalidation] Notifying X listener(s)
[TableDataGridV2] onCommitSuccess called - refetching data
[TableDataGridV2] Data invalidated - invalidating cache and refetching
[TableDataGridV2] onCommitSuccess refetch completed, got X rows
[TableDataGridV2] Refetch completed, got X rows in first page
```

---

## 🔍 Diagnostic Steps

### Step 1: Restart the App
```bash
# Kill current instance
# Restart:
make dev
```

### Step 2: Open DevTools Console (F12)

### Step 3: Reproduce the Issue
1. Open DataGridV2 for any table
2. Edit a cell (e.g., change "user_4" to "user_4 2324")
3. Press **Cmd+S** or click **Commit**
4. **Watch the console closely**

---

## 🎯 What to Look For

### ✅ **GOOD CASE** (Everything Works)

```
[CrudStore] Commands to commit: [{type: "data.update", ...}]
[CrudStore] Backend execution result: {success: true, committed: [...]}
[GlobalChangesModal] Commit succeeded, waiting 100ms...
[GlobalChangesModal] Invalidated table after commit: mydb.public.users
[DataInvalidation] Notifying 1 listener(s)
[TableDataGridV2] onCommitSuccess refetch completed, got 10 rows
[TableDataGridV2] Refetch completed, got 10 rows in first page
```

**Result**: Grid shows "user_4 2324" ✅

---

### ❌ **BAD CASE 1** (Backend Fails to Save)

```
[CrudStore] Backend execution result: {success: false, failures: [...]}
❌ Commit failed: [error message]
```

**Problem**: Backend isn't saving the data to database
**Solution**: Check backend logs (Rust console)

---

### ❌ **BAD CASE 2** (Refetch Gets Old Data)

```
[CrudStore] Backend execution result: {success: true, ...}
[TableDataGridV2] Refetch completed, got 10 rows in first page
```
But grid still shows old value "user_4"

**Problem**: Refetch is pulling stale data
**Possible Causes**:
1. Database transaction hasn't committed yet (timing issue)
2. Backend is caching queries
3. React Query cache issue

**Solution**: Check if the 100ms delay helps, or increase it

---

### ❌ **BAD CASE 3** (No Refetch Triggered)

```
[CrudStore] Backend execution result: {success: true, ...}
[GlobalChangesModal] Invalidated table after commit: ...
```
But NO logs from `[TableDataGridV2] onCommitSuccess` or `[TableDataGridV2] Refetch completed`

**Problem**: Refetch isn't being triggered
**Solution**: Check if DataGridV2 is in table mode (not query mode)

---

### ❌ **BAD CASE 4** (Refetch Returns Empty)

```
[TableDataGridV2] Refetch completed, got 0 rows in first page
```

**Problem**: Query is returning no results
**Solution**: Check backend query logic

---

## 🔧 Quick Fixes

### Fix 1: Increase Delay (If timing issue)

If you see the refetch happening but pulling old data, the database transaction might not be committed yet.

**Test**: Try increasing the delay from 100ms to 500ms:
- Edit `src/components/GlobalChangesModal/GlobalChangesModal.tsx`
- Find: `await new Promise((resolve) => setTimeout(resolve, 100));`
- Change to: `await new Promise((resolve) => setTimeout(resolve, 500));`

---

### Fix 2: Check Backend Transaction Isolation

If backend is reading committed data but showing old values, check the Rust backend transaction isolation level.

---

### Fix 3: Verify Command Payload

Check that the UPDATE command has the correct `newValue`:
```javascript
// In console, after editing but before commit:
window.__ZUSTAND_STORES__ // Look for crudStore
```

---

## 📋 Information to Collect

When you reproduce the issue, please capture:

1. **Console logs** (full output from commit to finish)
2. **Network tab** (check the backend API call and response)
3. **Screenshots** before/during/after commit
4. **Backend logs** (Rust console output)

---

## 🆘 If Still Broken After This

### Additional Debug Command

Open console and run:
```javascript
// Check if invalidation system is working
window.debugInvalidation.runSystemTest()

// Check current state
window.debugInvalidation.logStatus()

// Monitor in real-time
window.debugInvalidation.monitor(30000) // 30 seconds
```

Then try the commit again while monitoring.

---

## 📞 Next Steps

1. **Restart app** with new logging
2. **Reproduce the issue**
3. **Copy console logs**
4. **Share logs** so I can see exactly what's happening
5. We'll fix it based on the diagnostic output!

---

The new logging will tell us EXACTLY where the process is breaking down! 🔍
