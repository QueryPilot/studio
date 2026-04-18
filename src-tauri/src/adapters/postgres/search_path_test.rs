use super::search_path::build_set_search_path_sql;

#[test]
fn empty_effective_schemas_short_circuits() {
    assert_eq!(build_set_search_path_sql(&[]), "");
}

#[test]
fn single_schema_emits_bare_list() {
    let sql = build_set_search_path_sql(&["public".to_string()]);
    assert_eq!(sql, "SET search_path TO \"public\"");
}

#[test]
fn multi_schema_preserves_order() {
    let sql = build_set_search_path_sql(&["reporting".to_string(), "public".to_string()]);
    assert_eq!(sql, "SET search_path TO \"reporting\", \"public\"");
}

#[test]
fn quotes_identifiers_with_embedded_quotes() {
    let sql = build_set_search_path_sql(&[r#"weird"name"#.to_string()]);
    assert_eq!(sql, "SET search_path TO \"weird\"\"name\"");
}
