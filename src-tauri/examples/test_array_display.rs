use devdb_studio_lib::database::adapter::postgres::PostgresAdapter;
use devdb_studio_lib::database::adapter::DbAdapter;
use devdb_studio_lib::database::adapter::QueryOptions;
use devdb_studio_lib::database::CellValueType;
use sqlx::PgPool;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let connection_string = "postgresql://devuser:devpass123@localhost:15432/todoapp";
    
    println!("Testing PostgreSQL array display...");
    
    let pool = PgPool::connect(connection_string).await?;
    
    // Create test table
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS test_arrays (
            id SERIAL PRIMARY KEY,
            int4_array INT4[],
            int8_array INT8[],
            text_array TEXT[],
            float_array FLOAT8[]
        )
    "#).execute(&pool).await?;
    
    // Insert test data
    sqlx::query(r#"
        INSERT INTO test_arrays (int4_array, int8_array, text_array, float_array)
        VALUES 
            (ARRAY[35,92]::INT4[], ARRAY[19,21]::INT8[], ARRAY['hello','world']::TEXT[], ARRAY[3.14,2.71]::FLOAT8[]),
            (ARRAY[47,57]::INT4[], ARRAY[20,19]::INT8[], ARRAY['foo','bar']::TEXT[], ARRAY[1.41,1.73]::FLOAT8[]),
            (ARRAY[65,28]::INT4[], ARRAY[22,22]::INT8[], NULL, NULL),
            (NULL, NULL, ARRAY[]::TEXT[], ARRAY[]::FLOAT8[])
        ON CONFLICT DO NOTHING
    "#).execute(&pool).await?;
    
    let adapter = PostgresAdapter::new(pool);
    let opts = QueryOptions {
        page_size: 10,
        ..Default::default()
    };
    
    println!("\nQuerying array data...");
    let query = "SELECT id, int4_array, int8_array, text_array, float_array FROM test_arrays ORDER BY id";
    
    match adapter.begin_query(query, None, opts).await {
        Ok(cursor) => {
            println!("Query successful!");
            println!("\nColumns: {:?}", cursor.columns.iter().map(|c| &c.name).collect::<Vec<_>>());
            
            for (i, row) in cursor.rows.iter().enumerate() {
                println!("\nRow {}:", i + 1);
                for (j, cell) in row.iter().enumerate() {
                    let column_name = &cursor.columns[j].name;
                    let value_str = match &cell.value {
                        Some(val) => val.to_string(),
                        None => "NULL".to_string(),
                    };
                    
                    // Show metadata for arrays
                    let metadata_str = if cell.value_type == CellValueType::Array {
                        if let Some(ref meta) = cell.metadata {
                            format!(" (element_type: {:?})", meta.element_type)
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };
                    
                    println!("  {}: {}{}", column_name, value_str, metadata_str);
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
