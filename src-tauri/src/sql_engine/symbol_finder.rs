//! Symbol reference finding for SQL Smart Rename.
//!
//! Finds all references to a symbol (alias, CTE name, column alias) within a SQL query.
//! This is the foundation for the Smart Rename (F2) feature.

use serde::{Deserialize, Serialize};
use sqlparser::ast::{Expr, Query, SelectItem, SetExpr, Statement, TableFactor};

use super::outline::TextSpan;

/// References to a SQL symbol including its definition and all usages.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SymbolReferences {
    pub symbol_kind: SymbolKind,
    pub definition_span: TextSpan,
    pub references: Vec<TextSpan>,
}

/// Kind of SQL symbol that can be renamed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum SymbolKind {
    TableAlias,  // FROM users u  →  "u"
    CteName,     // WITH active_users AS (...)  →  "active_users"
    ColumnAlias, // SELECT id AS user_id  →  "user_id"
}

/// Internal representation of a symbol definition with its scope.
#[derive(Clone, Debug)]
struct SymbolDefinition {
    name: String,
    kind: SymbolKind,
    definition_span: TextSpan,
    /// Byte range of the scope where this symbol is valid
    scope_start: usize,
    scope_end: usize,
}

/// Finds symbol references in SQL source.
pub struct SymbolFinder<'a> {
    source: &'a str,
}

impl<'a> SymbolFinder<'a> {
    pub fn new(source: &'a str) -> Self {
        Self { source }
    }

    /// Find the symbol at a given cursor offset and all its references.
    /// Returns None if cursor is not on a renameable symbol.
    pub fn find_symbol_at(
        &self,
        statements: &[Statement],
        offset: usize,
    ) -> Option<SymbolReferences> {
        // Collect all symbol definitions with their scopes
        let definitions = self.collect_all_definitions(statements);

        // Find which symbol the cursor is on
        let symbol = self.find_symbol_at_offset(&definitions, offset)?;

        // Find all references to this symbol within its scope
        let references = self.find_references_in_scope(&symbol);

        Some(SymbolReferences {
            symbol_kind: symbol.kind,
            definition_span: symbol.definition_span,
            references,
        })
    }

    /// Find all references to a known symbol by name and kind.
    /// This searches globally without scope restrictions (for simple use cases).
    pub fn find_references(
        &self,
        statements: &[Statement],
        symbol_name: &str,
        symbol_kind: SymbolKind,
    ) -> Vec<TextSpan> {
        // First, find the definition to know where it is (to exclude it)
        let definitions = self.collect_all_definitions(statements);
        let definition = definitions
            .iter()
            .find(|d| d.name.eq_ignore_ascii_case(symbol_name) && d.kind == symbol_kind);

        let definition_span = definition.map(|d| d.definition_span);

        // Find all occurrences of the symbol name
        self.find_all_occurrences(symbol_name, 0, self.source.len(), definition_span)
    }

    /// Collect all symbol definitions from the statements.
    fn collect_all_definitions(&self, statements: &[Statement]) -> Vec<SymbolDefinition> {
        let mut definitions = Vec::new();

        for stmt in statements {
            self.collect_definitions_from_statement(stmt, 0, self.source.len(), &mut definitions);
        }

        definitions
    }

    /// Collect definitions from a single statement.
    fn collect_definitions_from_statement(
        &self,
        stmt: &Statement,
        scope_start: usize,
        scope_end: usize,
        definitions: &mut Vec<SymbolDefinition>,
    ) {
        if let Statement::Query(query) = stmt {
            self.collect_definitions_from_query(query, scope_start, scope_end, definitions);
        }
    }

    /// Collect definitions from a Query (handles CTEs and main body).
    fn collect_definitions_from_query(
        &self,
        query: &Query,
        scope_start: usize,
        scope_end: usize,
        definitions: &mut Vec<SymbolDefinition>,
    ) {
        // Collect CTE definitions
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                let cte_name = &cte.alias.name.value;
                if let Some(span) = self.find_identifier_span(cte_name, scope_start, scope_end) {
                    definitions.push(SymbolDefinition {
                        name: cte_name.clone(),
                        kind: SymbolKind::CteName,
                        definition_span: span,
                        scope_start,
                        scope_end,
                    });
                }
            }
        }

        // Collect from body
        self.collect_definitions_from_set_expr(
            query.body.as_ref(),
            scope_start,
            scope_end,
            definitions,
        );
    }

    /// Collect definitions from SetExpr.
    fn collect_definitions_from_set_expr(
        &self,
        set_expr: &SetExpr,
        scope_start: usize,
        scope_end: usize,
        definitions: &mut Vec<SymbolDefinition>,
    ) {
        match set_expr {
            SetExpr::Select(select) => {
                // Collect column aliases from SELECT items
                for item in &select.projection {
                    if let SelectItem::ExprWithAlias { alias, .. } = item {
                        let alias_name = &alias.value;
                        // Search for alias after "AS" keyword
                        if let Some(span) =
                            self.find_identifier_span(alias_name, scope_start, scope_end)
                        {
                            definitions.push(SymbolDefinition {
                                name: alias_name.clone(),
                                kind: SymbolKind::ColumnAlias,
                                definition_span: span,
                                scope_start,
                                scope_end,
                            });
                        }
                    }
                }

                // Collect table aliases from FROM clause
                for table_with_joins in &select.from {
                    self.collect_table_alias(
                        &table_with_joins.relation,
                        scope_start,
                        scope_end,
                        definitions,
                    );

                    for join in &table_with_joins.joins {
                        self.collect_table_alias(
                            &join.relation,
                            scope_start,
                            scope_end,
                            definitions,
                        );
                    }
                }

                // Handle subqueries in WHERE clause
                if let Some(where_clause) = &select.selection {
                    self.collect_definitions_from_expr(where_clause, definitions);
                }
            }
            SetExpr::Query(query) => {
                self.collect_definitions_from_query(query, scope_start, scope_end, definitions);
            }
            SetExpr::SetOperation { left, right, .. } => {
                self.collect_definitions_from_set_expr(left, scope_start, scope_end, definitions);
                self.collect_definitions_from_set_expr(right, scope_start, scope_end, definitions);
            }
            _ => {}
        }
    }

    /// Collect definitions from expressions (handles subqueries).
    fn collect_definitions_from_expr(&self, expr: &Expr, definitions: &mut Vec<SymbolDefinition>) {
        match expr {
            Expr::Subquery(query) => {
                // Find the subquery's span in source
                if let Some((sub_start, sub_end)) = self.find_subquery_span(query) {
                    self.collect_definitions_from_query(query, sub_start, sub_end, definitions);
                }
            }
            Expr::InSubquery { subquery, expr, .. } => {
                self.collect_definitions_from_expr(expr, definitions);
                if let Some((sub_start, sub_end)) = self.find_subquery_span(subquery) {
                    self.collect_definitions_from_query(subquery, sub_start, sub_end, definitions);
                }
            }
            Expr::Exists { subquery, .. } => {
                if let Some((sub_start, sub_end)) = self.find_subquery_span(subquery) {
                    self.collect_definitions_from_query(subquery, sub_start, sub_end, definitions);
                }
            }
            Expr::BinaryOp { left, right, .. } => {
                self.collect_definitions_from_expr(left, definitions);
                self.collect_definitions_from_expr(right, definitions);
            }
            Expr::UnaryOp { expr, .. } => {
                self.collect_definitions_from_expr(expr, definitions);
            }
            Expr::Nested(inner) => {
                self.collect_definitions_from_expr(inner, definitions);
            }
            Expr::Between {
                expr, low, high, ..
            } => {
                self.collect_definitions_from_expr(expr, definitions);
                self.collect_definitions_from_expr(low, definitions);
                self.collect_definitions_from_expr(high, definitions);
            }
            Expr::Case {
                operand,
                conditions,
                results,
                else_result,
                ..
            } => {
                if let Some(op) = operand {
                    self.collect_definitions_from_expr(op, definitions);
                }
                for cond in conditions {
                    self.collect_definitions_from_expr(cond, definitions);
                }
                for res in results {
                    self.collect_definitions_from_expr(res, definitions);
                }
                if let Some(else_expr) = else_result {
                    self.collect_definitions_from_expr(else_expr, definitions);
                }
            }
            Expr::InList { expr, list, .. } => {
                self.collect_definitions_from_expr(expr, definitions);
                for item in list {
                    self.collect_definitions_from_expr(item, definitions);
                }
            }
            _ => {}
        }
    }

    /// Collect table alias from TableFactor.
    fn collect_table_alias(
        &self,
        factor: &TableFactor,
        scope_start: usize,
        scope_end: usize,
        definitions: &mut Vec<SymbolDefinition>,
    ) {
        match factor {
            TableFactor::Table {
                name,
                alias: Some(table_alias),
                ..
            } => {
                let alias_name = &table_alias.name.value;
                // Find alias after table name
                let empty = String::new();
                let table_name = name.0.last().map(|i| &i.value).unwrap_or(&empty);
                let search_start = self
                    .find_identifier_span(table_name, scope_start, scope_end)
                    .map(|s| s.end)
                    .unwrap_or(scope_start);

                if let Some(span) = self.find_identifier_span(alias_name, search_start, scope_end) {
                    definitions.push(SymbolDefinition {
                        name: alias_name.clone(),
                        kind: SymbolKind::TableAlias,
                        definition_span: span,
                        scope_start,
                        scope_end,
                    });
                }
            }
            TableFactor::Derived {
                subquery,
                alias: Some(table_alias),
                ..
            } => {
                // Handle subquery in FROM clause
                if let Some((sub_start, sub_end)) = self.find_subquery_span(subquery) {
                    self.collect_definitions_from_query(subquery, sub_start, sub_end, definitions);
                }
                // Subquery alias is also a table alias
                let alias_name = &table_alias.name.value;
                if let Some(span) = self.find_identifier_span(alias_name, scope_start, scope_end) {
                    definitions.push(SymbolDefinition {
                        name: alias_name.clone(),
                        kind: SymbolKind::TableAlias,
                        definition_span: span,
                        scope_start,
                        scope_end,
                    });
                }
            }
            TableFactor::Derived {
                subquery,
                alias: None,
                ..
            } => {
                // Handle subquery in FROM clause without alias
                if let Some((sub_start, sub_end)) = self.find_subquery_span(subquery) {
                    self.collect_definitions_from_query(subquery, sub_start, sub_end, definitions);
                }
            }
            _ => {}
        }
    }

    /// Find which symbol the cursor is on.
    fn find_symbol_at_offset(
        &self,
        definitions: &[SymbolDefinition],
        offset: usize,
    ) -> Option<SymbolDefinition> {
        // First, check if cursor is on a definition
        for def in definitions {
            if offset >= def.definition_span.start && offset < def.definition_span.end {
                return Some(def.clone());
            }
        }

        // Check if cursor is on a reference to any defined symbol
        for def in definitions {
            // Find all occurrences of this symbol within its scope
            let occurrences =
                self.find_all_occurrences(&def.name, def.scope_start, def.scope_end, None);

            for span in occurrences {
                if offset >= span.start && offset < span.end {
                    return Some(def.clone());
                }
            }
        }

        None
    }

    /// Find all references to a symbol within its scope (excluding definition).
    fn find_references_in_scope(&self, symbol: &SymbolDefinition) -> Vec<TextSpan> {
        self.find_all_occurrences(
            &symbol.name,
            symbol.scope_start,
            symbol.scope_end,
            Some(symbol.definition_span),
        )
    }

    /// Find all occurrences of an identifier in the source.
    fn find_all_occurrences(
        &self,
        name: &str,
        search_start: usize,
        search_end: usize,
        exclude_span: Option<TextSpan>,
    ) -> Vec<TextSpan> {
        let mut occurrences = Vec::new();
        let name_lower = name.to_lowercase();
        let search_slice = &self.source[search_start..search_end];
        let search_lower = search_slice.to_lowercase();

        let mut pos = 0;
        while let Some(found) = search_lower[pos..].find(&name_lower) {
            let abs_pos = search_start + pos + found;
            let end_pos = abs_pos + name.len();

            // Check word boundaries
            if self.is_word_boundary(abs_pos, end_pos) {
                let span = TextSpan::new(abs_pos, end_pos);

                // Exclude the definition span if provided
                let should_include = match exclude_span {
                    Some(excl) => span.start != excl.start,
                    None => true,
                };

                if should_include {
                    occurrences.push(span);
                }
            }

            pos += found + 1;
        }

        occurrences
    }

    /// Check if position is at word boundaries.
    fn is_word_boundary(&self, start: usize, end: usize) -> bool {
        let before_ok = start == 0
            || !self.source[..start]
                .chars()
                .last()
                .map(|c| c.is_alphanumeric() || c == '_')
                .unwrap_or(false);

        let after_ok = end >= self.source.len()
            || !self.source[end..]
                .chars()
                .next()
                .map(|c| c.is_alphanumeric() || c == '_')
                .unwrap_or(false);

        before_ok && after_ok
    }

    /// Find the span of an identifier in the source.
    fn find_identifier_span(
        &self,
        name: &str,
        search_start: usize,
        search_end: usize,
    ) -> Option<TextSpan> {
        let name_lower = name.to_lowercase();
        let search_slice = &self.source[search_start..search_end.min(self.source.len())];
        let search_lower = search_slice.to_lowercase();

        let mut pos = 0;
        while let Some(found) = search_lower[pos..].find(&name_lower) {
            let abs_pos = search_start + pos + found;
            let end_pos = abs_pos + name.len();

            if self.is_word_boundary(abs_pos, end_pos) {
                return Some(TextSpan::new(abs_pos, end_pos));
            }

            pos += found + 1;
        }

        None
    }

    /// Find the span of a subquery in the source.
    /// Returns (start, end) byte offsets.
    fn find_subquery_span(&self, query: &Query) -> Option<(usize, usize)> {
        // Subqueries are typically in parentheses
        // We need to find the matching parens
        // For simplicity, we'll find the first SELECT keyword in a subquery context
        // This is a heuristic - proper span tracking would require AST modifications

        // Use AST string representation to find approximate location
        let query_str = query.to_string();
        let first_keyword = if query_str.to_uppercase().starts_with("SELECT") {
            "SELECT"
        } else if query_str.to_uppercase().starts_with("WITH") {
            "WITH"
        } else {
            return None;
        };

        // Find occurrences of this query pattern in source
        let source_upper = self.source.to_uppercase();

        let mut pos = 0;
        while let Some(found) = source_upper[pos..].find(first_keyword) {
            let abs_pos = pos + found;
            // Find the enclosing parentheses
            if let Some(paren_start) = self.source[..abs_pos].rfind('(') {
                if let Some(paren_end) = self.find_matching_paren(paren_start) {
                    return Some((paren_start, paren_end + 1));
                }
            }
            pos = abs_pos + 1;
        }

        None
    }

    /// Find the matching closing parenthesis.
    fn find_matching_paren(&self, open_pos: usize) -> Option<usize> {
        let chars: Vec<char> = self.source.chars().collect();
        let mut depth = 0;
        let mut in_string = false;
        let mut string_char = ' ';
        let mut i = open_pos;

        while i < chars.len() {
            let c = chars[i];

            if in_string {
                // Handle escaped quotes: '' or ""
                if c == string_char {
                    // Check if next char is also the same quote (escaped)
                    if i + 1 < chars.len() && chars[i + 1] == string_char {
                        // Skip the escaped quote pair
                        i += 2;
                        continue;
                    }
                    // End of string
                    in_string = false;
                }
                i += 1;
                continue;
            }

            match c {
                '\'' | '"' => {
                    in_string = true;
                    string_char = c;
                }
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        // Convert char index to byte offset
                        let byte_offset: usize =
                            chars[..=i].iter().map(|c| c.len_utf8()).sum::<usize>() - 1;
                        return Some(byte_offset);
                    }
                }
                _ => {}
            }
            i += 1;
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlparser::dialect::PostgreSqlDialect;
    use sqlparser::parser::Parser;

    fn parse_sql(sql: &str) -> Vec<Statement> {
        Parser::parse_sql(&PostgreSqlDialect {}, sql).expect("Failed to parse SQL")
    }

    // ==========================================================================
    // Table Alias Tests
    // ==========================================================================

    #[test]
    fn test_find_table_alias_at_definition() {
        // Cursor on "u" in "FROM users u"
        let sql = "SELECT u.id FROM users u WHERE u.active = true";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Find the position of "u" after "users "
        let alias_pos = sql.find("users u").unwrap() + 6; // position of 'u' after 'users '

        let result = finder.find_symbol_at(&statements, alias_pos);

        assert!(result.is_some(), "Should find symbol at alias definition");
        let refs = result.unwrap();
        assert_eq!(refs.symbol_kind, SymbolKind::TableAlias);
        assert_eq!(
            &sql[refs.definition_span.start..refs.definition_span.end],
            "u"
        );
        // Should find references: u.id and u.active (not the definition)
        assert_eq!(refs.references.len(), 2);
    }

    #[test]
    fn test_find_table_alias_at_reference() {
        // Cursor on "u" in "u.id"
        let sql = "SELECT u.id FROM users u WHERE u.active = true";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Find position of first "u" (in "u.id")
        let ref_pos = sql.find("u.id").unwrap();

        let result = finder.find_symbol_at(&statements, ref_pos);

        assert!(result.is_some(), "Should find symbol at alias reference");
        let refs = result.unwrap();
        assert_eq!(refs.symbol_kind, SymbolKind::TableAlias);
        // Definition should still point to "users u"
        assert_eq!(
            &sql[refs.definition_span.start..refs.definition_span.end],
            "u"
        );
    }

    #[test]
    fn test_multiple_table_aliases_not_confused() {
        // Two different aliases: u and o
        let sql = "SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Find "o" in "o.total"
        let o_pos = sql.find("o.total").unwrap();
        let result = finder.find_symbol_at(&statements, o_pos);

        assert!(result.is_some());
        let refs = result.unwrap();
        assert_eq!(refs.symbol_kind, SymbolKind::TableAlias);
        // Should only find references to "o", not "u"
        for span in &refs.references {
            let text = &sql[span.start..span.end];
            assert_eq!(text, "o", "All references should be 'o', got '{}'", text);
        }
    }

    // ==========================================================================
    // CTE Name Tests
    // ==========================================================================

    #[test]
    fn test_find_cte_name_at_definition() {
        let sql = "WITH active_users AS (SELECT * FROM users) SELECT * FROM active_users";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Find "active_users" after WITH
        let cte_pos = sql.find("active_users").unwrap();

        let result = finder.find_symbol_at(&statements, cte_pos);

        assert!(result.is_some(), "Should find CTE at definition");
        let refs = result.unwrap();
        assert_eq!(refs.symbol_kind, SymbolKind::CteName);
        assert_eq!(
            &sql[refs.definition_span.start..refs.definition_span.end],
            "active_users"
        );
        // One reference in FROM clause
        assert_eq!(refs.references.len(), 1);
    }

    #[test]
    fn test_find_cte_name_at_reference() {
        let sql = "WITH active_users AS (SELECT * FROM users) SELECT * FROM active_users";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Find second occurrence of "active_users" (in FROM)
        let first_end = sql.find("active_users").unwrap() + "active_users".len();
        let cte_ref_pos = sql[first_end..].find("active_users").unwrap() + first_end;

        let result = finder.find_symbol_at(&statements, cte_ref_pos);

        assert!(result.is_some(), "Should find CTE at reference");
        let refs = result.unwrap();
        assert_eq!(refs.symbol_kind, SymbolKind::CteName);
    }

    // ==========================================================================
    // Column Alias Tests
    // ==========================================================================

    #[test]
    fn test_find_column_alias_at_definition() {
        let sql = "SELECT id AS user_id FROM users ORDER BY user_id";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Find "user_id" after AS
        let alias_pos = sql.find("user_id").unwrap();

        let result = finder.find_symbol_at(&statements, alias_pos);

        assert!(result.is_some(), "Should find column alias at definition");
        let refs = result.unwrap();
        assert_eq!(refs.symbol_kind, SymbolKind::ColumnAlias);
        assert_eq!(
            &sql[refs.definition_span.start..refs.definition_span.end],
            "user_id"
        );
        // One reference in ORDER BY
        assert_eq!(refs.references.len(), 1);
    }

    #[test]
    fn test_find_column_alias_in_order_by() {
        let sql = "SELECT id AS user_id FROM users ORDER BY user_id";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Find "user_id" in ORDER BY
        let order_by_pos = sql.rfind("user_id").unwrap();

        let result = finder.find_symbol_at(&statements, order_by_pos);

        assert!(result.is_some(), "Should find column alias in ORDER BY");
        let refs = result.unwrap();
        assert_eq!(refs.symbol_kind, SymbolKind::ColumnAlias);
    }

    // ==========================================================================
    // Edge Cases
    // ==========================================================================

    #[test]
    fn test_cursor_not_on_symbol_returns_none() {
        let sql = "SELECT * FROM users";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Cursor on "SELECT" keyword
        let result = finder.find_symbol_at(&statements, 0);

        assert!(result.is_none(), "Should return None when not on a symbol");
    }

    #[test]
    fn test_cursor_on_table_name_not_alias() {
        // "users" is a table name, not an alias
        let sql = "SELECT * FROM users";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        let table_pos = sql.find("users").unwrap();
        let result = finder.find_symbol_at(&statements, table_pos);

        // Table names are not renameable symbols (they're database objects)
        assert!(
            result.is_none(),
            "Table name should not be a renameable symbol"
        );
    }

    #[test]
    fn test_nested_subquery_same_alias_different_scope() {
        // Inner "u" shadows outer "u" - they should be treated as separate symbols
        let sql = "SELECT u.id FROM users u WHERE u.id IN (SELECT u.id FROM admins u)";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        // Find inner "u" (in "admins u")
        let inner_alias_pos = sql.rfind("admins u").unwrap() + 7; // position of inner 'u'

        let result = finder.find_symbol_at(&statements, inner_alias_pos);

        assert!(result.is_some(), "Should find inner alias");
        let refs = result.unwrap();
        // Should only find references within the subquery scope
        // The inner u.id reference, not the outer ones
        assert!(
            refs.references.len() <= 1,
            "Inner alias should only have references within subquery"
        );
    }

    // ==========================================================================
    // find_references Tests
    // ==========================================================================

    #[test]
    fn test_find_references_for_table_alias() {
        let sql = "SELECT u.id, u.name FROM users u WHERE u.active = true";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        let refs = finder.find_references(&statements, "u", SymbolKind::TableAlias);

        // Should find: u.id, u.name, u.active (not the definition "users u")
        assert_eq!(refs.len(), 3, "Should find 3 references to 'u'");
        for span in &refs {
            assert_eq!(&sql[span.start..span.end], "u");
        }
    }

    #[test]
    fn test_find_references_for_cte() {
        let sql = "WITH cte AS (SELECT 1) SELECT * FROM cte JOIN cte c2 ON true";
        let statements = parse_sql(sql);
        let finder = SymbolFinder::new(sql);

        let refs = finder.find_references(&statements, "cte", SymbolKind::CteName);

        // Should find: "FROM cte" and "JOIN cte" (not the WITH definition)
        assert_eq!(refs.len(), 2, "Should find 2 CTE references");
    }

    // ==========================================================================
    // Escaped Quote Tests
    // ==========================================================================

    #[test]
    fn test_find_matching_paren_with_escaped_single_quotes() {
        // SQL string with escaped single quote: 'O''Brien'
        let sql = "SELECT * FROM (SELECT name FROM users WHERE name = 'O''Brien') AS sub";
        let finder = SymbolFinder::new(sql);

        // Find the opening paren position
        let open_paren = sql.find('(').unwrap();
        let close_paren = finder.find_matching_paren(open_paren);

        assert!(
            close_paren.is_some(),
            "Should find matching paren despite escaped quotes"
        );
        let close_pos = close_paren.unwrap();
        assert_eq!(
            &sql[close_pos..close_pos + 1],
            ")",
            "Should point to closing paren"
        );

        // Verify the matched content contains the full subquery
        let matched = &sql[open_paren..=close_pos];
        assert!(
            matched.contains("O''Brien"),
            "Should include the escaped quote string"
        );
    }

    #[test]
    fn test_find_matching_paren_with_escaped_double_quotes() {
        // SQL string with escaped double quote: "col""name"
        let sql = r#"SELECT * FROM (SELECT "col""name" FROM users) AS sub"#;
        let finder = SymbolFinder::new(sql);

        let open_paren = sql.find('(').unwrap();
        let close_paren = finder.find_matching_paren(open_paren);

        assert!(
            close_paren.is_some(),
            "Should find matching paren despite escaped double quotes"
        );
    }

    #[test]
    fn test_find_matching_paren_with_paren_inside_string() {
        // String contains parentheses that should be ignored
        let sql =
            "SELECT * FROM (SELECT name FROM users WHERE note = 'has (parens) inside') AS sub";
        let finder = SymbolFinder::new(sql);

        let open_paren = sql.find('(').unwrap();
        let close_paren = finder.find_matching_paren(open_paren);

        assert!(close_paren.is_some(), "Should find correct matching paren");
        let close_pos = close_paren.unwrap();
        // The closing paren should be the one after "sub", not the one inside the string
        assert!(
            close_pos > sql.find("inside')").unwrap(),
            "Should match outer paren, not string content"
        );
    }
}
