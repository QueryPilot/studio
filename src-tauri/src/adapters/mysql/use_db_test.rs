#[test]
fn mysql_use_statement_escapes_backticks() {
    let raw = "weird`db";
    let sql = format!("USE `{}`", raw.replace('`', "``"));
    assert_eq!(sql, "USE `weird``db`");
}
