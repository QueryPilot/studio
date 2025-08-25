// Test MSSQL (Azure SQL Edge) connection with the user's configuration
// Run with: cargo run --example test_mssql_azure --features mssql

use devdb_studio_lib::database::{
    adapter::{mssql::MssqlAdapter, DbAdapter, types::ConnectionConfig, types::DbType},
};
use tiberius::{Client, Config, AuthMethod};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use bb8::Pool;
use bb8_tiberius::ConnectionManager;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔌 Testing MSSQL (Azure SQL Edge) Adapter");
    
    // Connection configuration from user's docker setup
    let config = ConnectionConfig {
        id: "test-mssql".to_string(),
        name: "Test MSSQL".to_string(),
        db_type: DbType::Mssql,
        host: "localhost".to_string(),
        port: 2433,  // User's Azure SQL Edge port
        database: "master".to_string(),  // Start with master database
        username: "sa".to_string(),
        user: None,
        password: Some("Ps1234567!".to_string()),  // User's password
        database_url: None,
        pool_size: Some(5),
        max_connections: 10,
        min_connections: 1,
        connection_timeout: 30000,
        idle_timeout: 300000,
        max_lifetime: 1800000,
        enable_health_check: Some(true),
        // MSSQL specific
        instance_name: None,
        encrypt: Some(false),  // Azure SQL Edge on local doesn't need encryption
        trust_server_certificate: Some(true),
        auth_type: None,
        named_pipe: None,
    };

    println!("📡 Connecting to: {}:{}@{}:{}/{}", 
        config.username, "***", config.host, config.port, config.database);
    
    // Create Tiberius config
    print!("Creating Tiberius config... ");
    let mut tiberius_config = Config::new();
    tiberius_config.host(config.host.clone());
    tiberius_config.port(config.port);
    tiberius_config.database(config.database.clone());
    tiberius_config.authentication(AuthMethod::sql_server(&config.username, config.password.as_ref().unwrap()));
    tiberius_config.trust_cert();  // Trust the self-signed certificate
    println!("✅");
    
    // Create connection manager
    print!("Creating connection manager... ");
    let mgr = ConnectionManager::build(
        config.host.clone(),
        config.port,
    )?;
    println!("✅");
    
    // Create pool
    print!("Creating connection pool... ");
    let pool = Pool::builder()
        .max_size(5)
        .build(mgr)
        .await?;
    println!("✅");
    
    // Create adapter
    print!("Creating MSSQL adapter... ");
    let adapter = MssqlAdapter::new(pool, config);
    println!("✅");
    
    // Test ping
    print!("Testing ping... ");
    let start = std::time::Instant::now();
    match adapter.ping().await {
        Ok(duration) => println!("✅ ({:?})", duration),
        Err(e) => {
            println!("❌ Error: {:?}", e);
            return Err(Box::new(e));
        }
    }
    
    // Test server version
    print!("Getting server version... ");
    match adapter.server_version().await {
        Ok(version) => println!("✅ Server: {}", version),
        Err(e) => println!("⚠️  Error: {:?}", e),
    }
    
    // Test list databases
    print!("Listing databases... ");
    match adapter.list_databases().await {
        Ok(databases) => println!("✅ Found {} databases: {:?}", databases.len(), databases),
        Err(e) => println!("⚠️  Error: {:?}", e),
    }
    
    println!("\n🎉 MSSQL adapter connection test completed!");
    
    Ok(())
}