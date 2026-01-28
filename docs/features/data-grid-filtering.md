# Data Grid Filtering

Query Pilot provides powerful filtering capabilities across all supported database paradigms. Each paradigm (SQL, Document, Key-Value) has filtering options tailored to its query capabilities.

## Overview

| Feature | SQL (PostgreSQL, MySQL, etc.) | Document (MongoDB) | Key-Value (Redis) |
|---------|-------------------------------|-------------------|-------------------|
| Search mode | ✅ | ✅ | ✅ |
| Query mode | ✅ SQL WHERE clause | ✅ MongoDB query | ❌ |
| Pattern wildcards | N/A | N/A | ✅ |

---

## SQL Databases (PostgreSQL, MySQL, SQLite, SQL Server)

SQL databases support three filtering modes, indicated by a prefix character.

### Search Mode (Default)

Type text without any prefix to search across all text columns.

**Examples:**
```
john                    # Find "john" in any column
john smith              # Find rows containing both "john" AND "smith"
john | smith            # Find rows containing "john" OR "smith"
-deleted                # Exclude rows containing "deleted"
"exact phrase"          # Search for exact phrase
```

**Advanced Search Syntax:**
| Syntax | Description | Example |
|--------|-------------|---------|
| `word` | Contains (case-insensitive) | `john` |
| `"phrase"` | Exact phrase | `"John Smith"` |
| `word1 word2` | AND (both required) | `john active` |
| `word1 \| word2` | OR (either matches) | `john \| jane` |
| `-word` | NOT (exclude) | `-deleted` |
| `^word` | Starts with | `^admin` |
| `word$` | Ends with | `@gmail.com$` |
| `/regex/` | Regular expression | `/^user_\d+$/` |
| `column:value` | Search specific column | `status:active` |

### Query Mode (? prefix)

Type `?` followed by a SQL WHERE clause for precise filtering.

**Examples:**
```
?status = 'active'
?age > 18 AND age < 65
?created_at >= '2024-01-01'
?status IN ('active', 'pending')
?email IS NOT NULL
?name LIKE 'John%'
?price BETWEEN 10 AND 100
```

**Supported Operators:**
- Comparison: `=`, `!=`, `<>`, `<`, `<=`, `>`, `>=`
- Pattern: `LIKE`, `ILIKE`, `NOT LIKE`
- List: `IN`, `NOT IN`
- Null: `IS NULL`, `IS NOT NULL`
- Range: `BETWEEN`
- Logical: `AND`, `OR`, `NOT`

---

## MongoDB (Document Database)

MongoDB supports search mode and query mode with MongoDB-specific syntax.

### Search Mode (Default)

Type text without any prefix to search across all document fields.

**Examples:**
```
john                    # Find "john" in any field
status:active           # Find documents where status contains "active"
address.city:NYC        # Search nested fields with dot notation
```

**Search Syntax:**
| Syntax | Description | Example |
|--------|-------------|---------|
| `text` | Search all fields | `john` |
| `field:value` | Search specific field | `status:active` |
| `field.nested:value` | Search nested field | `address.city:NYC` |
| `-text` | Exclude matches | `-deleted` |
| `word1 word2` | AND (both required) | `active premium` |

### Query Mode (? prefix)

Type `?` followed by a MongoDB query. Supports both JSON syntax and simplified syntax.

**JSON Query Syntax:**
```
?{ "status": "active" }
?{ "age": { "$gt": 18 } }
?{ "status": { "$in": ["active", "pending"] } }
?{ "address.city": "NYC" }
?{ "$or": [{ "status": "active" }, { "priority": "high" }] }
?{ "name": { "$regex": "^john", "$options": "i" } }
?{ "tags": { "$exists": true } }
```

**Simplified Query Syntax:**
```
?status = "active"
?age > 18
?age >= 21 AND age <= 65
?status IN ("active", "pending")
?email IS NOT NULL
?name LIKE "John%"
```

**Supported MongoDB Operators:**
| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equals | `{ "status": "active" }` |
| `$ne` | Not equals | `{ "status": { "$ne": "deleted" } }` |
| `$gt`, `$gte` | Greater than (or equal) | `{ "age": { "$gt": 18 } }` |
| `$lt`, `$lte` | Less than (or equal) | `{ "price": { "$lt": 100 } }` |
| `$in`, `$nin` | In / Not in array | `{ "status": { "$in": ["a", "b"] } }` |
| `$exists` | Field exists | `{ "email": { "$exists": true } }` |
| `$regex` | Regular expression | `{ "name": { "$regex": "^john", "$options": "i" } }` |
| `$and`, `$or` | Logical operators | `{ "$or": [{...}, {...}] }` |

---

## Redis (Key-Value Store)

Redis filtering is simpler because Redis is a key-value store without a query language. Only search and pattern modes are supported.

> **Note:** Query mode (`?`) is not available for Redis because Redis doesn't have a query language - data is accessed by key, not by querying field values.

### Browser Mode (Key List)

When viewing the list of keys in a Redis database, use the pattern filter in the toolbar.

**Pattern Examples:**
```
user:*                  # Keys starting with "user:"
*:session:*             # Keys containing ":session:"
cache:user:?            # Keys like cache:user:1, cache:user:a
```

### Key View Mode (Hash, List, Set, ZSet)

When viewing the contents of a specific key, use search or pattern filtering.

#### Search Mode (Default)

Type text to search across all visible data.

**Examples:**
```
john                    # Find "john" in any field or value
field:value             # Search in specific column
```

**By Redis Type:**

| Type | What is Searched |
|------|------------------|
| Hash | Field names and values |
| List | List item values |
| Set | Set members |
| ZSet | Member names and scores |

#### Pattern Mode (Wildcards)

Use `*` or `?` wildcards to filter by field/member names.

**Pattern Syntax:**
| Wildcard | Description | Example |
|----------|-------------|---------|
| `*` | Match any characters (zero or more) | `user_*` matches `user_1`, `user_abc` |
| `?` | Match exactly one character | `item_?` matches `item_1`, `item_a` |

**Examples by Redis Type:**

| Type | Pattern Example | Matches |
|------|-----------------|---------|
| Hash | `config_*` | Fields starting with "config_" |
| Set | `*_active` | Members ending with "_active" |
| ZSet | `user_???` | Members like "user_001", "user_abc" |

---

## Quick Reference

### Mode Prefixes

| Prefix | Mode | Available In |
|--------|------|--------------|
| (none) | Search | SQL, MongoDB, Redis |
| `?` | Query | SQL, MongoDB |

### Common Filter Patterns

**Find active items:**
- SQL: `?status = 'active'` or just `active`
- MongoDB: `?{ "status": "active" }` or `status:active`
- Redis: `active` (searches values)

**Find by date range:**
- SQL: `?created_at >= '2024-01-01' AND created_at < '2024-02-01'`
- MongoDB: `?{ "createdAt": { "$gte": "2024-01-01", "$lt": "2024-02-01" } }`
- Redis: N/A (no date queries)

**Exclude deleted:**
- SQL: `?deleted_at IS NULL` or `-deleted`
- MongoDB: `?{ "deletedAt": null }` or `-deleted`
- Redis: `-deleted` (client-side search)

**Pattern matching:**
- SQL: `?name LIKE 'John%'`
- MongoDB: `?{ "name": { "$regex": "^John" } }`
- Redis: `John*` (for field/member names)

---

## Tips

1. **Start simple**: Use search mode first - it's often sufficient for quick filtering.

2. **Use column targeting**: In search mode, `column:value` syntax narrows the search to specific fields.

3. **Escape special characters**: Use quotes for phrases with spaces: `"John Smith"`.

4. **Case sensitivity**: Search mode is case-insensitive by default. Use `!` prefix for case-sensitive search in SQL.

5. **Performance**:
   - SQL/MongoDB query mode filters server-side (faster for large datasets)
   - Redis filtering is client-side (loads data first, then filters)
