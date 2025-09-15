# Index Usage Statistics Implementation Specification

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
  indexName: string;
  scanCount?: number;
  rowsRead?: number;
  rowsReturned?: number;
  lastAccessed?: string;
  cacheHitRatio?: number;
  sizeBytes?: number;
  sizePretty?: string;
  isUnused: boolean;
  efficiencyScore?: number; // 0-100
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

```sql
-- Main usage statistics
SELECT
    i.indexrelname AS index_name,
    s.idx_scan AS scan_count,
    s.idx_tup_read AS rows_read,
    s.idx_tup_fetch AS rows_returned,
    pg_size_pretty(pg_relation_size(s.indexrelid)) AS size_pretty,
    pg_relation_size(s.indexrelid) AS size_bytes,
    CASE
        WHEN s.idx_scan = 0 THEN true
        ELSE false
    END AS is_unused,
    -- Cache hit ratio from pg_statio_user_indexes
    CASE
        WHEN io.idx_blks_read + io.idx_blks_hit = 0 THEN NULL
        ELSE (io.idx_blks_hit::float / (io.idx_blks_read + io.idx_blks_hit)) * 100
    END AS cache_hit_ratio
FROM
    pg_stat_user_indexes s
    LEFT JOIN pg_statio_user_indexes io
        ON s.indexrelid = io.indexrelid
WHERE
    s.schemaname = $1
    AND s.tablename = $2
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
    if (!stats) return { color: 'gray', icon: '⚪', label: 'N/A' };

    if (stats.isUnused) {
        return { color: 'red', icon: '🔴', label: 'Unused' };
    }

    if (stats.scanCount < 100) {
        return { color: 'yellow', icon: '🟡', label: 'Low usage' };
    }

    return { color: 'green', icon: '🟢', label: 'Active' };
};
```

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

### Tooltip Details
```html
<Tooltip>
    <div>
        <strong>Index Usage Statistics</strong>
        <div>Scans: {stats.scanCount}</div>
        <div>Rows Read: {stats.rowsRead}</div>
        <div>Cache Hit: {stats.cacheHitRatio}%</div>
        <div>Last Used: {stats.lastAccessed || 'Never'}</div>
        <div>Size: {stats.sizePretty}</div>
    </div>
</Tooltip>
```

## Implementation Steps

### Phase 1: Backend Foundation
1. ✅ Define IndexUsageStats struct in Rust
2. ✅ Add trait method to database adapter interface
3. ✅ Implement PostgreSQL adapter method
4. ⬜ Add Tauri command `get_index_usage_stats`

### Phase 2: Frontend Integration
5. ⬜ Update TypeScript interfaces
6. ⬜ Modify TableIndexes component
7. ⬜ Add visual indicators and tooltips
8. ⬜ Implement caching layer

### Phase 3: Additional Databases
9. ⬜ Implement MySQL adapter
10. ⬜ Implement SQL Server adapter
11. ⬜ Add SQLite stub with capability flag

### Phase 4: Polish
12. ⬜ Add refresh button
13. ⬜ Implement efficiency scoring algorithm
14. ⬜ Add sorting by usage
15. ⬜ Export usage report feature

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

## Future Enhancements
- Historical usage tracking
- Index recommendation engine
- Automated unused index cleanup suggestions
- Usage pattern analysis (time-based)
- Index fragmentation statistics