/// Standalone performance test for fast query path
/// Run with: cargo test --test query_performance -- --nocapture
use std::time::Instant;
use tokio_postgres::{Config, NoTls};

#[tokio::test]
async fn test_query_performance() {
    println!("\n=== Connecting to PostgreSQL ===");

    let mut config = Config::new();
    config.host("localhost");
    config.port(15432);
    config.user("devuser");
    config.password("devpass123");
    config.dbname("todoapp");

    let connect_start = Instant::now();
    let (client, connection) = match config.connect(NoTls).await {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("❌ Connection failed: {}", e);
            eprintln!("Make sure PostgreSQL is running: make docker-up");
            panic!("Cannot connect to database");
        }
    };

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Connection error: {}", e);
        }
    });

    println!("✓ Connected in {:?}", connect_start.elapsed());

    // Check row count
    println!("\n=== Checking database ===");
    let count_result = client
        .query("SELECT COUNT(*) FROM todos", &[])
        .await
        .expect("Count query failed");
    let row_count: i64 = count_result[0].get(0);
    println!("✓ Todos table has {} rows", row_count);

    if row_count == 0 {
        eprintln!("❌ Database is empty! Run: make seed-postgres");
        panic!("No test data");
    }

    // Benchmark query
    println!("\n=== Performance Test ===");
    println!("Target: < 100ms (TablePlus baseline)");
    println!("Current: ~1200ms (10x slower - before optimizations)\n");

    let query_start = Instant::now();
    let rows = client
        .query("SELECT * FROM todos", &[])
        .await
        .expect("Query failed");
    let query_time = query_start.elapsed();

    println!("✓ Query executed: {} rows in {:?}", rows.len(), query_time);

    // Simulate fast type conversion
    let convert_start = Instant::now();
    let mut cell_count = 0;
    for row in &rows {
        for idx in 0..row.len() {
            // This simulates what FastPostgresConverter::row_to_cell does
            let column = &row.columns()[idx];
            let pg_type = column.type_();

            // Simulate type extraction (the actual implementation would extract values)
            let _ = pg_type.name();
            cell_count += 1;
        }
    }
    let convert_time = convert_start.elapsed();

    println!(
        "✓ Type conversion: {} cells in {:?}",
        cell_count, convert_time
    );

    // Total time
    let total_time = query_time + convert_time;
    let total_ms = total_time.as_millis();

    println!("\n📊 Results:");
    println!(
        "  Query time:      {:?} ({:.1}%)",
        query_time,
        query_time.as_millis() as f64 / total_ms as f64 * 100.0
    );
    println!(
        "  Conversion time: {:?} ({:.1}%)",
        convert_time,
        convert_time.as_millis() as f64 / total_ms as f64 * 100.0
    );
    println!("  Total time:      {:?}", total_time);

    // Performance verdict
    if total_ms <= 100 {
        println!("\n✅ EXCELLENT: At or under 100ms target!");
    } else if total_ms <= 200 {
        println!("\n⚡ GOOD: Within 2x of target");
    } else if total_ms <= 500 {
        println!("\n⚡ IMPROVED: Much better than 1200ms baseline");
    } else {
        println!("\n⚠️  SLOW: Still above 500ms (baseline was 1200ms)");
    }

    println!(
        "\nSpeedup vs baseline: {:.2}x faster",
        1200.0 / total_ms as f64
    );
}

#[tokio::test]
async fn test_batch_streaming() {
    let mut config = Config::new();
    config.host("localhost");
    config.port(15432);
    config.user("devuser");
    config.password("devpass123");
    config.dbname("todoapp");

    let (client, connection) = config.connect(NoTls).await.expect("Connection failed");

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Connection error: {}", e);
        }
    });

    println!("\n=== Batch Streaming Test ===");

    let batch_size = 1000;
    let start = Instant::now();
    let mut total_rows = 0;
    let mut batch_num = 0;

    loop {
        let offset = batch_num * batch_size;
        let sql = format!("SELECT * FROM todos LIMIT {} OFFSET {}", batch_size, offset);

        let batch_start = Instant::now();
        let rows = client.query(&sql, &[]).await.expect("Query failed");
        let batch_time = batch_start.elapsed();

        let count = rows.len();
        if count > 0 {
            total_rows += count;
            batch_num += 1;
            println!("Batch {}: {} rows in {:?}", batch_num, count, batch_time);
        }

        if count < batch_size {
            break;
        }
    }

    let total_time = start.elapsed();
    println!("\n✓ Streamed {} rows in {} batches", total_rows, batch_num);
    println!("  Total time: {:?}", total_time);
    if batch_num > 0 {
        let avg_micros = total_time.as_micros() / batch_num as u128;
        println!("  Avg per batch: {}µs", avg_micros);
    }
}
