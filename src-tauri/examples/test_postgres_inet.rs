use std::env;
use devdb_studio::database::adapter::postgres::PostgreSQLAdapter;
use devdb_studio::database::adapter::DatabaseAdapter;
use devdb_studio::types::QueryOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Set up environment
    env::set_var("RUST_LOG", "debug");
    env_logger::init();
    
    // PostgreSQL connection string for the development environment
    let connection_string = "postgresql://devuser:devpass123@localhost:15432/todoapp";
    
    println!("Testing PostgreSQL INET type handling...");
    
    // Create adapter
    let adapter = PostgreSQLAdapter::new(connection_string).await?;
    
    // Test querying data with INET fields
    let query = "SELECT id, title, created_from_ip, last_modified_ip FROM todos LIMIT 5";
    let opts = QueryOptions {
        page_size: 5,
        ..Default::default()
    };
    
    println!("Executing query: {}", query);
    
    match adapter.begin_query(query, None, opts).await {
        Ok(cursor) => {
            println!("Query successful!");
            println!("Columns: {:?}", cursor.columns.iter().map(|c| &c.name).collect::<Vec<_>>());
            
            for (i, row) in cursor.rows.iter().enumerate() {
                println!("Row {}: ", i + 1);
                for (j, cell) in row.iter().enumerate() {
                    let column_name = &cursor.columns[j].name;
                    let value_str = match &cell.value {
                        Some(val) => val.to_string(),
                        None => "NULL".to_string(),
                    };
                    println!("  {}: {} (type: {})", column_name, value_str, cell.db_type);
                }
                println!();
            }
        }
        Err(e) => {
            println!("Query failed: {:?}", e);
            return Err(e.into());
        }
    }
    
    println!("INET type handling test completed successfully!");
    Ok(())
}