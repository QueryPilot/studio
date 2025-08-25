// Test MySQL connection with the fixed adapter
// Run with: cargo run --example test_mysql --features mysql

use sqlx::MySqlPool;
use devdb_studio_lib::database::{
    adapter::{mysql::MySqlAdapter, DbAdapter, types::ConnectionConfig, types::DbType},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔌 Testing MySQL Adapter");
    
    // Connection configuration from docker-compose
    let config = ConnectionConfig {
        id: "test-mysql".to_string(),
        name: "Test MySQL".to_string(),
        db_type: DbType::Mysql,
        host: "localhost".to_string(),
        port: 13306,
        database: "todoapp".to_string(),
        username: "devuser".to_string(),
        user: None,
        password: Some("devpass123".to_string()),
        database_url: None,
        pool_size: Some(5),
        max_connections: 10,
        min_connections: 1,
        connection_timeout: 30000,
        idle_timeout: 300000,
        max_lifetime: 1800000,
        enable_health_check: Some(true),
        // MSSQL specific (unused)
        instance_name: None,
        encrypt: None,
        trust_server_certificate: None,
        auth_type: None,
        named_pipe: None,
    };

    // Build connection URL
    let database_url = format!(
        "mysql://{}:{}@{}:{}/{}",
        config.username,
        config.password.as_ref().unwrap(),
        config.host,
        config.port,
        config.database
    );
    
    println!("📡 Connecting to: mysql://{}@{}:{}/{}", 
        config.username, config.host, config.port, config.database);
    
    // Create MySQL pool
    print!("Creating MySQL pool... ");
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    println!("✅");
    
    // Create adapter
    print!("Creating MySQL adapter... ");
    let adapter = MySqlAdapter::new(pool);
    println!("✅");
    
    // Test ping
    print!("Testing ping... ");
    let start = std::time::Instant::now();
    adapter.ping().await?;
    println!("✅ ({:?})", start.elapsed());
    
    // Test server version
    print!("Getting server version... ");
    let version = adapter.server_version().await?;
    println!("✅ Server: {}", version);
    
    // Test list databases
    print!("Listing databases... ");
    let databases = adapter.list_databases().await?;
    println!("✅ Found {} databases: {:?}", databases.len(), databases);
    
    // Test list tables
    print!("Listing tables in todoapp... ");
    let tables = adapter.list_tables("todoapp", "todoapp").await?;
    println!("✅ Found {} tables:", tables.len());
    for table in &tables {
        println!("   - {} ({})", table.name, match table.kind {
            devdb_studio_lib::database::adapter::types::DbObjectKind::Table => "table",
            devdb_studio_lib::database::adapter::types::DbObjectKind::View => "view",
            devdb_studio_lib::database::adapter::types::DbObjectKind::MaterializedView => "materialized view",
        });
    }
    
    // Test column metadata for todos table
    if tables.iter().any(|t| t.name == "todos") {
        print!("Getting columns for todos table... ");
        let columns = adapter.table_columns("todoapp", "todoapp", "todos").await?;
        println!("✅ Found {} columns:", columns.len());
        for column in columns.iter().take(5) {
            println!("   - {} {} {}", 
                column.name, 
                column.db_type,
                if column.nullable { "NULL" } else { "NOT NULL" }
            );
        }
    }
    
    // Test estimate count
    if tables.iter().any(|t| t.name == "todos") {
        print!("Estimating row count for todos... ");
        let count = adapter.estimate_count("todoapp", "todoapp", "todos").await?;
        println!("✅ Estimated {} rows", count);
    }
    
    println!("\n🎉 All MySQL adapter tests passed!");
    
    Ok(())
}