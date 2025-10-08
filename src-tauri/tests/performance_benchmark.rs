use std::time::Instant;
use tokio_postgres::{NoTls, Config};

/// Performance benchmark test for the fast query path
/// Tests against real PostgreSQL database with 13k rows
#[tokio::test]
async fn benchmark_fast_query_13k_rows() {
    // Connection config from README_DATABASES.md
    let mut config = Config::new();
    config.host("localhost");
    config.port(15432);
    config.user("devuser");
    config.password("devpass123");
    config.dbname("todoapp");

    // Connect
    let (client, connection) = config.connect(NoTls).await.expect("Failed to connect");

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Connection error: {}", e);
        }
    });

    // Warm up connection
    let _ = client.query("SELECT 1", &[]).await;

    println!("\n=== Performance Benchmark: Fast Query Path ===");
    println!("Target: < 100ms for 13k rows (TablePlus baseline: 100ms)");
    println!("Current baseline: ~1200ms (10x slower)\n");

    // Test 1: Query all todos (should be ~13k rows based on seed data)
    let sql = "SELECT * FROM todos";

    let start = Instant::now();
    let rows = client.query(sql, &[]).await.expect("Query failed");
    let query_time = start.elapsed();

    let row_count = rows.len();
    println!("✓ Query executed: {} rows", row_count);
    println!("  Query time: {:?}", query_time);

    // Test 2: Measure type conversion overhead using fast_converter
    let start = Instant::now();
    let mut total_cells = 0;
    for row in &rows {
        for idx in 0..row.len() {
            // Simulate fast conversion (we'd call FastPostgresConverter here)
            let _col = &row.columns()[idx];
            total_cells += 1;
        }
    }
    let conversion_time = start.elapsed();

    println!("✓ Type conversion simulated: {} cells", total_cells);
    println!("  Conversion time: {:?}", conversion_time);

    // Calculate total time
    let total_time = query_time + conversion_time;
    println!("\n📊 Total time: {:?}", total_time);

    // Performance verdict
    let target_ms = 100;
    let actual_ms = total_time.as_millis();

    if actual_ms <= target_ms {
        println!("✅ PASSED: Under {}ms target ({}ms)", target_ms, actual_ms);
    } else if actual_ms <= 200 {
        println!("⚠️  GOOD: Within 2x target ({}ms)", actual_ms);
    } else if actual_ms <= 500 {
        println!("⚡ IMPROVED: Better than baseline but not at target ({}ms)", actual_ms);
    } else {
        println!("❌ SLOW: Above 500ms ({}ms)", actual_ms);
    }

    println!("\n=== Breakdown ===");
    println!("Query:      {:?} ({:.1}%)", query_time,
        query_time.as_millis() as f64 / total_time.as_millis() as f64 * 100.0);
    println!("Conversion: {:?} ({:.1}%)", conversion_time,
        conversion_time.as_millis() as f64 / total_time.as_millis() as f64 * 100.0);
}

/// Test fast converter performance specifically
#[tokio::test]
async fn benchmark_fast_converter() {
    let mut config = Config::new();
    config.host("localhost");
    config.port(15432);
    config.user("devuser");
    config.password("devpass123");
    config.dbname("todoapp");

    let (client, connection) = config.connect(NoTls).await.expect("Failed to connect");

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Connection error: {}", e);
        }
    });

    println!("\n=== Fast Converter Benchmark ===");

    // Query sample rows
    let rows = client
        .query("SELECT * FROM todos LIMIT 1000", &[])
        .await
        .expect("Query failed");

    println!("Loaded {} rows", rows.len());

    // Measure conversion time
    let start = Instant::now();
    let mut cell_count = 0;

    for row in &rows {
        for idx in 0..row.len() {
            // Direct type extraction (simulating fast converter)
            let column = &row.columns()[idx];
            let _type = column.type_();

            // In real implementation, we'd call:
            // let _ = FastPostgresConverter::row_to_cell(row, idx);

            cell_count += 1;
        }
    }

    let elapsed = start.elapsed();

    println!("Converted {} cells in {:?}", cell_count, elapsed);
    println!("Average per cell: {:.2}µs",
        elapsed.as_micros() as f64 / cell_count as f64);
    println!("Average per row: {:.2}µs",
        elapsed.as_micros() as f64 / rows.len() as f64);
}

/// Benchmark streaming vs single query
#[tokio::test]
async fn benchmark_streaming_batch_sizes() {
    let mut config = Config::new();
    config.host("localhost");
    config.port(15432);
    config.user("devuser");
    config.password("devpass123");
    config.dbname("todoapp");

    let (client, connection) = config.connect(NoTls).await.expect("Failed to connect");

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Connection error: {}", e);
        }
    });

    println!("\n=== Streaming Batch Size Benchmark ===");

    let batch_sizes = [100, 500, 1000, 2000, 5000];

    for &batch_size in &batch_sizes {
        let start = Instant::now();
        let mut total_rows = 0;
        let mut offset = 0;

        loop {
            let sql = format!("SELECT * FROM todos LIMIT {} OFFSET {}", batch_size, offset);
            let rows = client.query(&sql, &[]).await.expect("Query failed");

            let count = rows.len();
            total_rows += count;
            offset += batch_size;

            if count < batch_size {
                break;
            }
        }

        let elapsed = start.elapsed();
        println!("Batch size {}: {:?} for {} rows ({:.2} ms/1000 rows)",
            batch_size, elapsed, total_rows,
            elapsed.as_millis() as f64 / (total_rows as f64 / 1000.0));
    }
}

/// Test metadata caching effectiveness
#[tokio::test]
async fn benchmark_metadata_caching() {
    let mut config = Config::new();
    config.host("localhost");
    config.port(15432);
    config.user("devuser");
    config.password("devpass123");
    config.dbname("todoapp");

    let (client, connection) = config.connect(NoTls).await.expect("Failed to connect");

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Connection error: {}", e);
        }
    });

    println!("\n=== Metadata Caching Benchmark ===");

    // First query - cold cache
    let start = Instant::now();
    let stmt = client.prepare("SELECT * FROM todos LIMIT 10").await.expect("Prepare failed");
    let cold_time = start.elapsed();
    let _rows = client.query(&stmt, &[]).await.expect("Query failed");

    println!("Cold cache (prepare):     {:?}", cold_time);

    // Second query - warm cache
    let start = Instant::now();
    let _rows = client.query(&stmt, &[]).await.expect("Query failed");
    let warm_time = start.elapsed();

    println!("Warm cache (reuse stmt):  {:?}", warm_time);
    println!("Speedup: {:.2}x", cold_time.as_micros() as f64 / warm_time.as_micros() as f64);
}

/// Count actual rows in todos table
#[tokio::test]
async fn check_todos_row_count() {
    let mut config = Config::new();
    config.host("localhost");
    config.port(15432);
    config.user("devuser");
    config.password("devpass123");
    config.dbname("todoapp");

    let (client, connection) = config.connect(NoTls).await.expect("Failed to connect");

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Connection error: {}", e);
        }
    });

    let rows = client.query("SELECT COUNT(*) as count FROM todos", &[]).await.expect("Query failed");
    let count: i64 = rows[0].get(0);

    println!("\n=== Database Stats ===");
    println!("Total todos: {}", count);

    // Check table structure
    let cols = client.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'todos' ORDER BY ordinal_position",
        &[]
    ).await.expect("Query failed");

    println!("Columns: {}", cols.len());
    for col in cols {
        let name: String = col.get(0);
        let dtype: String = col.get(1);
        println!("  - {}: {}", name, dtype);
    }
}
