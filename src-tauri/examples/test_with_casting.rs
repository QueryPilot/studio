use devdb_studio_lib::database::adapter::postgres::PostgresAdapter;
use devdb_studio_lib::database::adapter::DbAdapter;
use devdb_studio_lib::database::adapter::QueryOptions;
use sqlx::PgPool;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let connection_string = "postgresql://devuser:devpass123@localhost:15432/todoapp";
    
    println!("Testing PostgreSQL special types with proper casting...");
    
    let pool = PgPool::connect(connection_string).await?;
    let adapter = PostgresAdapter::new(pool);
    
    let opts = QueryOptions {
        page_size: 10,
        ..Default::default()
    };
    
    println!("\n1. Query WITHOUT casting (shows help message):");
    let query1 = "SELECT search_vector, metadata FROM test_special_types LIMIT 1";
    
    match adapter.begin_query(query1, None, opts.clone()).await {
        Ok(cursor) => {
            for row in cursor.rows.iter() {
                for (j, cell) in row.iter().enumerate() {
                    let column_name = &cursor.columns[j].name;
                    let value_str = match &cell.value {
                        Some(val) => val.to_string(),
                        None => "NULL".to_string(),
                    };
                    println!("  {}: {}", column_name, value_str);
                }
            }
        }
        Err(e) => println!("Query failed: {:?}", e),
    }
    
    println!("\n2. Query WITH ::text casting (shows actual data):");
    let query2 = "SELECT search_vector::text, metadata::text, date_range FROM test_special_types LIMIT 1";
    
    match adapter.begin_query(query2, None, opts).await {
        Ok(cursor) => {
            for row in cursor.rows.iter() {
                for (j, cell) in row.iter().enumerate() {
                    let column_name = &cursor.columns[j].name;
                    let value_str = match &cell.value {
                        Some(val) => val.to_string(),
                        None => "NULL".to_string(),
                    };
                    println!("  {}: {}", column_name, value_str);
                }
            }
        }
        Err(e) => println!("Query failed: {:?}", e),
    }
    
    println!("\nTest completed!");
    Ok(())
}
