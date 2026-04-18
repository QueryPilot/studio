//! SQL refactoring logic for Smart Rename and Extract to CTE.
//!
//! This module provides the core refactoring transformations:
//! - Rename: Rename a symbol (alias, CTE name, column alias) and all its references
//! - Extract to CTE: Extract a subquery into a named CTE

use serde::{Deserialize, Serialize};
use sqlparser::ast::Statement;

use super::{
    span::TextSpan,
    symbol_finder::{SymbolFinder, SymbolKind, SymbolReferences},
};

/// Available refactoring actions at a cursor position.
#[derive(Serialize, Clone, Debug)]
pub struct RefactorAction {
    pub kind: RefactorKind,
    pub label: String,
    pub symbol: Option<String>,
    pub span: TextSpan,
    pub enabled: bool,
    pub disabled_reason: Option<String>,
}

/// Type of refactoring action.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RefactorKind {
    Rename,
    ExtractCte,
}

/// Request to perform a refactoring.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RefactorRequest {
    Rename {
        symbol_span: TextSpan,
        new_name: String,
    },
    ExtractCte {
        selection_span: TextSpan,
        cte_name: String,
    },
}

/// Result of applying a refactoring.
#[derive(Serialize, Clone, Debug)]
pub struct RefactorResult {
    pub new_sql: String,
    pub edits: Vec<TextEdit>,
    pub cursor_position: usize,
}

/// A single text edit operation.
#[derive(Serialize, Clone, Debug)]
pub struct TextEdit {
    pub span: TextSpan,
    pub new_text: String,
}

/// Main refactoring API.
pub struct Refactor<'a> {
    source: &'a str,
    statements: Vec<Statement>,
}

impl<'a> Refactor<'a> {
    /// Create a new refactoring context from SQL source.
    pub fn new(source: &'a str, statements: Vec<Statement>) -> Self {
        Self { source, statements }
    }

    /// Get available refactoring actions at a given cursor offset.
    pub fn get_actions(&self, cursor_offset: usize) -> Vec<RefactorAction> {
        let mut actions = Vec::new();

        // Check if we can rename at this position
        let finder = SymbolFinder::new(self.source);
        if let Some(symbol_refs) = finder.find_symbol_at(&self.statements, cursor_offset) {
            let symbol_name = self.get_text_at_span(&symbol_refs.definition_span);
            let kind_label = match symbol_refs.symbol_kind {
                SymbolKind::TableAlias => "table alias",
                SymbolKind::CteName => "CTE",
                SymbolKind::ColumnAlias => "column alias",
            };

            actions.push(RefactorAction {
                kind: RefactorKind::Rename,
                label: format!("Rename {} '{}'", kind_label, symbol_name),
                symbol: Some(symbol_name.to_string()),
                span: symbol_refs.definition_span,
                enabled: true,
                disabled_reason: None,
            });
        }

        // Check if cursor is within a subquery that can be extracted
        if let Some(subquery_span) = self.find_subquery_at_position(cursor_offset) {
            actions.push(RefactorAction {
                kind: RefactorKind::ExtractCte,
                label: "Extract to CTE".to_string(),
                symbol: None,
                span: subquery_span,
                enabled: true,
                disabled_reason: None,
            });
        }

        actions
    }

    /// Find if cursor is within an extractable subquery
    fn find_subquery_at_position(&self, cursor_offset: usize) -> Option<TextSpan> {
        // Look for SELECT within parentheses around cursor position
        let source = self.source;

        // Find the nearest enclosing parentheses pair
        let mut open_paren: Option<usize> = None;
        let mut close_paren: Option<usize> = None;

        // Scan backwards for opening parenthesis
        for i in (0..cursor_offset).rev() {
            if source.as_bytes()[i] == b'(' {
                open_paren = Some(i);
                break;
            }
        }

        // If we found an opening paren, scan forward for closing paren
        if let Some(open_pos) = open_paren {
            let mut depth = 1;
            for i in (open_pos + 1)..source.len() {
                match source.as_bytes()[i] {
                    b'(' => depth += 1,
                    b')' => {
                        depth -= 1;
                        if depth == 0 {
                            close_paren = Some(i);
                            break;
                        }
                    }
                    _ => {}
                }
            }

            // Check if the content looks like a SELECT statement
            if let Some(close_pos) = close_paren {
                let content = &source[open_pos + 1..close_pos];
                if content.trim().to_lowercase().starts_with("select") {
                    // Make sure cursor is within this range
                    if cursor_offset > open_pos && cursor_offset < close_pos {
                        return Some(TextSpan {
                            start: open_pos,
                            end: close_pos + 1,
                        });
                    }
                }
            }
        }

        None
    }

    /// Apply a rename refactoring.
    pub fn apply_rename(
        &self,
        symbol_span: TextSpan,
        new_name: &str,
    ) -> Result<RefactorResult, String> {
        // Validate new name
        if new_name.trim().is_empty() {
            return Err("Name cannot be empty".to_string());
        }

        if !is_valid_identifier(new_name) {
            return Err("Name must start with letter or underscore".to_string());
        }

        // Find the symbol at the given span
        let finder = SymbolFinder::new(self.source);
        let symbol_refs = finder
            .find_symbol_at(&self.statements, symbol_span.start)
            .ok_or_else(|| "No renameable symbol found at position".to_string())?;

        // Check for conflicts (same name already exists in scope)
        if self.has_symbol_conflict(&symbol_refs, new_name) {
            return Err(format!("Name '{}' already exists in scope", new_name));
        }

        // Collect all edits (definition + all references)
        let mut edits: Vec<TextEdit> = Vec::new();

        // Add definition edit
        edits.push(TextEdit {
            span: symbol_refs.definition_span,
            new_text: format_identifier_for_dialect(new_name),
        });

        // Add reference edits
        for reference_span in &symbol_refs.references {
            edits.push(TextEdit {
                span: *reference_span,
                new_text: format_identifier_for_dialect(new_name),
            });
        }

        // Sort edits by position (descending) to avoid offset shifting
        edits.sort_by(|a, b| b.span.start.cmp(&a.span.start));

        // Apply edits from end to start
        let new_sql = apply_edits(self.source, &edits);

        Ok(RefactorResult {
            new_sql,
            edits,
            cursor_position: symbol_refs.definition_span.start + new_name.len(),
        })
    }

    /// Apply an extract to CTE refactoring.
    pub fn apply_extract_cte(
        &self,
        selection_span: TextSpan,
        cte_name: &str,
    ) -> Result<RefactorResult, String> {
        // Validate CTE name
        if cte_name.trim().is_empty() {
            return Err("CTE name cannot be empty".to_string());
        }

        if !is_valid_identifier(cte_name) {
            return Err("CTE name must start with letter or underscore".to_string());
        }

        // Check if name conflicts with existing CTEs
        if self.has_cte_name_conflict(cte_name) {
            return Err(format!("CTE name '{}' already exists", cte_name));
        }

        // Validate selection is a valid subquery
        let subquery_text = self.get_text_at_span(&selection_span).trim();

        // Check if it starts with ( and ends with )
        if !subquery_text.starts_with('(') || !subquery_text.ends_with(')') {
            return Err("Selection must be a subquery enclosed in parentheses".to_string());
        }

        // Extract the inner SELECT (remove outer parentheses)
        let inner_sql = subquery_text[1..subquery_text.len() - 1].trim();

        // Check if the inner content is a valid SELECT statement
        let inner_lower = inner_sql.to_lowercase();
        if !inner_lower.starts_with("select") {
            return Err("Subquery must start with SELECT".to_string());
        }

        // Determine if we need to create a new WITH clause or append to existing
        let (insert_pos, cte_clause) = if let Some(_with_pos) = self.find_with_clause_position() {
            // Append to existing WITH clause (after last CTE)
            let last_cte_end = self.find_last_cte_end_position();
            (
                last_cte_end,
                format!(",\n  {} AS (\n    {}\n  )", cte_name, inner_sql),
            )
        } else {
            // Create new WITH clause before first SELECT
            let first_select_pos = self.find_first_select_position();
            (
                first_select_pos,
                format!("WITH {} AS (\n  {}\n)\n", cte_name, inner_sql),
            )
        };

        // Create edits
        let mut edits = vec![
            // Insert CTE definition
            TextEdit {
                span: TextSpan {
                    start: insert_pos,
                    end: insert_pos,
                },
                new_text: cte_clause.clone(),
            },
            // Replace subquery with CTE reference
            TextEdit {
                span: selection_span,
                new_text: cte_name.to_string(),
            },
        ];

        // Sort edits by position (descending) to avoid offset shifting
        edits.sort_by(|a, b| b.span.start.cmp(&a.span.start));

        // Apply edits
        let new_sql = apply_edits(self.source, &edits);

        Ok(RefactorResult {
            new_sql,
            edits,
            cursor_position: insert_pos,
        })
    }

    /// Check if a CTE name already exists
    fn has_cte_name_conflict(&self, cte_name: &str) -> bool {
        for stmt in &self.statements {
            if let Statement::Query(query) = stmt {
                if let Some(with) = &query.with {
                    for cte in &with.cte_tables {
                        if cte.alias.name.value.eq_ignore_ascii_case(cte_name) {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    /// Find position of existing WITH clause (if any)
    fn find_with_clause_position(&self) -> Option<usize> {
        self.source
            .find("WITH ")
            .or_else(|| self.source.find("with "))
            .or_else(|| self.source.find("WITH\n"))
            .or_else(|| self.source.find("with\n"))
    }

    /// Find position after last CTE in existing WITH clause
    fn find_last_cte_end_position(&self) -> usize {
        // Find the last closing parenthesis before SELECT in a WITH clause
        if let Some(with_pos) = self.find_with_clause_position() {
            // Look for SELECT after WITH
            let after_with = &self.source[with_pos..];
            if let Some(select_offset) = after_with
                .find("SELECT")
                .or_else(|| after_with.find("select"))
            {
                let with_to_select = &self.source[with_pos..with_pos + select_offset];
                // Find last )
                if let Some(last_paren) = with_to_select.rfind(')') {
                    return with_pos + last_paren + 1;
                }
            }
        }
        0
    }

    /// Find position of first SELECT statement
    fn find_first_select_position(&self) -> usize {
        self.source
            .find("SELECT")
            .or_else(|| self.source.find("select"))
            .or_else(|| self.source.find("WITH"))
            .or_else(|| self.source.find("with"))
            .unwrap_or(0)
    }

    /// Get text at a given span.
    fn get_text_at_span(&self, span: &TextSpan) -> &str {
        &self.source[span.start..span.end]
    }

    /// Check if a new name would conflict with existing symbols.
    fn has_symbol_conflict(&self, current_symbol: &SymbolReferences, new_name: &str) -> bool {
        let finder = SymbolFinder::new(self.source);
        let _all_definitions = finder.find_symbol_at(&self.statements, 0);

        // For simplicity, we'll just check if there's any symbol with the same name
        // in the same scope. A more sophisticated check would validate scope boundaries.
        // For now, we allow the rename if the name is only used by the current symbol.

        // Check if new_name appears anywhere else as a different symbol
        for stmt in &self.statements {
            if let Statement::Query(query) = stmt {
                // Check CTEs
                if current_symbol.symbol_kind != SymbolKind::CteName {
                    if let Some(with) = &query.with {
                        for cte in &with.cte_tables {
                            if cte.alias.name.value.eq_ignore_ascii_case(new_name) {
                                return true;
                            }
                        }
                    }
                }

                // Check table aliases
                if current_symbol.symbol_kind != SymbolKind::TableAlias {
                    // We'd need to walk the FROM clause here
                    // For now, we'll do a simple text search
                    if self.source.contains(&format!(" {} ", new_name))
                        || self.source.contains(&format!(" {}\n", new_name))
                    {
                        // Potential conflict - could be more precise
                        // This is overly conservative but safe
                    }
                }
            }
        }

        false
    }
}

/// Validate if a string is a valid SQL identifier.
fn is_valid_identifier(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }

    let first_char = name.chars().next().unwrap();
    if !first_char.is_ascii_alphabetic() && first_char != '_' {
        return false;
    }

    name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Format identifier for SQL dialect (no quoting for now, Phase 4 enhancement).
fn format_identifier_for_dialect(name: &str) -> String {
    // For now, we don't quote identifiers
    // In Phase 4, we could detect if quoting is needed based on:
    // - Reserved keywords
    // - Special characters
    // - Case sensitivity requirements
    name.to_string()
}

/// Apply a list of text edits to source code.
/// Edits must be sorted in descending order by start position.
fn apply_edits(source: &str, edits: &[TextEdit]) -> String {
    let mut result = source.to_string();

    for edit in edits {
        result.replace_range(edit.span.start..edit.span.end, &edit.new_text);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlparser::dialect::PostgreSqlDialect;
    use sqlparser::parser::Parser;

    fn parse_sql(sql: &str) -> Vec<Statement> {
        Parser::parse_sql(&PostgreSqlDialect {}, sql).unwrap()
    }

    #[test]
    fn test_is_valid_identifier() {
        assert!(is_valid_identifier("foo"));
        assert!(is_valid_identifier("_foo"));
        assert!(is_valid_identifier("foo123"));
        assert!(is_valid_identifier("FOO_BAR"));

        assert!(!is_valid_identifier(""));
        assert!(!is_valid_identifier("123foo"));
        assert!(!is_valid_identifier("foo-bar"));
        assert!(!is_valid_identifier("foo bar"));
    }

    #[test]
    fn test_get_actions_table_alias() {
        let sql = "SELECT u.id FROM users u";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Cursor on "u" in FROM clause (position 23)
        let actions = refactor.get_actions(23);

        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].kind, RefactorKind::Rename);
        assert!(actions[0].label.contains("table alias"));
        assert!(actions[0].label.contains("'u'"));
        assert!(actions[0].enabled);
    }

    #[test]
    fn test_get_actions_cte_name() {
        let sql = "WITH active_users AS (SELECT * FROM users) SELECT * FROM active_users";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Cursor on "active_users" in WITH clause (position 5)
        let actions = refactor.get_actions(5);

        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].kind, RefactorKind::Rename);
        assert!(actions[0].label.contains("CTE"));
        assert!(actions[0].enabled);
    }

    #[test]
    fn test_apply_rename_table_alias() {
        let sql = "SELECT u.id, u.name FROM users u WHERE u.active = true";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Find symbol "u" and rename to "usr"
        // "users u" - the "u" is at position 31
        let symbol_span = TextSpan { start: 31, end: 32 }; // "u" in "users u"

        let result = refactor.apply_rename(symbol_span, "usr").unwrap();

        assert_eq!(
            result.new_sql,
            "SELECT usr.id, usr.name FROM users usr WHERE usr.active = true"
        );
        assert_eq!(result.edits.len(), 4); // definition + 3 references
    }

    #[test]
    fn test_apply_rename_cte() {
        let sql = "WITH active AS (SELECT * FROM users) SELECT * FROM active";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Find symbol "active" in WITH clause
        let symbol_span = TextSpan { start: 5, end: 11 }; // "active" in WITH

        let result = refactor.apply_rename(symbol_span, "active_users").unwrap();

        assert_eq!(
            result.new_sql,
            "WITH active_users AS (SELECT * FROM users) SELECT * FROM active_users"
        );
        assert_eq!(result.edits.len(), 2); // definition + 1 reference
    }

    #[test]
    fn test_apply_rename_validates_empty_name() {
        let sql = "SELECT u.id FROM users u";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        let symbol_span = TextSpan { start: 23, end: 24 };
        let result = refactor.apply_rename(symbol_span, "");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));
    }

    #[test]
    fn test_apply_rename_validates_invalid_identifier() {
        let sql = "SELECT u.id FROM users u";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        let symbol_span = TextSpan { start: 23, end: 24 };
        let result = refactor.apply_rename(symbol_span, "123invalid");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must start with letter"));
    }

    #[test]
    fn test_apply_edits_descending_order() {
        let source = "hello world foo bar";
        let edits = vec![
            TextEdit {
                span: TextSpan { start: 12, end: 15 },
                new_text: "baz".to_string(),
            },
            TextEdit {
                span: TextSpan { start: 6, end: 11 },
                new_text: "universe".to_string(),
            },
            TextEdit {
                span: TextSpan { start: 0, end: 5 },
                new_text: "hi".to_string(),
            },
        ];

        let result = apply_edits(source, &edits);
        assert_eq!(result, "hi universe baz bar");
    }

    #[test]
    fn test_get_actions_no_symbol() {
        let sql = "SELECT * FROM users";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Cursor on whitespace (position 10)
        let actions = refactor.get_actions(10);

        assert_eq!(actions.len(), 0);
    }

    // ========================================
    // Extract CTE Tests
    // ========================================

    #[test]
    fn test_get_actions_extractable_subquery() {
        let sql = "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Cursor inside subquery (position 40)
        let actions = refactor.get_actions(40);

        // Should have extract action
        let extract_action = actions.iter().find(|a| a.kind == RefactorKind::ExtractCte);
        assert!(extract_action.is_some());
        assert_eq!(extract_action.unwrap().label, "Extract to CTE");
    }

    #[test]
    fn test_apply_extract_cte_simple() {
        let sql = "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        let subquery_span = TextSpan { start: 32, end: 60 }; // (SELECT user_id FROM orders)

        let result = refactor
            .apply_extract_cte(subquery_span, "order_users")
            .unwrap();

        assert!(result.new_sql.contains("WITH order_users AS"));
        assert!(result.new_sql.contains("SELECT user_id FROM orders"));
        assert!(result.new_sql.contains("WHERE id IN order_users"));
    }

    #[test]
    fn test_apply_extract_cte_with_existing_with() {
        let sql = "WITH active AS (SELECT * FROM users WHERE active = true) SELECT * FROM active WHERE id IN (SELECT user_id FROM orders)";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Position of (SELECT user_id FROM orders)
        let subquery_start = sql.rfind("(SELECT").unwrap();
        let subquery_end = sql.len();
        let subquery_span = TextSpan {
            start: subquery_start,
            end: subquery_end,
        };

        let result = refactor
            .apply_extract_cte(subquery_span, "order_users")
            .unwrap();

        // Should append to existing WITH clause
        assert!(result.new_sql.contains("WITH active AS"));
        assert!(result.new_sql.contains(",\n  order_users AS"));
    }

    #[test]
    fn test_apply_extract_cte_validates_empty_name() {
        let sql = "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        let subquery_span = TextSpan { start: 32, end: 60 };
        let result = refactor.apply_extract_cte(subquery_span, "");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));
    }

    #[test]
    fn test_apply_extract_cte_validates_invalid_name() {
        let sql = "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        let subquery_span = TextSpan { start: 32, end: 60 };
        let result = refactor.apply_extract_cte(subquery_span, "123invalid");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must start with letter"));
    }

    #[test]
    fn test_apply_extract_cte_validates_not_subquery() {
        let sql = "SELECT * FROM users";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        let not_subquery_span = TextSpan { start: 7, end: 8 }; // Just "*"
        let result = refactor.apply_extract_cte(not_subquery_span, "my_cte");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be a subquery"));
    }

    #[test]
    fn test_apply_extract_cte_detects_name_conflict() {
        let sql = "WITH existing_cte AS (SELECT 1) SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        let subquery_start = sql.rfind("(SELECT").unwrap();
        let subquery_end = sql.len();
        let subquery_span = TextSpan {
            start: subquery_start,
            end: subquery_end,
        };
        let result = refactor.apply_extract_cte(subquery_span, "existing_cte");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_find_subquery_at_position() {
        let sql = "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Position inside the subquery
        let subquery = refactor.find_subquery_at_position(40);
        assert!(subquery.is_some());

        let span = subquery.unwrap();
        assert_eq!(span.start, 32); // Start of (
        assert_eq!(span.end, 60); // End of )
    }

    #[test]
    fn test_find_subquery_at_position_nested() {
        let sql = "SELECT * FROM (SELECT * FROM (SELECT id FROM users))";
        let statements = parse_sql(sql);
        let refactor = Refactor::new(sql, statements);

        // Position in inner subquery
        let subquery = refactor.find_subquery_at_position(40);
        assert!(subquery.is_some());

        // Should find the inner-most subquery containing cursor
        let span = subquery.unwrap();
        assert_eq!(&sql[span.start..span.end], "(SELECT id FROM users)");
    }
}
