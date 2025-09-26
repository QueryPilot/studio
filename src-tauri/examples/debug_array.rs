use devdb_studio::adapters::postgres::PostgresAdapter;
use devdb_studio::core::adapter::DbAdapter;
use devdb_studio::types::*;
use std::collections::HashMap;

fn test_profile() -> ConnectionProfile {
    ConnectionProfile {
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
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut adapter = PostgresAdapter::new();
    let profile = test_profile();

    println!("Connecting...");
    adapter.connect(&profile).await?;

    println!("Opening simple query...");
    let handle = adapter.open_query("SELECT 1 as test_col").await?;
    println!("Query opened successfully: {:?}", handle.id);

    println!("Fetching page...");
    let chunk = adapter.fetch_page(&handle, 1).await?;
    println!("Fetched {} rows", chunk.rows.len());

    println!("Now testing array query...");
    let handle2 = adapter
        .open_query("SELECT collaborator_ids FROM todos WHERE collaborator_ids IS NOT NULL LIMIT 1")
        .await?;
    println!("Array query opened successfully: {:?}", handle2.id);

    println!("Fetching array page...");
    let chunk2 = adapter.fetch_page(&handle2, 1).await?;
    println!("Fetched {} array rows", chunk2.rows.len());

    println!("Disconnecting...");
    adapter.disconnect().await?;
    println!("Done!");

    Ok(())
}
