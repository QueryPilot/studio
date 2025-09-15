# Index Usage Statistics Implementation Specification

**Status**: ✅ Implemented for PostgreSQL
**Last Updated**: 2025-09-15

## Overview
Add comprehensive index usage statistics to the database indexes view, providing insights into index performance and utilization across PostgreSQL, MySQL, SQL Server, and SQLite databases.

## Objectives
- Display index usage metrics (scans, reads, last accessed)
- Identify unused or underutilized indexes
- Provide visual indicators for index efficiency
- Support database-specific statistics with graceful fallbacks

## Architecture

### Data Model

#### Backend (Rust)
```rust
pub struct IndexUsageStats {
    pub index_name: String,
    pub scan_count: Option<i64>,
    pub rows_read: Option<i64>,
    pub rows_returned: Option<i64>,
    pub last_accessed: Option<String>,
    pub last_used: Option<String>, // ISO timestamp of last index scan (PG16+)
    pub cache_hit_ratio: Option<f64>,
    pub size_bytes: Option<i64>,
    pub size_pretty: Option<String>,
    pub is_unused: bool,
    pub efficiency_score: Option<i32>, // 0-100
}
```

#### Frontend (TypeScript)
```typescript
interface IndexUsageStats {
  index_name: string;
  scan_count?: number;
  rows_read?: number;
  rows_returned?: number;
  last_accessed?: string;
  last_used?: string; // ISO timestamp of last index scan (PG16+)
  cache_hit_ratio?: number;
  size_bytes?: number;
  size_pretty?: string;
  is_unused: boolean;
  efficiency_score?: number; // 0-100
}

interface TableIndex {
  name: string;
  unique: boolean;
  primary: boolean;
  columns: string[];
  index_type: string;
  condition?: string;
  size?: string;
  usage?: IndexUsageStats; // New field
}
```

## Database-Specific Implementation

### PostgreSQL
**Full Support** - Comprehensive statistics available
**PostgreSQL 16+** - Additional `last_idx_scan` timestamp support

```sql
-- Version detection for PG16+ features
SELECT current_setting('server_version_num')::int;

-- Main usage statistics (PG16+)
SELECT
    s.indexrelname AS index_name,
    s.idx_scan AS scan_count,
    s.idx_tup_read AS rows_read,
    s.idx_tup_fetch AS rows_returned,
    pg_size_pretty(pg_relation_size(s.indexrelid)) AS size_pretty,
    pg_relation_size(s.indexrelid) AS size_bytes,
    CASE
        WHEN s.idx_scan = 0 THEN true
        ELSE false
    END AS is_unused,
    -- Cache hit ratio from pg_statio_all_indexes
    CASE
        WHEN io.idx_blks_read + io.idx_blks_hit = 0 THEN NULL
        ELSE (io.idx_blks_hit::float / (io.idx_blks_read + io.idx_blks_hit)) * 100
    END AS cache_hit_ratio,
    s.last_idx_scan AT TIME ZONE 'UTC' AS last_idx_scan -- PG16+ only
FROM
    pg_stat_all_indexes s
    LEFT JOIN pg_statio_all_indexes io
        ON s.indexrelid = io.indexrelid
WHERE
    s.relname = $1
    AND s.schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY
    s.idx_scan DESC;
```

### MySQL
**Good Support** - Requires performance_schema

```sql
-- Performance schema statistics
SELECT
    s.INDEX_NAME AS index_name,
    COALESCE(ps.COUNT_STAR, 0) AS scan_count,
    COALESCE(ps.SUM_TIMER_WAIT / 1000000000, 0) AS total_latency_ms,
    -- Size from information_schema
    ROUND((stat.index_length / 1024 / 1024), 2) AS size_mb,
    stat.index_length AS size_bytes,
    CASE
        WHEN ps.COUNT_STAR IS NULL OR ps.COUNT_STAR = 0 THEN true
        ELSE false
    END AS is_unused
FROM
    information_schema.STATISTICS s
    LEFT JOIN performance_schema.table_io_waits_summary_by_index_usage ps
        ON ps.OBJECT_SCHEMA = s.TABLE_SCHEMA
        AND ps.OBJECT_NAME = s.TABLE_NAME
        AND ps.INDEX_NAME = s.INDEX_NAME
    LEFT JOIN information_schema.TABLES stat
        ON stat.TABLE_SCHEMA = s.TABLE_SCHEMA
        AND stat.TABLE_NAME = s.TABLE_NAME
WHERE
    s.TABLE_SCHEMA = ?
    AND s.TABLE_NAME = ?
GROUP BY
    s.INDEX_NAME;
```

### SQL Server
**Full Support** - Rich statistics via DMVs

```sql
-- Dynamic Management Views
SELECT
    i.name AS index_name,
    us.user_seeks + us.user_scans + us.user_lookups AS total_reads,
    us.user_seeks AS seek_count,
    us.user_scans AS scan_count,
    us.user_lookups AS lookup_count,
    us.user_updates AS update_count,
    us.last_user_seek AS last_seek,
    us.last_user_scan AS last_scan,
    CASE
        WHEN us.user_seeks + us.user_scans + us.user_lookups = 0 THEN 1
        ELSE 0
    END AS is_unused,
    -- Size calculation
    ps.used_page_count * 8 AS size_kb,
    ps.used_page_count * 8 * 1024 AS size_bytes
FROM
    sys.dm_db_index_usage_stats us
    INNER JOIN sys.indexes i
        ON us.object_id = i.object_id
        AND us.index_id = i.index_id
    LEFT JOIN sys.dm_db_partition_stats ps
        ON i.object_id = ps.object_id
        AND i.index_id = ps.index_id
WHERE
    us.database_id = DB_ID()
    AND us.object_id = OBJECT_ID(@schema + '.' + @table)
ORDER BY
    total_reads DESC;
```

### SQLite
**Limited Support** - No runtime statistics

```rust
// Return empty stats - SQLite doesn't track usage
impl SqliteAdapter {
    pub async fn get_index_usage_stats(&self, _table: &str) -> Result<Vec<IndexUsageStats>> {
        // SQLite does not provide runtime index usage statistics
        Ok(vec![])
    }

    pub fn supports_index_usage_stats(&self) -> bool {
        false
    }
}
```

## Performance Considerations

### Query Performance
| Database | Query Time | Notes |
|----------|------------|-------|
| PostgreSQL | ~15ms | In-memory stats collector |
| MySQL | ~30ms | If performance_schema enabled |
| SQL Server | ~10ms | Cached DMVs |
| SQLite | 0ms | No query needed |

### Caching Strategy
```typescript
class IndexStatsCache {
    private cache = new Map<string, CachedStats>();
    private readonly TTL = 5 * 60 * 1000; // 5 minutes

    async getStats(connectionId: string, table: string): Promise<IndexUsageStats[]> {
        const key = `${connectionId}:${table}`;
        const cached = this.cache.get(key);

        if (cached && Date.now() - cached.timestamp < this.TTL) {
            return cached.data;
        }

        const fresh = await this.fetchStats(connectionId, table);
        this.cache.set(key, { data: fresh, timestamp: Date.now() });
        return fresh;
    }
}
```

### Progressive Loading
```typescript
// Load basic index info immediately
const indexes = await databaseService.tableIndexes(connectionId, database, schema, table);
setIndexes(indexes);

// Load usage stats asynchronously
if (supportsUsageStats(connectionType)) {
    loadIndexUsageStats(connectionId, table).then(stats => {
        setIndexes(mergeIndexesWithStats(indexes, stats));
    });
}
```

## UI/UX Design

### Visual Indicators
```typescript
const getUsageIndicator = (stats?: IndexUsageStats) => {
    if (!stats) return { color: 'gray', label: '-' };

    if (stats.is_unused) {
        return { color: 'red', label: 'Unused' };
    }

    if (stats.scan_count && stats.scan_count < 100) {
        return { color: 'yellow', label: stats.scan_count.toLocaleString() };
    }

    return { color: 'green', label: stats.scan_count?.toLocaleString() || 'Active' };
};
```

**Note**: Icons removed per UI feedback - clean text-only indicators preferred.

### Table Display
```
┌──────────────┬─────────┬────────┬────────┬───────────┬────────┬─────────────┐
│ Index Name   │ Columns │ Type   │ Unique │ Condition │ Size   │ Usage       │
├──────────────┼─────────┼────────┼────────┼───────────┼────────┼─────────────┤
│ idx_user_id  │ user_id │ BTREE  │ YES    │ -         │ 16 KB  │ 🟢 12,450   │
│ idx_date     │ date    │ BTREE  │ NO     │ -         │ 8 KB   │ 🟡 85       │
│ idx_custom   │ custom  │ BTREE  │ NO     │ -         │ 4 KB   │ 🔴 Unused   │
└──────────────┴─────────┴────────┴────────┴───────────┴────────┴─────────────┘
```

### Hover Card Details (using shadcn/ui HoverCard)
```tsx
<HoverCard openDelay={200}>
  <HoverCardTrigger>
    <span className={colorClass}>{displayValue}</span>
  </HoverCardTrigger>
  <HoverCardContent side="top" align="end">
    <div className="space-y-1.5">
      <div className="font-semibold">Index Usage Statistics</div>
      <div>Scans: {stats.scan_count?.toLocaleString()}</div>
      {stats.last_used && (
        <div>Last Used: {formatRelativeTime(stats.last_used)}</div>
      )}
      <div>Rows Read: {stats.rows_read?.toLocaleString()}</div>
      <div>Cache Hit: {stats.cache_hit_ratio?.toFixed(1)}%</div>
      <div>Efficiency: {stats.efficiency_score}/100</div>
    </div>
  </HoverCardContent>
</HoverCard>
```

**Last Used Format**: Shows relative time (e.g., "3h ago", "2d ago", "1w ago")

## Implementation Steps

### Phase 1: Backend Foundation
1. ✅ Define IndexUsageStats struct in Rust
2. ✅ Add trait method to database adapter interface
3. ✅ Implement PostgreSQL adapter method with version detection
4. ✅ Add Tauri command `get_index_usage_stats`

### Phase 2: Frontend Integration
5. ✅ Update TypeScript interfaces
6. ✅ Modify TableIndexes component
7. ✅ Add visual indicators and HoverCard tooltips
8. ✅ Implement non-blocking progressive loading
9. ✅ Add empty state when no indexes exist

### Phase 3: Additional Databases
10. ⬜ Implement MySQL adapter
11. ⬜ Implement SQL Server adapter
12. ⬜ Add SQLite stub with capability flag

### Phase 4: Polish
13. ⬜ Add refresh button
14. ✅ Implement efficiency scoring algorithm
15. ⬜ Add sorting by usage
16. ⬜ Export usage report feature

## Error Handling

### Permission Errors
```rust
match query_stats().await {
    Ok(stats) => stats,
    Err(e) if e.contains("permission") => {
        log::warn!("No permission for index stats: {}", e);
        vec![] // Return empty, don't fail
    }
    Err(e) => return Err(e.into()),
}
```

### Missing Performance Schema (MySQL)
```sql
-- Check if performance_schema is enabled
SELECT VARIABLE_VALUE
FROM performance_schema.global_variables
WHERE VARIABLE_NAME = 'performance_schema';
```

## Testing Strategy

### Unit Tests
- Mock database responses for each adapter
- Test cache expiration logic
- Verify efficiency score calculation

### Integration Tests
- Test against real databases with known indexes
- Verify stats accuracy
- Test permission-denied scenarios

### Performance Tests
- Measure query execution time
- Validate caching reduces database load
- Test with tables having many indexes (>50)

## Success Metrics
- Query execution under 50ms for 95% of requests
- Cache hit ratio > 80% during normal usage
- Correct identification of unused indexes
- No UI blocking during stats loading

## Implementation Notes & Learnings

### Key Implementation Details

1. **Connection ID Mapping**: Frontend must use `databaseService.getIndexUsageStats()` which properly maps frontend connection IDs to backend connection IDs. Direct `BackendAPI` calls will fail due to ID mismatch.

2. **PostgreSQL Version Detection**: The implementation checks `server_version_num` to determine if `last_idx_scan` column is available (PG16+). Falls back gracefully for older versions.

3. **Progressive Loading**: Statistics are loaded asynchronously after the main index data to prevent UI blocking. The table remains responsive while stats load in the background.

4. **Empty State Handling**: When a table has no indexes, a centered message with appropriate icon is displayed while maintaining the table header structure.

5. **Statistics Interpretation**:
   - **Scan Count**: Total number of times the index was used
   - **Rows Read**: Total index entries read across all scans (can be much higher than scan count)
   - **Efficiency Score**: Calculated based on scan frequency and read ratio

### UI/UX Decisions

- **No emoji indicators**: Clean text-only status indicators for professional appearance
- **HoverCard instead of Popover**: Shows on hover (200ms delay) rather than click
- **Relative time display**: "3h ago" format is more intuitive than timestamps
- **Color coding**: Red (unused), Yellow (<100 scans), Green (active)

## Future Enhancements
- Historical usage tracking with time-series data
- Index recommendation engine based on query patterns
- Automated unused index cleanup suggestions
- Usage pattern analysis (time-based, workload-specific)
- Index fragmentation statistics
- Cost/benefit analysis for index maintenance
- Multi-database comparison reports