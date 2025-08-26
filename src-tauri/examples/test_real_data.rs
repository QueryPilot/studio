use devdb_studio_lib::database::adapter::postgres::PostgresAdapter;
use devdb_studio_lib::database::adapter::DbAdapter;
use devdb_studio_lib::database::adapter::QueryOptions;
use sqlx::PgPool;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let connection_string = "postgresql://devuser:devpass123@localhost:15432/todoapp";
    
    println!("Testing PostgreSQL special types from real data...");
    
    let pool = PgPool::connect(connection_string).await?;
    
    // First, ensure we have test data
    println!("Creating test table with special types...");
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS test_special_types (
            id SERIAL PRIMARY KEY,
            search_vector tsvector,
            metadata hstore,
            date_range tstzrange
        )
    "#).execute(&pool).await?;
    
    // Insert test data
    println!("Inserting test data...");
    sqlx::query(r#"
        INSERT INTO test_special_types (search_vector, metadata, date_range)
        VALUES 
            ('hello world'::tsvector, 'key1=>val1, key2=>val2'::hstore, tstzrange('2024-01-01', '2024-12-31'))
        ON CONFLICT DO NOTHING
    "#).execute(&pool).await?;
    
    // Now query it back
    let adapter = PostgresAdapter::new(pool);
    let opts = QueryOptions {
        page_size: 10,
        ..Default::default()
    };
    
    println!("\nQuerying test data...");
    let query = "SELECT id, search_vector, metadata, date_range FROM test_special_types LIMIT 1";
    
    match adapter.begin_query(query, None, opts).await {
        Ok(cursor) => {
            println!("Query successful!");
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
    
    println!("\nTest completed!");
    Ok(())
}
