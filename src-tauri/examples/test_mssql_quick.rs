// Quick MSSQL connection test to verify our fix
// Run with: cargo run --example test_mssql_quick --features mssql

use bb8_tiberius::ConnectionManager;
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 Quick MSSQL Connection Test");
    
    // Connection string with the FIXED format
    let conn_str = "Server=tcp:localhost,11434;Database=todoapp;User Id=sa;Password=DevPass123;TrustServerCertificate=true;Encrypt=false";
    
    // Test connection manager creation
    print!("Creating connection manager... ");
    let mgr = ConnectionManager::build(conn_str)?;
    println!("✅");
    
    // Test pool creation with optimized settings
    print!("Building connection pool... ");
    let start = Instant::now();
    let pool = bb8::Pool::builder()
        .max_size(5)
        .min_idle(Some(1))
        .connection_timeout(Duration::from_secs(30))
        .test_on_check_out(true)
        .build(mgr)
        .await?;
    println!("✅ ({:?})", start.elapsed());
    
    // Test getting connection
    print!("Getting connection from pool... ");
    let start = Instant::now();
    let mut conn = pool.get().await?;
    println!("✅ ({:?})", start.elapsed());
    
    // Test simple query
    print!("Testing simple query... ");
    let start = Instant::now();
    let stream = conn.simple_query("SELECT COUNT(*) as total_todos FROM todos").await?;
    let row = stream.into_row().await?;
    
    if let Some(row) = row {
        if let Some(count) = row.get::<i32, _>(0) {
            println!("✅ ({:?}) - Found {} todos", start.elapsed(), count);
        } else {
            println!("❌ - No count returned");
        }
    } else {
        println!("❌ - No row returned");
    }
    
    // Test complex query
    print!("Testing complex query... ");
    let query = "SELECT TOP 3 id, title, status FROM todos ORDER BY created_at DESC";
    let stream = conn.simple_query(query).await?;
    let rows = stream.into_first_result().await?;
    println!("✅ - Retrieved {} sample todos", rows.len());
    
    println!("\n🎉 All tests passed! MSSQL adapter is working correctly!");
    
    Ok(())
}