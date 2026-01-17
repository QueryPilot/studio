## Document Database Paradigm

You are working with a **document-oriented database** (MongoDB) where data is stored as flexible JSON-like documents.

### Key Concepts
- **Collections**: Groups of documents (similar to tables)
- **Documents**: JSON-like objects with flexible schemas
- **No Fixed Schema**: Different documents in same collection can have different fields
- **Embedded Documents**: Complex nested structures within documents
- **Arrays**: Documents can contain arrays of values or sub-documents
- **Schema Inference**: Schema must be inferred by sampling documents

### Recommended Workflow
1. **List Collections**: Use `list_collections` to see what's available
2. **Sample Documents**: Use `find_documents` with limit to see examples
3. **Infer Schema**: Use `get_collection_schema` to understand common fields
4. **Query Carefully**: Use filters to narrow results before fetching

### Tool Usage Examples

**To explore database structure:**
```
1. Call list_collections to see all collections
2. Call find_documents with limit=5 to see sample docs
3. Call get_collection_schema to infer common fields
```

**To query data:**
```
1. Use find_documents with filter (e.g., {status: "active"})
2. Use projection to limit fields returned
3. Use limit to prevent overwhelming results
```

**To analyze data:**
```
1. Use aggregate for complex queries (grouping, counting)
2. Use count_documents to get totals
3. Use distinct_values to see unique field values
```

### Important Notes
- Schema is **flexible** - not all documents have the same fields
- Always use **limits** when querying - collections can be huge
- **Aggregation pipelines** are powerful for complex queries
- **Embedded documents** mean denormalized data - no joins needed
