use devdb_studio_lib::database::adapter::postgres::PostgresAdapter;
use devdb_studio_lib::database::adapter::DbAdapter;
use devdb_studio_lib::database::adapter::QueryOptions;
use sqlx::PgPool;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // PostgreSQL connection string
    let connection_string = "postgresql://devuser:devpass123@localhost:15432/todoapp";
    
    println!("Testing PostgreSQL special types...");
    
    // Create connection pool
    let pool = PgPool::connect(connection_string).await?;
    let adapter = PostgresAdapter::new(pool);
    
    // Test query with special types
    let query = r#"
        SELECT 
            ARRAY[1, 2, 3]::INT4[] as int_array,
            'hello world'::tsvector as search_vector,
            tstzrange('2024-01-01', '2024-12-31') as date_range,
            'key1=>val1, key2=>val2'::hstore as metadata
        LIMIT 1
    "#;
    
    let opts = QueryOptions {
        page_size: 10,
        ..Default::default()
    };
    
    println!("Executing query with special types...");
    
    match adapter.begin_query(query, None, opts).await {
        Ok(cursor) => {
            println!("Query successful!");
            println!("Columns: {:?}", cursor.columns.iter().map(|c| &c.name).collect::<Vec<_>>());
            
            for (i, row) in cursor.rows.iter().enumerate() {
                println!("\nRow {}:", i + 1);
                for (j, cell) in row.iter().enumerate() {
                    let column_name = &cursor.columns[j].name;
                    let value_str = match &cell.value {
                        Some(val) => val.to_string(),
                        None => "NULL".to_string(),
                    };
                    println!("  {}: {} (type: {}, value_type: {:?})", 
                        column_name, value_str, cell.db_type, cell.value_type);
                }
            }
        }
        Err(e) => {
            println!("Query failed: {:?}", e);
            return Err(e.into());
        }
    }
    
    println!("\nSpecial types test completed!");
    Ok(())
}