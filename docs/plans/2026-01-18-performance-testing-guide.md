# DataGrid Performance Testing Guide

**Date:** 2026-01-18
**Status:** Guide for Manual Testing
**Author:** Claude

## Purpose

This guide provides instructions for performance testing the unified DataGrid architecture across all paradigms (SQL, Document, Key-Value).

## Prerequisites

1. Start development server:
   ```bash
   pnpm tauri:dev
   ```

2. Set up test databases with large datasets:
   ```bash
   make setup  # Start Docker containers with seeded data
   ```

3. Open browser DevTools (Performance tab)

## Performance Metrics

### Target Metrics
| Metric | Target | Critical |
|--------|--------|----------|
| Initial Render | <500ms | <1000ms |
| Scroll FPS | 60 FPS | >30 FPS |
| Column Resize | 60 FPS | >30 FPS |
| Sort Operation | <200ms | <500ms |
| Filter Apply | <300ms | <1000ms |

### Test Datasets
- **Small**: 100 rows, 10 columns
- **Medium**: 1,000 rows, 15 columns
- **Large**: 10,000 rows, 20 columns
- **XL**: 50,000 rows, 25 columns (stress test)

## SQL DataGrid Testing

### Setup Test Data
```sql
-- PostgreSQL: Generate large test table
CREATE TABLE perf_test AS
SELECT
  i AS id,
  'user_' || i AS username,
  md5(random()::text) AS email,
  (random() * 100)::int AS age,
  now() - (random() * interval '365 days') AS created_at,
  CASE WHEN random() > 0.5 THEN true ELSE false END AS active,
  repeat('x', 100) AS description
FROM generate_series(1, 10000) i;
```

### Test Scenarios

#### 1. Initial Render Performance
```javascript
// In DevTools Console
console.time('Initial Render');
// Open table in DataGrid
// Wait for grid to fully render
console.timeEnd('Initial Render');
// Expected: <500ms for 10K rows
```

#### 2. Scroll Performance
1. Start Performance recording in DevTools
2. Scroll through entire grid (top to bottom)
3. Stop recording
4. Check FPS in flamegraph
5. **Target**: 60 FPS sustained, no frame drops

#### 3. Column Resize Performance
1. Start Performance recording
2. Resize a column repeatedly
3. Stop recording
4. Check FPS during resize
5. **Target**: 60 FPS during interaction

#### 4. Sort Performance
```javascript
// In DevTools Console
console.time('Sort Operation');
// Click column header to sort
console.timeEnd('Sort Operation');
// Expected: <200ms for 10K rows
```

#### 5. Filter Performance
```javascript
// In DevTools Console
console.time('Filter Operation');
// Apply quick filter: "user_1"
console.timeEnd('Filter Operation');
// Expected: <300ms for 10K rows
```

#### 6. CRUD Performance
```javascript
// In DevTools Console
console.time('Edit Cell');
// Edit a cell value
console.timeEnd('Edit Cell');
// Expected: <50ms for single cell edit
```

## MongoDB DataGrid Testing

### Setup Test Data
```javascript
// MongoDB: Generate large collection
db.perf_test.insertMany(
  Array.from({ length: 10000 }, (_, i) => ({
    _id: ObjectId(),
    userId: i,
    username: `user_${i}`,
    email: `user${i}@example.com`,
    profile: {
      age: Math.floor(Math.random() * 80) + 18,
      country: 'US',
      interests: ['coding', 'reading', 'gaming']
    },
    posts: Array.from({ length: 5 }, (_, j) => ({
      id: j,
      title: `Post ${j}`,
      content: 'x'.repeat(100)
    })),
    createdAt: new Date()
  }))
);
```

### Test Scenarios

#### 1. Initial Render
```javascript
console.time('MongoDB Initial Render');
// Open collection in DocumentDataGrid
console.timeEnd('MongoDB Initial Render');
// Expected: <500ms for 10K docs
```

#### 2. Drill-Down Performance
```javascript
console.time('Drill Down');
// Click on nested object (profile)
console.timeEnd('Drill Down');
// Expected: <100ms for drill-down navigation
```

#### 3. Breadcrumb Navigation
```javascript
console.time('Navigate Up');
// Click breadcrumb to go back
console.timeEnd('Navigate Up');
// Expected: <100ms for navigation
```

## Redis DataGrid Testing

### Setup Test Data
```bash
# Redis: Generate large hash
redis-cli EVAL "
for i=1,10000 do
  redis.call('HSET', 'perf_test_hash', 'field_' .. i, 'value_' .. i)
end
return 10000
" 0
```

### Test Scenarios

#### 1. Initial Render
```javascript
console.time('Redis Initial Render');
// Open key in KeyValueDataGrid
console.timeEnd('Redis Initial Render');
// Expected: <200ms for 10K fields
```

#### 2. Scroll Performance
Same as SQL testing - should maintain 60 FPS

## Profiling with React DevTools

### Enable Profiling
1. Install React DevTools Chrome extension
2. Open Profiler tab
3. Click "Record" button
4. Perform user interactions
5. Click "Stop" button
6. Analyze component render times

### What to Look For
- **Render count**: Should be minimal (no unnecessary re-renders)
- **Render duration**: Most renders should be <16ms (60 FPS)
- **Commit phase**: Should be fast (<50ms)

## Memory Profiling

### Check Memory Usage
1. Open DevTools Memory tab
2. Take heap snapshot before loading grid
3. Load large dataset in grid
4. Take heap snapshot after
5. Compare snapshots

### Expected Memory Usage
- **Small (100 rows)**: <5 MB
- **Medium (1K rows)**: <20 MB
- **Large (10K rows)**: <100 MB
- **XL (50K rows)**: <300 MB

### Memory Leaks
Check for:
- Event listeners not cleaned up
- Unmounted components retaining references
- Large objects in closures

## Lighthouse Audit

```bash
# Run Lighthouse performance audit
# Target scores:
# - Performance: >90
# - Accessibility: >95
# - Best Practices: >95
```

## Benchmarking Script

```typescript
// scripts/benchmark-datagrid.ts
import { performance } from 'perf_hooks';

interface BenchmarkResult {
  metric: string;
  duration: number;
  passed: boolean;
}

const results: BenchmarkResult[] = [];

// Benchmark initial render
const start = performance.now();
// ... render logic
const duration = performance.now() - start;
results.push({
  metric: 'Initial Render',
  duration,
  passed: duration < 500
});

// Output results
console.table(results);
```

## Results Template

After testing, document results in `docs/plans/2026-01-18-performance-results.md`:

```markdown
# DataGrid Performance Results

**Date:** 2026-01-18
**Tester:** [Your Name]
**Dataset:** 10,000 rows, 20 columns

## SQL DataGrid
| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Initial Render | <500ms | XXXms | ✅/❌ |
| Scroll FPS | 60 | XX FPS | ✅/❌ |
| Column Resize | 60 FPS | XX FPS | ✅/❌ |
| Sort | <200ms | XXXms | ✅/❌ |
| Filter | <300ms | XXXms | ✅/❌ |

## MongoDB DataGrid
| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Initial Render | <500ms | XXXms | ✅/❌ |
| Drill-Down | <100ms | XXXms | ✅/❌ |
| Navigate Up | <100ms | XXXms | ✅/❌ |

## Redis DataGrid
| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Initial Render | <200ms | XXXms | ✅/❌ |
| Scroll FPS | 60 | XX FPS | ✅/❌ |

## Conclusion
[Summary of findings and recommendations]
```

## Troubleshooting Performance Issues

### Issue: Slow Initial Render
**Possible causes:**
- Too many columns being rendered at once
- Heavy computation in cell renderers
- Inefficient data transformation

**Solutions:**
- Implement column virtualization
- Memoize cell render functions
- Optimize data pipeline

### Issue: Scroll Jank
**Possible causes:**
- Re-renders during scroll
- Heavy scroll event handlers
- Layout thrashing

**Solutions:**
- Use `useDeferredValue` for scroll state
- Debounce scroll handlers
- Avoid forced synchronous layouts

### Issue: Memory Leaks
**Possible causes:**
- Event listeners not removed
- Store subscriptions not cleaned up
- Large objects retained in closures

**Solutions:**
- Use `useEffect` cleanup functions
- Unsubscribe from stores on unmount
- Avoid capturing large objects in callbacks

## Next Steps

1. Run manual tests following this guide
2. Document results in performance-results.md
3. Address any performance regressions
4. Set up automated performance benchmarks (optional)

## References

- [React Profiler API](https://react.dev/reference/react/Profiler)
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)
- [Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)
