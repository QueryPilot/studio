use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

use crate::database::adapter::{DbAdapter, QueryOptions, QueryCursor};
use crate::error::AppError;

pub use crate::database::adapter::types::{QueryBeginResponse, QueryFetchResponse};

struct CursorState {
  cursor: QueryCursor,
  adapter: Arc<Box<dyn DbAdapter>>,
  last_accessed: Instant,
}

pub struct CursorManager {
  cursors: Arc<RwLock<HashMap<String, CursorState>>>,
  cleanup_handle: Option<JoinHandle<()>>,
}

impl CursorManager {
  pub fn new() -> Self {
    Self {
      cursors: Arc::new(RwLock::new(HashMap::new())),
      cleanup_handle: None,
    }
  }

  pub fn start_cleanup_task(mut self) -> Self {
    let cursors = self.cursors.clone();
    
    let handle = tokio::spawn(async move {
      let mut interval = tokio::time::interval(Duration::from_secs(60));
      
      loop {
        interval.tick().await;
        
        let now = Instant::now();
        let mut cursors = cursors.write().await;
        
        // Remove cursors older than 5 minutes
        let to_remove: Vec<String> = cursors
          .iter()
          .filter(|(_, state)| {
            now.duration_since(state.last_accessed) > Duration::from_secs(300)
          })
          .map(|(id, _)| id.clone())
          .collect();
        
        for id in to_remove {
          if let Some(state) = cursors.remove(&id) {
            // Clean up cursor resources
            let _ = state.adapter.close_cursor(&id).await;
          }
        }
      }
    });
    
    self.cleanup_handle = Some(handle);
    self
  }

  pub async fn begin_query(
    &self,
    adapter: Arc<Box<dyn DbAdapter>>,
    sql: String,
    params: Option<Vec<serde_json::Value>>,
    opts: QueryOptions,
  ) -> Result<QueryBeginResponse, AppError> {
    // Execute query with cursor
    let cursor = adapter.begin_query(&sql, params, opts).await?;
    
    let cursor_id = cursor.id.clone();
    let columns = cursor.columns.clone();
    let rows = cursor.rows.clone();
    let total_rows = cursor.total_rows;
    let is_complete = cursor.is_complete;
    
    // Store cursor state
    let state = CursorState {
      cursor,
      adapter: adapter.clone(),
      last_accessed: Instant::now(),
    };
    
    self.cursors.write().await.insert(cursor_id.clone(), state);
    
    Ok(QueryBeginResponse {
      cursor_id,
      columns,
      rows,
      total_rows,
      is_complete,
    })
  }

  pub async fn fetch_page(
    &self,
    cursor_id: String,
    page: usize,
    page_size: usize,
  ) -> Result<QueryFetchResponse, AppError> {
    let mut cursors = self.cursors.write().await;
    let state = cursors.get_mut(&cursor_id)
      .ok_or_else(|| AppError::CursorNotFound(cursor_id.clone()))?;
    
    state.last_accessed = Instant::now();
    
    // Fetch next page using adapter
    let page_data = state.adapter.fetch_page(&mut state.cursor, page, page_size).await?;
    
    Ok(QueryFetchResponse {
      rows: page_data.rows,
      page: page_data.page,
      is_complete: page_data.is_complete,
    })
  }

  pub async fn close_cursor(&self, cursor_id: String) -> Result<(), AppError> {
    if let Some(state) = self.cursors.write().await.remove(&cursor_id) {
      // Clean up cursor through adapter
      state.adapter.close_cursor(&cursor_id).await?;
    }
    Ok(())
  }

  pub async fn get_cursor(&self, cursor_id: &str) -> Option<QueryCursor> {
    self.cursors.read().await.get(cursor_id).map(|s| s.cursor.clone())
  }

  pub async fn cleanup_old_cursors(&self) {
    let now = Instant::now();
    let mut cursors = self.cursors.write().await;
    
    let to_remove: Vec<String> = cursors
      .iter()
      .filter(|(_, state)| {
        now.duration_since(state.last_accessed) > Duration::from_secs(300)
      })
      .map(|(id, _)| id.clone())
      .collect();
    
    for id in to_remove {
      if let Some(state) = cursors.remove(&id) {
        let _ = state.adapter.close_cursor(&id).await;
      }
    }
  }
}

impl Drop for CursorManager {
  fn drop(&mut self) {
    if let Some(handle) = self.cleanup_handle.take() {
      handle.abort();
    }
  }
}