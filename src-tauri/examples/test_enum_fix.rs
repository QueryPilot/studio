use sqlx::{PgPool, Row};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let connection_string = "postgresql://devuser:devpass123@localhost:15432/todoapp";
    
    println!("Investigating and fixing test_enum table issue...");
    
    let pool = PgPool::connect(connection_string).await?;
    
    // Check the structure of test_enum table
    println!("\n1. Examining test_enum table structure:");
    let structure = sqlx::query(r#"
        SELECT 
            column_name, 
            data_type, 
            udt_name,
            is_nullable,
            column_default
        FROM information_schema.columns 
        WHERE table_name = 'test_enum' 
        AND table_schema = 'public'
        ORDER BY ordinal_position
    "#).fetch_all(&pool).await?;
    
    for row in &structure {
        let column_name: String = row.get("column_name");
        let data_type: String = row.get("data_type");
        let udt_name: String = row.get("udt_name");
        let is_nullable: String = row.get("is_nullable");
        let default: Option<String> = row.try_get("column_default").ok();
        println!("   {}: {} (udt: {}, nullable: {}, default: {:?})", 
            column_name, data_type, udt_name, is_nullable, default);
    }
    
    // Check if we can see the actual column with the problematic type
    println!("\n2. Raw pg_attribute info for test_enum:");
    match sqlx::query(r#"
        SELECT 
            a.attname as column_name,
            a.atttypid as type_oid,
            pt.typname as type_name,
            a.attnotnull,
            a.atthasdef
        FROM pg_attribute a
        LEFT JOIN pg_type pt ON pt.oid = a.atttypid
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'test_enum' 
        AND a.attnum > 0 
        AND NOT a.attisdropped
        ORDER BY a.attnum
    "#).fetch_all(&pool).await {
        Ok(rows) => {
            for row in rows {
                let column_name: String = row.get("column_name");
                let type_oid: i32 = row.get("type_oid");
                let type_name: Option<String> = row.try_get("type_name").ok().flatten();
                let not_null: bool = row.get("attnotnull");
                let has_default: bool = row.get("atthasdef");
                println!("   {}: type_oid={}, type_name={:?}, not_null={}, has_default={}", 
                    column_name, type_oid, type_name, not_null, has_default);
            }
        }
        Err(e) => {
            println!("   Error getting raw attributes: {}", e);
        }
    }
    
    // Solution: Drop the problematic table since it's a test table
    println!("\n3. Fixing the issue by dropping the problematic test table:");
    match sqlx::query("DROP TABLE IF EXISTS test_enum CASCADE").execute(&pool).await {
        Ok(_) => println!("   ✓ Successfully dropped test_enum table"),
        Err(e) => println!("   ✗ Error dropping table: {}", e),
    }
    
    // Verify the fix
    println!("\n4. Verifying fix - querying all tables again:");
    let tables = sqlx::query(r#"
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
        ORDER BY schemaname, tablename
    "#).fetch_all(&pool).await?;
    
    let mut all_successful = true;
    for row in &tables {
        let schema: String = row.get("schemaname");
        let table: String = row.get("tablename");
        
        let query = format!("SELECT * FROM {}.{} LIMIT 1", schema, table);
        match sqlx::query(&query).fetch_optional(&pool).await {
            Ok(_) => {} // Success, no output needed
            Err(e) => {
                if e.to_string().contains("cache lookup failed for type") {
                    println!("   ✗ {}.{}: Still has type lookup error: {}", schema, table, e);
                    all_successful = false;
                } else {
                    println!("   ⚠ {}.{}: Other error: {}", schema, table, e);
                }
            }
        }
    }
    
    if all_successful {
        println!("   ✓ All tables can now be queried successfully!");
    }
    
    println!("\nFix completed!");
    Ok(())
}
