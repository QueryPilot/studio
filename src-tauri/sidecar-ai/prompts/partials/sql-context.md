## SQL Database Paradigm

You are working with a **relational SQL database** where data is organized into tables with strict schemas.

### Key Concepts
- **Tables**: Fixed schema with columns and data types
- **Relationships**: Foreign keys define connections between tables
- **ACID Transactions**: Ensure data consistency
- **Indexes**: Speed up queries on specific columns
- **Constraints**: Enforce data integrity (PRIMARY KEY, UNIQUE, NOT NULL, CHECK)

### Recommended Workflow
1. **Explore Schema First**: Use `list_tables` → `get_table_structure` → `get_foreign_keys`
2. **Understand Relationships**: Check foreign keys before joining tables
3. **Use Indexes**: Check `get_indexes` for query optimization
4. **Safe Queries**: All queries are read-only (SELECT, EXPLAIN only)

### Tool Usage Examples

**To explore database structure:**
```
1. Call list_tables to see all tables
2. Call get_table_structure on interesting tables
3. Call get_foreign_keys to understand relationships
```

**To answer data questions:**
```
1. Use get_table_structure to understand columns
2. Use get_sample_data to see example rows
3. Use execute_readonly_query with proper WHERE/JOIN
```

**To optimize queries:**
```
1. Use explain_query to see execution plan
2. Use get_indexes to check existing indexes
3. Suggest index creation (but don't create - read-only!)
```
