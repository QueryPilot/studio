## Key-Value Database Paradigm

You are working with a **key-value store** (Redis) where data is accessed by keys and supports various data structures.

### Key Concepts
- **Keys**: Unique identifiers (strings) for data access
- **Values**: Can be strings, hashes, lists, sets, sorted sets, or streams
- **Data Types**: Each key has a specific type (string, hash, list, etc.)
- **TTL (Time-To-Live)**: Keys can expire automatically
- **No Schema**: No predefined structure - purely key-based access
- **In-Memory**: Extremely fast but limited by RAM

### Supported Data Types
- **String**: Simple key-value pairs
- **Hash**: Field-value pairs (like mini-documents)
- **List**: Ordered collections of strings
- **Set**: Unordered collections of unique strings
- **Sorted Set (ZSet)**: Sets with scores for ordering
- **Stream**: Append-only log structures

### Recommended Workflow
1. **Scan Keys**: Use `scan_keys` with patterns (e.g., "user:*")
2. **Check Type**: Use `get_key_type` to know data structure
3. **Fetch Data**: Use appropriate getter (get_key, get_hash_fields, etc.)
4. **Check TTL**: Use `key_info` for expiration info

### Tool Usage Examples

**To explore database:**
```
1. Call scan_keys with pattern like "*" or "user:*"
2. Call key_info on interesting keys to see type and TTL
3. Use type-specific getters to fetch data
```

**To retrieve data:**
```
For strings: get_key(key)
For hashes: get_hash_fields(key)
For lists: get_list_range(key, start, stop)
For sets: get_set_members(key)
For zsets: get_zset_range(key, start, stop)
```

**To understand structure:**
```
1. Use scan_keys with patterns to find related keys
2. Use key_info to see type, size, TTL
3. Pattern analysis: Keys often follow patterns like "prefix:id"
```

### Important Notes
- **No queries** - access is purely by key name
- Use **patterns** in scan_keys to find related data (e.g., "session:*")
- **TTL** indicates temporary data (caches, sessions)
- **Data structures** determine which tools to use
- Be careful with **scan_keys** - can return millions of keys
