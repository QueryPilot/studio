use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use futures::future::AbortHandle;
use futures::future::Abortable;
use futures::future::abortable;

use crate::database::adapter::{DbAdapter, types::*};
use crate::error::AppError;

pub struct QueryExecutor {
    abort_registry: Arc<RwLock<HashMap<String, AbortHandle>>>,
    cancellation_tokens: Arc<RwLock<HashMap<String, CancellationToken>>>,
}

impl QueryExecutor {
    pub fn new() -> Self {
        Self {
            abort_registry: Arc::new(RwLock::new(HashMap::new())),
            cancellation_tokens: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    pub async fn execute_cancellable(
        &self,
        query_id: String,
        adapter: Arc<Box<dyn DbAdapter>>,
        sql: String,
        params: Option<Vec<serde_json::Value>>,
    ) -> Result<ExecuteResult, AppError> {
        let (abort_handle, abort_registration) = AbortHandle::new_pair();
        
        // Register abort handle
        self.abort_registry.write().await.insert(query_id.clone(), abort_handle);
        
        // Execute with cancellation support
        let query_future = Abortable::new(
            adapter.execute(&sql, params),
            abort_registration,
        );
        
        match query_future.await {
            Ok(result) => {
                self.abort_registry.write().await.remove(&query_id);
                result
            }
            Err(_aborted) => {
                self.abort_registry.write().await.remove(&query_id);
                Err(AppError::QueryCancelled(query_id))
            }
        }
    }
    
    pub async fn begin_query_cancellable(
        &self,
        query_id: String,
        adapter: Arc<Box<dyn DbAdapter>>,
        sql: String,
        params: Option<Vec<serde_json::Value>>,
        opts: QueryOptions,
    ) -> Result<QueryCursor, AppError> {
        let (abort_handle, abort_registration) = AbortHandle::new_pair();
        
        // Register abort handle
        self.abort_registry.write().await.insert(query_id.clone(), abort_handle);
        
        // Execute with cancellation support
        let query_future = Abortable::new(
            adapter.begin_query(&sql, params, opts),
            abort_registration,
        );
        
        match query_future.await {
            Ok(result) => {
                // Keep abort handle for potential cancellation of fetches
                result
            }
            Err(_aborted) => {
                self.abort_registry.write().await.remove(&query_id);
                Err(AppError::QueryCancelled(query_id))
            }
        }
    }
    
    pub async fn cancel(&self, query_id: &str) -> Result<(), AppError> {
        // Try to cancel via abort handle
        if let Some(handle) = self.abort_registry.write().await.remove(query_id) {
            handle.abort();
            return Ok(());
        }
        
        // Try to cancel via cancellation token
        if let Some(token) = self.cancellation_tokens.write().await.remove(query_id) {
            token.cancel();
            return Ok(());
        }
        
        Err(AppError::QueryNotFound(query_id.to_string()))
    }
    
    pub async fn cancel_all(&self) {
        // Cancel all abort handles
        let mut registry = self.abort_registry.write().await;
        for (_, handle) in registry.drain() {
            handle.abort();
        }
        
        // Cancel all cancellation tokens
        let mut tokens = self.cancellation_tokens.write().await;
        for (_, token) in tokens.drain() {
            token.cancel();
        }
    }
    
    pub async fn is_cancelled(&self, query_id: &str) -> bool {
        if let Some(token) = self.cancellation_tokens.read().await.get(query_id) {
            return token.is_cancelled();
        }
        false
    }
    
    pub async fn register_cancellation_token(&self, query_id: String) -> CancellationToken {
        let token = CancellationToken::new();
        self.cancellation_tokens.write().await.insert(query_id, token.clone());
        token
    }
    
    pub async fn remove_cancellation_token(&self, query_id: &str) {
        self.cancellation_tokens.write().await.remove(query_id);
        self.abort_registry.write().await.remove(query_id);
    }
}