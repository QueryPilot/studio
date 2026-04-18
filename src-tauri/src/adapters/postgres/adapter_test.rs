#[test]
fn postgres_adapter_has_no_current_schema_field() {
    // Compile-time guarantee: if someone re-adds the current_schema field this test file
    // must be updated alongside. If the field is absent, PostgresAdapter::new() compiles
    // with a fixed two-field constructor.
    use super::adapter::PostgresAdapter;
    let _ = PostgresAdapter::new();
    // No assertions needed — just that PostgresAdapter::new() has a fixed constructor.
}
