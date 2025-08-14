# Storage Cleanup Guide

## Overview

DevDB Studio provides comprehensive storage management utilities to clear application data and reset configurations when needed.

## How to Clear Storage

### Method 1: Using the Settings Menu

1. Open DevDB Studio
2. Click on the **Settings** button in the bottom-left corner
3. Select **Clear All Data** from the dropdown menu
4. Review the storage usage statistics
5. Click **Clear All Data & Reload** to confirm

### Method 2: Using Keyboard Shortcut

- **macOS**: Press `⌘ + Shift + Delete` (or `⌘ + Shift + Backspace`)
- **Windows/Linux**: Press `Ctrl + Shift + Delete` (or `Ctrl + Shift + Backspace`)

### Method 3: Using Browser Console

If the UI is unresponsive, you can clear storage directly from the browser console:

```javascript
// Import the storage cleaner (if not already loaded)
import { StorageCleaner } from './src/utils/clearStorage';

// Clear all storage
await StorageCleaner.clearAll();

// Or clear specific types:
await StorageCleaner.clearConnections();     // Clear only connections
await StorageCleaner.clearWorkspaces();      // Clear only workspaces
await StorageCleaner.clearQueries();         // Clear only query history
await StorageCleaner.clearSettings();        // Clear only settings
await StorageCleaner.clearCache();           // Clear only cache

// Check storage usage
const stats = await StorageCleaner.getStorageStats();
console.log(stats);
```

## What Gets Cleared

When you clear all data, the following will be removed:

### 1. Database Connections
- All saved database connections
- Connection credentials (securely stored)
- Connection history and metadata

### 2. Workspaces
- All workspace configurations
- Workspace-connection associations
- Workspace preferences

### 3. Query Data
- Query history
- Saved queries
- Query results cache

### 4. Application Settings
- Theme preferences
- UI customizations
- Application configuration

### 5. Cache Data
- Temporary cache files
- Browser caches
- Session storage

## Storage Information

The cleanup dialog displays current storage usage:
- **localStorage**: Number of items and total size in KB
- **sessionStorage**: Number of items and total size in KB
- **Total Usage**: Combined storage footprint

## Important Notes

⚠️ **Warning**: Clearing storage is irreversible. Make sure to:
1. Export any important queries or configurations before clearing
2. Note down connection details you want to keep
3. The application will automatically reload after clearing

## Troubleshooting

### Storage Won't Clear
If storage doesn't clear properly:
1. Try using the browser console method
2. Clear browser cache manually (browser settings)
3. Restart the application

### Application Won't Reload
If the app doesn't reload after clearing:
1. Manually refresh the page (F5 or Cmd+R)
2. Close and reopen the application

### Partial Clear Issues
If some data persists after clearing:
1. Check browser developer tools > Application > Storage
2. Manually clear specific storage types
3. Use the selective clearing methods in console

## Security Note

All sensitive data (passwords, credentials) is stored in the secure Rust backend with encryption. The clear storage operation also triggers the backend to clear its secure storage, ensuring complete data removal.