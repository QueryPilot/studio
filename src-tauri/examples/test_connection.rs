use devdb_studio::adapters::postgres::PostgresAdapter;
use devdb_studio::core::adapter::DbAdapter;
use devdb_studio::types::*;
use std::collections::HashMap;

#[tokio::main]
async fn main() {
    let profile = ConnectionProfile {
        id: "test".to_string(),
        name: "Test PostgreSQL".to_string(),
        db_type: DbType::PostgreSQL,
        host: "localhost".to_string(),
        port: 15432,
        database: "todoapp".to_string(),
        username: "devuser".to_string(),
        password: Some("devpass123".to_string()),
        ssl_mode: Some(SslMode::Disable),
        options: HashMap::new(),
    };
    
    let mut adapter = PostgresAdapter::new();
    
    println!("Connecting to PostgreSQL...");
    match adapter.connect(&profile).await {
        Ok(_) => println!("✓ Connected successfully!"),
        Err(e) => {
            eprintln!("✗ Failed to connect: {}", e);
            return;
        }
    }
    
    println!("\nTesting connection...");
    match adapter.test_connection().await {
        Ok(result) => {
            println!("✓ Connection test passed!");
            println!("  Message: {}", result.message);
            if let Some(version) = result.version {
                println!("  Version: {}", version);
            }
        }
        Err(e) => eprintln!("✗ Connection test failed: {}", e),
    }
    
    println!("\nFetching schemas...");
    match adapter.get_schemas("todoapp").await {
        Ok(schemas) => {
            println!("✓ Found {} schemas:", schemas.len());
            for schema in schemas {
                println!("  - {}", schema.name);
            }
        }
        Err(e) => eprintln!("✗ Failed to get schemas: {}", e),
    }
    
    println!("\nFetching tables from public schema...");
    match adapter.get_tables("public").await {
        Ok(tables) => {
            println!("✓ Found {} tables:", tables.len());
            for table in tables.iter().take(5) {
                println!("  - {} ({})", table.name, table.size.as_ref().unwrap_or(&"unknown".to_string()));
            }
        }
        Err(e) => eprintln!("✗ Failed to get tables: {}", e),
    }
    
    println!("\nRunning a simple query...");
    match adapter.open_query("SELECT COUNT(*) FROM todos").await {
        Ok(handle) => {
            println!("✓ Query opened, handle: {}", handle.id);
            println!("  Columns: {:?}", handle.columns.iter().map(|c| &c.name).collect::<Vec<_>>());
            
            match adapter.fetch_page(&handle, 10).await {
                Ok(chunk) => {
                    println!("✓ Fetched {} rows", chunk.rows.len());
                    if let Some(row) = chunk.rows.first() {
                        if let Some(cell) = row.first() {
                            println!("  Total todos: {}", cell.display_value);
                        }
                    }
                }
                Err(e) => eprintln!("✗ Failed to fetch results: {}", e),
            }
        }
        Err(e) => eprintln!("✗ Failed to open query: {}", e),
    }
    
    println!("\nDisconnecting...");
    match adapter.disconnect().await {
        Ok(_) => println!("✓ Disconnected successfully!"),
        Err(e) => eprintln!("✗ Failed to disconnect: {}", e),
    }
    
    println!("\n✅ Test completed!");
}