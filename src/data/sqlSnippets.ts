import type { SqlSnippet } from "@/types/sqlSnippets";

/**
 * SQL Snippet Library
 * Common SQL patterns for quick insertion
 */
export const SQL_SNIPPETS: SqlSnippet[] = [
  // QUERY SNIPPETS
  {
    id: "select-all",
    label: "SELECT *",
    category: "query",
    description: "Select all columns from a table",
    template: "SELECT * FROM ${1:table_name};",
  },
  {
    id: "select-columns",
    label: "SELECT columns",
    category: "query",
    description: "Select specific columns",
    template: "SELECT ${1:column1}, ${2:column2}\nFROM ${3:table_name};",
  },
  {
    id: "select-where",
    label: "SELECT WHERE",
    category: "query",
    description: "Select with WHERE clause",
    template: "SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:condition};",
  },
  {
    id: "select-order",
    label: "SELECT ORDER BY",
    category: "query",
    description: "Select with ordering",
    template:
      "SELECT ${1:*}\nFROM ${2:table_name}\nORDER BY ${3:column} ${4:ASC};",
  },
  {
    id: "select-group",
    label: "SELECT GROUP BY",
    category: "query",
    description: "Select with grouping and aggregation",
    template:
      "SELECT ${1:column}, ${2:COUNT(*)}\nFROM ${3:table_name}\nGROUP BY ${1:column};",
  },
  {
    id: "select-distinct",
    label: "SELECT DISTINCT",
    category: "query",
    description: "Select distinct values",
    template: "SELECT DISTINCT ${1:column}\nFROM ${2:table_name};",
  },
  {
    id: "select-limit",
    label: "SELECT LIMIT",
    category: "query",
    description: "Select with limit",
    template: "SELECT ${1:*}\nFROM ${2:table_name}\nLIMIT ${3:10};",
  },
  {
    id: "select-between",
    label: "SELECT BETWEEN",
    category: "query",
    description: "Select with BETWEEN condition",
    template:
      "SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:column} BETWEEN ${4:start} AND ${5:end};",
  },
  {
    id: "select-in",
    label: "SELECT IN",
    category: "query",
    description: "Select with IN clause",
    template:
      "SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:column} IN (${4:values});",
  },
  {
    id: "select-like",
    label: "SELECT LIKE",
    category: "query",
    description: "Select with LIKE pattern matching",
    template:
      "SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:column} LIKE '${4:%pattern%}';",
  },

  // INSERT SNIPPETS
  {
    id: "insert-values",
    label: "INSERT INTO",
    category: "insert",
    description: "Insert values into table",
    template:
      "INSERT INTO ${1:table_name} (${2:column1}, ${3:column2})\nVALUES (${4:value1}, ${5:value2});",
  },
  {
    id: "insert-select",
    label: "INSERT SELECT",
    category: "insert",
    description: "Insert from SELECT query",
    template:
      "INSERT INTO ${1:target_table} (${2:columns})\nSELECT ${2:columns}\nFROM ${3:source_table}\nWHERE ${4:condition};",
  },
  {
    id: "insert-returning",
    label: "INSERT RETURNING",
    category: "insert",
    description: "Insert and return inserted values (PostgreSQL)",
    template:
      "INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values})\nRETURNING ${4:*};",
    dialects: ["postgresql"],
  },

  // UPDATE SNIPPETS
  {
    id: "update-basic",
    label: "UPDATE",
    category: "update",
    description: "Update table rows",
    template:
      "UPDATE ${1:table_name}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};",
  },
  {
    id: "update-multiple",
    label: "UPDATE multiple",
    category: "update",
    description: "Update multiple columns",
    template:
      "UPDATE ${1:table_name}\nSET\n  ${2:column1} = ${3:value1},\n  ${4:column2} = ${5:value2}\nWHERE ${6:condition};",
  },
  {
    id: "update-from",
    label: "UPDATE FROM",
    category: "update",
    description: "Update with FROM clause (PostgreSQL)",
    template:
      "UPDATE ${1:table_name} t1\nSET ${2:column} = ${3:value}\nFROM ${4:table_name2} t2\nWHERE t1.${5:id} = t2.${6:id};",
    dialects: ["postgresql"],
  },

  // DELETE SNIPPETS
  {
    id: "delete-basic",
    label: "DELETE",
    category: "delete",
    description: "Delete rows from table",
    template: "DELETE FROM ${1:table_name}\nWHERE ${2:condition};",
  },
  {
    id: "delete-all",
    label: "DELETE ALL",
    category: "delete",
    description: "Delete all rows (use with caution!)",
    template: "DELETE FROM ${1:table_name};",
  },

  // JOIN SNIPPETS
  {
    id: "inner-join",
    label: "INNER JOIN",
    category: "join",
    description: "Inner join two tables",
    template:
      "SELECT ${1:*}\nFROM ${2:table1} t1\nINNER JOIN ${3:table2} t2\n  ON t1.${4:id} = t2.${5:id};",
  },
  {
    id: "left-join",
    label: "LEFT JOIN",
    category: "join",
    description: "Left outer join",
    template:
      "SELECT ${1:*}\nFROM ${2:table1} t1\nLEFT JOIN ${3:table2} t2\n  ON t1.${4:id} = t2.${5:id};",
  },
  {
    id: "right-join",
    label: "RIGHT JOIN",
    category: "join",
    description: "Right outer join",
    template:
      "SELECT ${1:*}\nFROM ${2:table1} t1\nRIGHT JOIN ${3:table2} t2\n  ON t1.${4:id} = t2.${5:id};",
  },
  {
    id: "full-join",
    label: "FULL JOIN",
    category: "join",
    description: "Full outer join",
    template:
      "SELECT ${1:*}\nFROM ${2:table1} t1\nFULL JOIN ${3:table2} t2\n  ON t1.${4:id} = t2.${5:id};",
  },
  {
    id: "cross-join",
    label: "CROSS JOIN",
    category: "join",
    description: "Cross join (Cartesian product)",
    template: "SELECT ${1:*}\nFROM ${2:table1} t1\nCROSS JOIN ${3:table2} t2;",
  },

  // CTE SNIPPETS
  {
    id: "cte-simple",
    label: "WITH (CTE)",
    category: "cte",
    description: "Common Table Expression",
    template:
      "WITH ${1:cte_name} AS (\n  SELECT ${2:*}\n  FROM ${3:table_name}\n  WHERE ${4:condition}\n)\nSELECT * FROM ${1:cte_name};",
  },
  {
    id: "cte-multiple",
    label: "WITH multiple CTEs",
    category: "cte",
    description: "Multiple Common Table Expressions",
    template:
      "WITH ${1:cte1} AS (\n  SELECT ${2:*} FROM ${3:table1}\n),\n${4:cte2} AS (\n  SELECT ${5:*} FROM ${6:table2}\n)\nSELECT *\nFROM ${1:cte1}\nJOIN ${4:cte2} ON ${1:cte1}.${7:id} = ${4:cte2}.${8:id};",
  },
  {
    id: "cte-recursive",
    label: "WITH RECURSIVE",
    category: "cte",
    description: "Recursive CTE for hierarchical data",
    template:
      "WITH RECURSIVE ${1:cte_name} AS (\n  -- Base case\n  SELECT ${2:*}\n  FROM ${3:table_name}\n  WHERE ${4:base_condition}\n  \n  UNION ALL\n  \n  -- Recursive case\n  SELECT ${5:*}\n  FROM ${3:table_name} t\n  JOIN ${1:cte_name} c ON t.${6:parent_id} = c.${7:id}\n)\nSELECT * FROM ${1:cte_name};",
    dialects: ["postgresql", "mysql", "sqlite"],
  },

  // WINDOW FUNCTION SNIPPETS
  {
    id: "window-row-number",
    label: "ROW_NUMBER()",
    category: "window",
    description: "Assign row numbers",
    template:
      "SELECT\n  ${1:*},\n  ROW_NUMBER() OVER (ORDER BY ${2:column}) AS row_num\nFROM ${3:table_name};",
  },
  {
    id: "window-rank",
    label: "RANK()",
    category: "window",
    description: "Assign rank with gaps",
    template:
      "SELECT\n  ${1:*},\n  RANK() OVER (ORDER BY ${2:column} DESC) AS rank\nFROM ${3:table_name};",
  },
  {
    id: "window-partition",
    label: "PARTITION BY",
    category: "window",
    description: "Window function with partition",
    template:
      "SELECT\n  ${1:*},\n  ${2:ROW_NUMBER()} OVER (\n    PARTITION BY ${3:category}\n    ORDER BY ${4:column}\n  ) AS ${5:rank}\nFROM ${6:table_name};",
  },
  {
    id: "window-lag-lead",
    label: "LAG/LEAD",
    category: "window",
    description: "Access previous/next row values",
    template:
      "SELECT\n  ${1:*},\n  LAG(${2:column}, 1) OVER (ORDER BY ${3:date}) AS prev_value,\n  LEAD(${2:column}, 1) OVER (ORDER BY ${3:date}) AS next_value\nFROM ${4:table_name};",
  },

  // DDL SNIPPETS
  {
    id: "create-table",
    label: "CREATE TABLE",
    category: "ddl",
    description: "Create a new table",
    template:
      "CREATE TABLE ${1:table_name} (\n  ${2:id} ${3:SERIAL} PRIMARY KEY,\n  ${4:column1} ${5:VARCHAR(255)} NOT NULL,\n  ${6:created_at} TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);",
  },
  {
    id: "alter-add-column",
    label: "ALTER TABLE ADD",
    category: "ddl",
    description: "Add a column to existing table",
    template:
      "ALTER TABLE ${1:table_name}\nADD COLUMN ${2:column_name} ${3:data_type} ${4:NOT NULL};",
  },
  {
    id: "alter-drop-column",
    label: "ALTER TABLE DROP",
    category: "ddl",
    description: "Drop a column from table",
    template: "ALTER TABLE ${1:table_name}\nDROP COLUMN ${2:column_name};",
  },
  {
    id: "create-index",
    label: "CREATE INDEX",
    category: "index",
    description: "Create an index",
    template: "CREATE INDEX ${1:idx_name}\nON ${2:table_name} (${3:column});",
  },
  {
    id: "create-unique-index",
    label: "CREATE UNIQUE INDEX",
    category: "index",
    description: "Create a unique index",
    template:
      "CREATE UNIQUE INDEX ${1:idx_name}\nON ${2:table_name} (${3:column});",
  },

  // TRANSACTION SNIPPETS
  {
    id: "transaction",
    label: "BEGIN TRANSACTION",
    category: "transaction",
    description: "Transaction block",
    template:
      "BEGIN;\n\n${1:-- Your SQL statements here}\n\nCOMMIT;\n-- or ROLLBACK;",
  },
  {
    id: "savepoint",
    label: "SAVEPOINT",
    category: "transaction",
    description: "Create a savepoint in transaction",
    template:
      "SAVEPOINT ${1:savepoint_name};\n\n${2:-- SQL statements}\n\n-- ROLLBACK TO ${1:savepoint_name};",
  },

  // PERFORMANCE SNIPPETS
  {
    id: "explain",
    label: "EXPLAIN",
    category: "performance",
    description: "Analyze query execution plan",
    template: "EXPLAIN ${1:ANALYZE}\n${2:SELECT * FROM table_name};",
  },
  {
    id: "explain-verbose",
    label: "EXPLAIN VERBOSE",
    category: "performance",
    description: "Detailed query execution plan (PostgreSQL)",
    template:
      "EXPLAIN (ANALYZE, BUFFERS, VERBOSE)\n${1:SELECT * FROM table_name};",
    dialects: ["postgresql"],
  },
];

/**
 * Get snippets by category
 */
export function getSnippetsByCategory(category: string) {
  return SQL_SNIPPETS.filter((s) => s.category === category);
}

/**
 * Get snippets by dialect
 */
export function getSnippetsForDialect(dialect: string) {
  return SQL_SNIPPETS.filter(
    (s) => !s.dialects || s.dialects.includes(dialect),
  );
}

/**
 * Search snippets
 */
export function searchSnippets(query: string) {
  const lowerQuery = query.toLowerCase();
  return SQL_SNIPPETS.filter(
    (s) =>
      s.label.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery) ||
      s.id.includes(lowerQuery),
  );
}
