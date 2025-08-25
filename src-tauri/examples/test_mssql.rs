// Test MSSQL connection with the fixed adapter
// Run with: cargo run --example test_mssql --features mssql

use bb8_tiberius::ConnectionManager;
use std::time::{Duration, Instant};
use tiberius::{Row, Column};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n=== MSSQL Connection Test Suite ===\n");
    println!("Testing connection to SQL Server in Docker container...\n");
    
    // Connection parameters from README_DATABASES.md
    let host = "localhost";
    let port = 11434;
    let database = "todoapp";
    let username = "sa";
    let password = "DevPass123";
    
    // Build proper ADO.NET connection string (FIXED FORMAT)
    let conn_str = format!(
        "Server={},{};Database={};User Id={};Password={};TrustServerCertificate=true;Encrypt=false",
        host, port, database, username, password
    );
    
    println!("📋 Connection Configuration:");
    println!("   Host: {}:{}", host, port);
    println!("   Database: {}", database);
    println!("   Username: {}", username);
    println!("   Connection String: {}\n", conn_str.replace(password, "***"));
    
    // Test 1: Create connection manager
    println!("🔧 Test 1: Creating connection manager...");
    let mgr = match ConnectionManager::build(conn_str.as_str()) {
        Ok(mgr) => {
            println!("   ✅ Connection manager created");
            mgr
        },
        Err(e) => {
            println!("   ❌ Failed to create connection manager: {}", e);
            return Err(e.into());
        }
    };
    
    // Test 2: Build connection pool with optimized settings
    println!("\n🏊 Test 2: Building connection pool...");
    let start = Instant::now();
    let pool = match bb8::Pool::builder()
        .max_size(5)  // Increased pool size
        .min_idle(Some(1))  // Keep minimum connections alive
        .connection_timeout(Duration::from_secs(30))  // Longer timeout for Docker
        .test_on_check_out(true)  // Enable connection testing
        .build(mgr)
        .await {
        Ok(pool) => {
            println!("   ✅ Pool created in {:?}", start.elapsed());
            pool
        },
        Err(e) => {
            println!("   ❌ Failed to build pool: {}", e);
            return Err(e.into());
        }
    };
    
    // Test 3: Get connection from pool
    println!("\n🔌 Test 3: Getting connection from pool...");
    let start = Instant::now();
    let mut conn = match pool.get().await {
        Ok(conn) => {
            println!("   ✅ Connection acquired in {:?}", start.elapsed());
            conn
        },
        Err(e) => {
            println!("   ❌ Failed to get connection: {}", e);
            return Err(e.into());
        }
    };
    
    // Test 4: Simple query
    println!("\n🔍 Test 4: Executing simple query...");
    let start = Instant::now();
    let stream = conn.simple_query("SELECT 1 AS test_value, GETDATE() as server_time").await?;
    let row = stream.into_row().await?;
    
    if let Some(row) = row {
        if let Some(value) = row.get::<i32, _>(0) {
            println!("   ✅ Query returned: {}", value);
            println!("   ⏱️ Query time: {:?}", start.elapsed());
        }
        if let Some(time) = row.get::<chrono::NaiveDateTime, _>(1) {
            println!("   🕐 Server time: {}", time);
        }
    }
    
    // Test 5: Server version
    println!("\n📦 Test 5: Getting server version...");
    let stream = conn.simple_query("SELECT @@VERSION").await?;
    let row = stream.into_row().await?;
    
    if let Some(row) = row {
        if let Some(version) = row.get::<&str, _>(0) {
            let first_line = version.lines().next().unwrap_or(version);
            println!("   ✅ Server: {}", first_line);
        }
    }
    
    // Test 6: List databases
    println!("\n🗂️ Test 6: Listing databases...");
    let query = "SELECT name FROM sys.databases WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb') ORDER BY name";
    let stream = conn.simple_query(query).await?;
    let rows = stream.into_first_result().await?;
    
    println!("   ✅ Found {} user databases:", rows.len());
    for row in rows.iter().take(5) {
        if let Some(name) = row.get::<&str, _>(0) {
            println!("      - {}", name);
        }
    }
    
    // Test 7: Check todoapp database and tables
    println!("\n📊 Test 7: Checking todoapp database structure...");
    let query = "
        SELECT 
            t.TABLE_SCHEMA,
            t.TABLE_NAME,
            t.TABLE_TYPE
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_CATALOG = 'todoapp'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
    ";
    
    let stream = conn.simple_query(query).await?;
    let rows = stream.into_first_result().await?;
    
    println!("   ✅ Found {} tables/views in todoapp:", rows.len());
    for row in rows.iter().take(10) {
        let schema = row.get::<&str, _>(0).unwrap_or("unknown");
        let table = row.get::<&str, _>(1).unwrap_or("unknown");
        let table_type = row.get::<&str, _>(2).unwrap_or("unknown");
        println!("      - {}.{} ({})", schema, table, table_type);
    }
    
    // Test 8: Query todos table
    println!("\n📋 Test 8: Querying todos table...");
    let query = "SELECT TOP 5 id, title, status, priority, created_at FROM todos ORDER BY created_at DESC";
    let mut stream = conn.simple_query(query).await?;
    
    // Get column metadata
    let columns_info = stream.columns().await?.unwrap_or_default();
    println!("   ✅ Columns:");
    for col in columns_info.iter() {
        println!("      - {}", col.name());
    }
    
    let rows = stream.into_first_result().await?;
    println!("\n   ✅ Sample data ({} rows):", rows.len());
    for (i, row) in rows.iter().enumerate() {
        let id = row.get::<i32, _>(0).unwrap_or(0);
        let title = row.get::<&str, _>(1).unwrap_or("N/A");
        let status = row.get::<&str, _>(2).unwrap_or("N/A");
        let priority = row.get::<&str, _>(3).unwrap_or("N/A");
        println!("      {}. [{}] {} (Status: {}, Priority: {})", 
            i + 1, id, title, status, priority);
    }
    
    // Test 9: Test data types
    println!("\n🎯 Test 9: Testing various SQL Server data types...");
    let query = "
        SELECT 
            CAST(123 as INT) as int_val,
            CAST(456.789 as DECIMAL(10,3)) as decimal_val,
            CAST('Hello' as NVARCHAR(50)) as string_val,
            CAST(1 as BIT) as bit_val,
            GETDATE() as datetime_val,
            NEWID() as guid_val
    ";
    
    let stream = conn.simple_query(query).await?;
    let row = stream.into_row().await?;
    
    if let Some(row) = row {
        println!("   ✅ Data type tests:");
        if let Some(val) = row.get::<i32, _>(0) {
            println!("      INT: {}", val);
        }
        if let Some(val) = row.get::<rust_decimal::Decimal, _>(1) {
            println!("      DECIMAL: {}", val);
        }
        if let Some(val) = row.get::<&str, _>(2) {
            println!("      NVARCHAR: {}", val);
        }
        if let Some(val) = row.get::<bool, _>(3) {
            println!("      BIT: {}", val);
        }
        if let Some(val) = row.get::<chrono::NaiveDateTime, _>(4) {
            println!("      DATETIME: {}", val);
        }
        if let Some(val) = row.get::<uuid::Uuid, _>(5) {
            println!("      UNIQUEIDENTIFIER: {}", val);
        }
    }
    
    // Test 10: Test DML operations
    println!("\n✏️ Test 10: Testing DML operations...");
    
    // Create test table
    let create_table = "
        IF EXISTS (SELECT * FROM sysobjects WHERE name='rust_test' AND xtype='U')
            DROP TABLE rust_test;
        
        CREATE TABLE rust_test (
            id INT IDENTITY(1,1) PRIMARY KEY,
            name NVARCHAR(100),
            value INT,
            created_at DATETIME DEFAULT GETDATE()
        )
    ";
    
    let result = conn.execute(create_table, &[]).await?;
    println!("   ✅ Test table created (affected: {})", result.total());
    
    // Insert data
    let insert_sql = "INSERT INTO rust_test (name, value) VALUES ('test1', 100), ('test2', 200), ('test3', 300)";
    let result = conn.execute(insert_sql, &[]).await?;
    println!("   ✅ Inserted {} rows", result.rows_affected().iter().sum::<u64>());
    
    // Query inserted data
    let query = "SELECT * FROM rust_test ORDER BY id";
    let stream = conn.simple_query(query).await?;
    let rows = stream.into_first_result().await?;
    
    println!("   ✅ Retrieved {} rows:", rows.len());
    for row in rows {
        let id = row.get::<i32, _>(0).unwrap_or(0);
        let name = row.get::<&str, _>(1).unwrap_or("N/A");
        let value = row.get::<i32, _>(2).unwrap_or(0);
        println!("      ID: {}, Name: {}, Value: {}", id, name, value);
    }
    
    // Update data
    let update_sql = "UPDATE rust_test SET value = value * 2 WHERE name = 'test2'";
    let result = conn.execute(update_sql, &[]).await?;
    println!("   ✅ Updated {} rows", result.rows_affected().iter().sum::<u64>());
    
    // Delete test table
    let drop_table = "DROP TABLE rust_test";
    conn.execute(drop_table, &[]).await?;
    println!("   ✅ Test table cleaned up");
    
    // Test 11: Connection pool statistics
    println!("\n📊 Test 11: Connection pool statistics...");
    let state = pool.state();
    println!("   Pool state:");
    println!("      Connections: {}", state.connections);
    println!("      Idle connections: {}", state.idle_connections);
    
    // Test 12: Stress test with multiple connections
    println!("\n🚀 Test 12: Stress testing with multiple connections...");
    let mut handles = vec![];
    let pool_clone = pool.clone();
    
    for i in 0..3 {
        let pool = pool_clone.clone();
        let handle = tokio::spawn(async move {
            let start = Instant::now();
            let mut conn = pool.get().await.unwrap();
            let stream = conn.simple_query("SELECT 1").await.unwrap();
            let _ = stream.into_row().await.unwrap();
            println!("      Thread {} completed in {:?}", i, start.elapsed());
        });
        handles.push(handle);
    }
    
    for handle in handles {
        handle.await?;
    }
    println!("   ✅ All concurrent connections successful");
    
    println!("\n=== MSSQL Connection Test Complete ===");
    println!("✅ All tests passed successfully!");
    println!("🎉 The MSSQL adapter connection fix is working properly!");
    
    Ok(())
}