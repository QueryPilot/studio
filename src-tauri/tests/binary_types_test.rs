//! Integration tests for PostgreSQL binary type decoders
//!
//! Tests the DirectMsgPackEncoder's ability to decode PostgreSQL binary format
//! for geometric types, tsvector, and hstore.
//!
//! Requires Docker PostgreSQL running (make docker-up):
//! - Host: localhost:15432
//! - User: devuser
//! - Password: devpass123
//! - Database: todoapp

use query_pilot::adapters::postgres::direct_msgpack::DirectMsgPackEncoder;
use tokio_postgres::{Config, NoTls};

/// Check if PostgreSQL is available for testing
fn postgres_available() -> bool {
    std::net::TcpStream::connect("127.0.0.1:15432").is_ok()
}

/// Connect to the test PostgreSQL database
async fn connect() -> Result<tokio_postgres::Client, tokio_postgres::Error> {
    let config = Config::new()
        .host("127.0.0.1")
        .port(15432)
        .user("devuser")
        .password("devpass123")
        .dbname("todoapp")
        .clone();

    let (client, connection) = config.connect(NoTls).await?;

    // Spawn connection handler
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Connection error: {}", e);
        }
    });

    Ok(client)
}

/// Decode MessagePack bytes and extract the first cell value as a string
fn extract_first_cell(msgpack_bytes: &[u8]) -> Option<String> {
    // MessagePack format: array of rows, each row is an array of values
    // For single-value queries: [[value]]
    use rmpv::decode::read_value;
    use std::io::Cursor;

    let mut cursor = Cursor::new(msgpack_bytes);
    let value = read_value(&mut cursor).ok()?;

    // Navigate: outer array -> first row -> first cell
    let rows = value.as_array()?;
    let first_row = rows.first()?.as_array()?;
    let first_cell = first_row.first()?;

    // Convert to string
    match first_cell {
        rmpv::Value::String(s) => s.as_str().map(|s| s.to_string()),
        rmpv::Value::Nil => Some("NULL".to_string()),
        other => Some(format!("{:?}", other)),
    }
}

/// Test helper: run a query and return the decoded first cell
async fn query_first_cell(client: &tokio_postgres::Client, sql: &str) -> Option<String> {
    let rows = client.query(sql, &[]).await.ok()?;
    if rows.is_empty() {
        return None;
    }

    let encoder = DirectMsgPackEncoder::from_row(&rows[0]);
    let msgpack = encoder.encode_batch(&rows).ok()?;
    extract_first_cell(&msgpack)
}

// ============================================================================
// Geometric Type Tests
// ============================================================================

#[tokio::test]
async fn test_box_type() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(&client, "SELECT '((0,0),(1,1))'::box").await;

    assert!(result.is_some(), "Expected result for box type");
    let value = result.unwrap();

    // PostgreSQL normalizes box to (upper-right, lower-left)
    assert!(
        value.contains("(1") && value.contains("(0"),
        "Box should contain corner coordinates: got {}",
        value
    );
    assert!(
        value.starts_with("((") && value.ends_with("))"),
        "Box should have format ((x1,y1),(x2,y2)): got {}",
        value
    );
}

#[tokio::test]
async fn test_circle_type() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(&client, "SELECT '<(0,0),5>'::circle").await;

    assert!(result.is_some(), "Expected result for circle type");
    let value = result.unwrap();

    assert!(
        value.starts_with("<(") && value.ends_with(">"),
        "Circle should have format <(x,y),r>: got {}",
        value
    );
    assert!(
        value.contains(",5"),
        "Circle should contain radius 5: got {}",
        value
    );
}

#[tokio::test]
async fn test_line_type() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(&client, "SELECT '{1,2,3}'::line").await;

    assert!(result.is_some(), "Expected result for line type");
    let value = result.unwrap();

    assert!(
        value.starts_with("{") && value.ends_with("}"),
        "Line should have format {{A,B,C}}: got {}",
        value
    );
}

#[tokio::test]
async fn test_lseg_type() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(&client, "SELECT '[(0,0),(1,1)]'::lseg").await;

    assert!(result.is_some(), "Expected result for lseg type");
    let value = result.unwrap();

    assert!(
        value.starts_with("[(") && value.ends_with(")]"),
        "Lseg should have format [(x1,y1),(x2,y2)]: got {}",
        value
    );
}

#[tokio::test]
async fn test_path_open() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(&client, "SELECT '[(0,0),(1,1),(2,2)]'::path").await;

    assert!(result.is_some(), "Expected result for path type");
    let value = result.unwrap();

    // Open path uses square brackets
    assert!(
        value.starts_with("[(") && value.ends_with(")]"),
        "Open path should have format [(p1),(p2),...]: got {}",
        value
    );
}

#[tokio::test]
async fn test_path_closed() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(&client, "SELECT '((0,0),(1,1),(2,2))'::path").await;

    assert!(result.is_some(), "Expected result for closed path type");
    let value = result.unwrap();

    // Closed path uses parentheses
    assert!(
        value.starts_with("((") && value.ends_with("))"),
        "Closed path should have format ((p1),(p2),...): got {}",
        value
    );
}

#[tokio::test]
async fn test_polygon_type() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(&client, "SELECT '((0,0),(1,1),(2,0))'::polygon").await;

    assert!(result.is_some(), "Expected result for polygon type");
    let value = result.unwrap();

    assert!(
        value.starts_with("((") && value.ends_with("))"),
        "Polygon should have format ((p1),(p2),(p3)): got {}",
        value
    );
}

// ============================================================================
// Extension Type Tests
// ============================================================================

#[tokio::test]
async fn test_tsvector_simple() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(&client, "SELECT 'cat fat rat'::tsvector").await;

    assert!(result.is_some(), "Expected result for tsvector type");
    let value = result.unwrap();

    // tsvector without positions: 'cat' 'fat' 'rat'
    assert!(
        value.contains("'cat'") && value.contains("'fat'") && value.contains("'rat'"),
        "Tsvector should contain lexemes: got {}",
        value
    );
}

#[tokio::test]
async fn test_tsvector_with_positions() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result = query_first_cell(
        &client,
        "SELECT to_tsvector('english', 'The quick brown fox')",
    )
    .await;

    assert!(
        result.is_some(),
        "Expected result for tsvector with positions"
    );
    let value = result.unwrap();

    // to_tsvector generates positions: 'brown':3 'fox':4 'quick':2
    assert!(
        value.contains(":"),
        "Tsvector from to_tsvector should have positions: got {}",
        value
    );
}

#[tokio::test]
async fn test_hstore_type() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");

    // First ensure hstore extension exists
    let ext_check = client
        .query(
            "SELECT 1 FROM pg_extension WHERE extname = 'hstore'",
            &[],
        )
        .await;

    if ext_check.map(|r| r.is_empty()).unwrap_or(true) {
        // Try to create extension
        if client
            .execute("CREATE EXTENSION IF NOT EXISTS hstore", &[])
            .await
            .is_err()
        {
            eprintln!("Skipping test: hstore extension not available");
            return;
        }
    }

    let result = query_first_cell(&client, "SELECT '\"a\"=>\"1\", \"b\"=>\"2\"'::hstore").await;

    assert!(result.is_some(), "Expected result for hstore type");
    let value = result.unwrap();

    assert!(
        value.contains("=>"),
        "Hstore should contain => operator: got {}",
        value
    );
    assert!(
        value.contains("\"a\"") && value.contains("\"b\""),
        "Hstore should contain keys: got {}",
        value
    );
}

#[tokio::test]
async fn test_hstore_with_null() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");

    // Ensure hstore extension
    let _ = client
        .execute("CREATE EXTENSION IF NOT EXISTS hstore", &[])
        .await;

    let result =
        query_first_cell(&client, "SELECT '\"a\"=>\"1\", \"b\"=>NULL'::hstore").await;

    if let Some(value) = result {
        assert!(
            value.contains("NULL"),
            "Hstore with NULL should contain NULL: got {}",
            value
        );
    }
}

// ============================================================================
// Edge Cases
// ============================================================================

#[tokio::test]
async fn test_empty_polygon() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");

    // Polygon with minimum points (3)
    let result = query_first_cell(&client, "SELECT '((0,0),(1,0),(0,1))'::polygon").await;

    assert!(result.is_some(), "Expected result for minimal polygon");
    let value = result.unwrap();
    assert!(
        value.contains("(0") && value.contains("(1"),
        "Polygon should contain vertices: got {}",
        value
    );
}

#[tokio::test]
async fn test_large_coordinates() {
    if !postgres_available() {
        eprintln!("Skipping test: PostgreSQL not available at localhost:15432");
        return;
    }

    let client = connect().await.expect("Failed to connect");
    let result =
        query_first_cell(&client, "SELECT '<(1234567.89, -9876543.21), 999.999>'::circle").await;

    assert!(result.is_some(), "Expected result for large coordinate circle");
    let value = result.unwrap();

    assert!(
        value.contains("1234567") && value.contains("9876543"),
        "Circle should preserve large coordinates: got {}",
        value
    );
}
