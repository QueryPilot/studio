//! SQL Snippets for common patterns.

use serde::{Deserialize, Serialize};

/// Snippet category.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SnippetCategory {
    Query,
    Dml,
    Ddl,
    Plpgsql,
    Common,
}

/// A SQL snippet.
#[derive(Debug, Clone, Serialize)]
pub struct SnippetItem {
    pub name: String,
    pub prefix: String,
    pub body: String,
    pub description: String,
    pub category: SnippetCategory,
}

/// Get all available snippets.
pub fn get_all_snippets() -> Vec<SnippetItem> {
    let mut snippets = Vec::new();
    snippets.extend(get_query_snippets());
    snippets.extend(get_dml_snippets());
    snippets.extend(get_ddl_snippets());
    snippets.extend(get_common_snippets());
    snippets
}

/// Get snippets by category.
pub fn get_snippets_by_category(category: SnippetCategory) -> Vec<SnippetItem> {
    match category {
        SnippetCategory::Query => get_query_snippets(),
        SnippetCategory::Dml => get_dml_snippets(),
        SnippetCategory::Ddl => get_ddl_snippets(),
        SnippetCategory::Plpgsql => get_plpgsql_snippets(),
        SnippetCategory::Common => get_common_snippets(),
    }
}

/// Get snippets matching a prefix.
pub fn get_snippets(prefix: &str) -> Vec<SnippetItem> {
    get_all_snippets()
        .into_iter()
        .filter(|s| s.prefix.starts_with(prefix) || s.name.to_lowercase().contains(&prefix.to_lowercase()))
        .collect()
}

fn get_query_snippets() -> Vec<SnippetItem> {
    vec![
        SnippetItem {
            name: "Select All".to_string(),
            prefix: "sel".to_string(),
            body: "SELECT *\nFROM ${1:table}\nWHERE ${2:condition}".to_string(),
            description: "SELECT all columns".to_string(),
            category: SnippetCategory::Query,
        },
        SnippetItem {
            name: "Select Columns".to_string(),
            prefix: "selc".to_string(),
            body: "SELECT ${1:columns}\nFROM ${2:table}\nWHERE ${3:condition}".to_string(),
            description: "SELECT specific columns".to_string(),
            category: SnippetCategory::Query,
        },
        SnippetItem {
            name: "Select Join".to_string(),
            prefix: "selj".to_string(),
            body: "SELECT ${1:columns}\nFROM ${2:table1} t1\nJOIN ${3:table2} t2 ON t1.${4:column} = t2.${5:column}\nWHERE ${6:condition}".to_string(),
            description: "SELECT with JOIN".to_string(),
            category: SnippetCategory::Query,
        },
        SnippetItem {
            name: "Select Count".to_string(),
            prefix: "selcount".to_string(),
            body: "SELECT COUNT(*)\nFROM ${1:table}\nWHERE ${2:condition}".to_string(),
            description: "Count rows".to_string(),
            category: SnippetCategory::Query,
        },
        SnippetItem {
            name: "Select Group By".to_string(),
            prefix: "selg".to_string(),
            body: "SELECT ${1:column}, COUNT(*)\nFROM ${2:table}\nGROUP BY ${1:column}\nHAVING ${3:condition}".to_string(),
            description: "SELECT with GROUP BY".to_string(),
            category: SnippetCategory::Query,
        },
        SnippetItem {
            name: "CTE".to_string(),
            prefix: "cte".to_string(),
            body: "WITH ${1:name} AS (\n    ${2:query}\n)\nSELECT *\nFROM ${1:name}".to_string(),
            description: "Common Table Expression".to_string(),
            category: SnippetCategory::Query,
        },
    ]
}

fn get_dml_snippets() -> Vec<SnippetItem> {
    vec![
        SnippetItem {
            name: "Insert".to_string(),
            prefix: "ins".to_string(),
            body: "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})".to_string(),
            description: "INSERT row".to_string(),
            category: SnippetCategory::Dml,
        },
        SnippetItem {
            name: "Update".to_string(),
            prefix: "upd".to_string(),
            body: "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition}".to_string(),
            description: "UPDATE rows".to_string(),
            category: SnippetCategory::Dml,
        },
        SnippetItem {
            name: "Delete".to_string(),
            prefix: "del".to_string(),
            body: "DELETE FROM ${1:table}\nWHERE ${2:condition}".to_string(),
            description: "DELETE rows".to_string(),
            category: SnippetCategory::Dml,
        },
        SnippetItem {
            name: "Upsert".to_string(),
            prefix: "ups".to_string(),
            body: "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})\nON CONFLICT (${4:key}) DO UPDATE SET\n    ${5:column} = EXCLUDED.${5:column}".to_string(),
            description: "INSERT or UPDATE".to_string(),
            category: SnippetCategory::Dml,
        },
    ]
}

fn get_ddl_snippets() -> Vec<SnippetItem> {
    vec![
        SnippetItem {
            name: "Create Table".to_string(),
            prefix: "ct".to_string(),
            body: "CREATE TABLE ${1:name} (\n    id SERIAL PRIMARY KEY,\n    ${2:column} ${3:type} NOT NULL,\n    created_at TIMESTAMPTZ DEFAULT NOW()\n)".to_string(),
            description: "CREATE TABLE".to_string(),
            category: SnippetCategory::Ddl,
        },
        SnippetItem {
            name: "Create Index".to_string(),
            prefix: "ci".to_string(),
            body: "CREATE INDEX ${1:idx_name} ON ${2:table} (${3:columns})".to_string(),
            description: "CREATE INDEX".to_string(),
            category: SnippetCategory::Ddl,
        },
        SnippetItem {
            name: "Add Column".to_string(),
            prefix: "ac".to_string(),
            body: "ALTER TABLE ${1:table}\nADD COLUMN ${2:column} ${3:type}".to_string(),
            description: "Add column to table".to_string(),
            category: SnippetCategory::Ddl,
        },
        SnippetItem {
            name: "Drop Column".to_string(),
            prefix: "dc".to_string(),
            body: "ALTER TABLE ${1:table}\nDROP COLUMN ${2:column}".to_string(),
            description: "Drop column from table".to_string(),
            category: SnippetCategory::Ddl,
        },
    ]
}

fn get_plpgsql_snippets() -> Vec<SnippetItem> {
    vec![
        SnippetItem {
            name: "Function".to_string(),
            prefix: "func".to_string(),
            body: r#"CREATE OR REPLACE FUNCTION ${1:name}(${2:params})
RETURNS ${3:type} AS $$
BEGIN
    ${4:body}
END;
$$ LANGUAGE plpgsql"#.to_string(),
            description: "Create PL/pgSQL function".to_string(),
            category: SnippetCategory::Plpgsql,
        },
        SnippetItem {
            name: "Trigger".to_string(),
            prefix: "trig".to_string(),
            body: r#"CREATE TRIGGER ${1:name}
    ${2:BEFORE|AFTER} ${3:INSERT|UPDATE|DELETE} ON ${4:table}
    FOR EACH ROW
    EXECUTE FUNCTION ${5:function}()"#.to_string(),
            description: "Create trigger".to_string(),
            category: SnippetCategory::Plpgsql,
        },
    ]
}

fn get_common_snippets() -> Vec<SnippetItem> {
    vec![
        SnippetItem {
            name: "Begin Transaction".to_string(),
            prefix: "begin".to_string(),
            body: "BEGIN;\n${1:statements}\nCOMMIT;".to_string(),
            description: "Transaction block".to_string(),
            category: SnippetCategory::Common,
        },
        SnippetItem {
            name: "Explain Analyze".to_string(),
            prefix: "expl".to_string(),
            body: "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)\n${1:query}".to_string(),
            description: "Query plan analysis".to_string(),
            category: SnippetCategory::Common,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_snippets() {
        let snippets = get_snippets("sel");
        assert!(!snippets.is_empty());
        assert!(snippets.iter().all(|s| s.prefix.starts_with("sel") || s.name.to_lowercase().contains("sel")));
    }

    #[test]
    fn test_all_snippets() {
        let snippets = get_all_snippets();
        assert!(snippets.len() > 10);
    }
}
