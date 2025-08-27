# Performance Optimization Guide

## Critical Fixes (Do These First)

### 1. Fix Blocking Backend Initialization
```rust
// In src-tauri/src/lib.rs - Replace lines 36-48 with:
.setup(|app| {
    let app_handle = app.handle().clone();
    let storage_state: Arc<Mutex<Option<SecureStorage>>> = Arc::new(Mutex::new(None));
    
    // Clone for async task
    let storage_state_clone = storage_state.clone();
    let app_handle_clone = app_handle.clone();
    
    // Initialize storage ASYNC - don't block!
    tauri::async_runtime::spawn(async move {
        match SecureStorage::init(&app_handle_clone).await {
            Ok(storage) => {
                let mut state = storage_state_clone.lock().await;
                *state = Some(storage);
                println!("Secure storage initialized successfully");
            }
            Err(e) => {
                eprintln!("Failed to initialize secure storage: {}", e);
            }
        }
    });
    
    // Continue immediately
    let connection_registry = ConnectionRegistry::new(app_handle.clone());
    app.handle().manage(storage_state);
    app.handle().manage(connection_registry);
    Ok(())
})
```

### 2. Lazy Load Monaco Editor
```tsx
// In src/components/QueryPanel/QueryEditor.tsx
import { lazy, Suspense } from 'react';

// Replace direct import
const MonacoEditorLazy = lazy(() => 
  import('@monaco-editor/react').then(module => ({
    default: module.default
  }))
);

// Wrap in Suspense when using
<Suspense fallback={<div>Loading editor...</div>}>
  <MonacoEditorLazy {...props} />
</Suspense>
```

### 3. Add Vite Code Splitting
```typescript
// In vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco': ['monaco-editor'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          'vendor-data': ['@tanstack/react-query', '@tanstack/react-table'],
        }
      }
    }
  },
  // ... rest of config
});
```

### 4. Lazy Load Routes
```tsx
// In src/App.tsx or router config
import { lazy } from 'react';

const WorkspaceScreen = lazy(() => import('./screens/workspace/WorkspaceScreen'));
const MainScreen = lazy(() => import('./screens/main/MainScreen'));

// Use with Suspense
<Suspense fallback={<LoadingScreen />}>
  <Routes>
    <Route path="/" element={<MainScreen />} />
    <Route path="/workspace" element={<WorkspaceScreen />} />
  </Routes>
</Suspense>
```

### 5. Disable Health Monitors by Default
```rust
// In src-tauri/src/database/registry.rs line 95
let health_monitor = if config.enable_health_check.unwrap_or(false) { // Change true to false
    Some(spawn_health_monitor(/*...*/))
} else {
    None
};
```

## Expected Results
- Initial load time: **5-6s → 1-2s** (70% reduction)
- Monaco loads only when query panel opens
- Backend doesn't block UI startup
- Memory usage reduced by ~30%

## Additional Optimizations

### Bundle Size Reduction
```bash
# Analyze bundle
pnpm add -D vite-bundle-visualizer
# Add to package.json scripts:
"analyze": "vite-bundle-visualizer"
```

### Remove Unused Dependencies
```bash
# Check for unused
pnpm add -D depcheck
npx depcheck

# Consider removing if unused:
- fuse.js (if search not implemented)
- lru-cache (if caching not used)
- Multiple Radix UI components
```

### Production Build Optimization
```typescript
// vite.config.ts
build: {
  minify: 'terser',
  terserOptions: {
    compress: {
      drop_console: true,
      drop_debugger: true,
    },
  },
  reportCompressedSize: false,
  chunkSizeWarningLimit: 1500,
}
```