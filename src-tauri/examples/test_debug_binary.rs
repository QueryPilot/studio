use devdb_studio_lib::database::adapter::postgres::PostgresAdapter;
use devdb_studio_lib::database::adapter::DbAdapter;
use devdb_studio_lib::database::adapter::QueryOptions;
use sqlx::{PgPool, Row};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let connection_string = "postgresql://devuser:devpass123@localhost:15432/todoapp";
    
    println!("Debugging binary format of special types...");
    
    let pool = PgPool::connect(connection_string).await?;
    
    // Query with both raw and text cast versions
    let row = sqlx::query(r#"
        SELECT 
            'hello world'::tsvector as search_vector,
            'hello world'::tsvector::text as search_vector_text,
            'key1=>val1, key2=>val2'::hstore as metadata,
            'key1=>val1, key2=>val2'::hstore::text as metadata_text
    "#).fetch_one(&pool).await?;
    
    // Try to get raw values
    println!("\nRaw values:");
    
    // TSVECTOR as String
    match row.try_get::<String, _>("search_vector") {
        Ok(val) => {
            println!("search_vector as String: {:?}", val);
            println!("  bytes: {:?}", val.as_bytes());
            println!("  len: {}", val.len());
        }
        Err(e) => println!("search_vector as String failed: {:?}", e),
    }
    
    // TSVECTOR as text
    match row.try_get::<String, _>("search_vector_text") {
        Ok(val) => println!("search_vector_text: {:?}", val),
        Err(e) => println!("search_vector_text failed: {:?}", e),
    }
    
    // HSTORE as String
    match row.try_get::<String, _>("metadata") {
        Ok(val) => {
            println!("\nmetadata as String: {:?}", val);
            println!("  bytes: {:?}", val.as_bytes());
            println!("  len: {}", val.len());
        }
        Err(e) => println!("metadata as String failed: {:?}", e),
    }
    
    // HSTORE as text
    match row.try_get::<String, _>("metadata_text") {
        Ok(val) => println!("metadata_text: {:?}", val),
        Err(e) => println!("metadata_text failed: {:?}", e),
    }
    
    Ok(())
}
