use mongodb::{Client, bson::doc};
use crate::error::AppError;

pub struct MongoConnection {
    client: Client,
}

impl MongoConnection {
    pub fn new(client: Client) -> Self {
        Self { client }
    }
    
    pub async fn ping(&self) -> Result<(), AppError> {
        self.client
            .database("admin")
            .run_command(doc! { "ping": 1 }, None)
            .await
            .map_err(|e| AppError::Database(format!("MongoDB ping failed: {}", e)))?;
        Ok(())
    }
    
    pub async fn disconnect(&self) -> Result<(), AppError> {
        // MongoDB client automatically manages connections
        // No explicit disconnect needed
        Ok(())
    }
    
    pub async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let db_specs = self.client
            .list_databases(None, None)
            .await
            .map_err(|e| AppError::Database(format!("Failed to list databases: {}", e)))?;
        
        let database_names = db_specs
            .into_iter()
            .map(|spec| spec.name)
            .filter(|name| !["admin", "config", "local"].contains(&name.as_str())) // Filter system databases
            .collect();
        
        Ok(database_names)
    }
    
    pub async fn get_server_version(&self) -> Result<String, AppError> {
        let result = self.client
            .database("admin")
            .run_command(doc! { "buildInfo": 1 }, None)
            .await
            .map_err(|e| AppError::Database(format!("Failed to get server version: {}", e)))?;
        
        let version = result
            .get_str("version")
            .map_err(|e| AppError::Database(format!("Failed to parse server version: {}", e)))?;
        
        Ok(format!("MongoDB {}", version))
    }
}