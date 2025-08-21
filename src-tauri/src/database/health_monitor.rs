use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::RwLock;
use tokio::time;
use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Emitter};
use rand::Rng;
use sqlx::{Pool, Postgres, MySql, Sqlite};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionStatus {
  Ready,
  Degraded,
  Reconnecting,
  Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHealthEvent {
  pub connection_id: String,
  pub status: ConnectionStatus,
  pub reason: Option<String>,
  pub rtt_ms: Option<u32>,
  pub at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredEvent {
  pub connection_id: String,
  pub attempts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionErrorEvent {
  pub connection_id: String,
  pub error: String,
}

pub struct HealthMonitor {
  connection_id: String,
  pool: Arc<dyn DatabasePool>,
  app_handle: AppHandle,
  interval_secs: u64,
  max_retries: u32,
}

#[async_trait::async_trait]
pub trait DatabasePool: Send + Sync {
  async fn ping(&self) -> Result<Duration, String>;
  fn db_type(&self) -> &str;
}

pub struct PostgresPool(pub Arc<Pool<Postgres>>);
pub struct MySqlPool(pub Arc<Pool<MySql>>);
pub struct SqlitePool(pub Arc<Pool<Sqlite>>);

#[async_trait::async_trait]
impl DatabasePool for PostgresPool {
  async fn ping(&self) -> Result<Duration, String> {
    let start = Instant::now();
    sqlx::query("SELECT 1")
      .fetch_one(self.0.as_ref())
      .await
      .map_err(|e| e.to_string())?;
    Ok(start.elapsed())
  }
  
  fn db_type(&self) -> &str {
    "postgres"
  }
}

#[async_trait::async_trait]
impl DatabasePool for MySqlPool {
  async fn ping(&self) -> Result<Duration, String> {
    let start = Instant::now();
    sqlx::query("SELECT 1")
      .fetch_one(self.0.as_ref())
      .await
      .map_err(|e| e.to_string())?;
    Ok(start.elapsed())
  }
  
  fn db_type(&self) -> &str {
    "mysql"
  }
}

#[async_trait::async_trait]
impl DatabasePool for SqlitePool {
  async fn ping(&self) -> Result<Duration, String> {
    let start = Instant::now();
    sqlx::query("SELECT 1")
      .fetch_one(self.0.as_ref())
      .await
      .map_err(|e| e.to_string())?;
    Ok(start.elapsed())
  }
  
  fn db_type(&self) -> &str {
    "sqlite"
  }
}


impl HealthMonitor {
  pub fn new(
    connection_id: String,
    pool: Arc<dyn DatabasePool>,
    app_handle: AppHandle,
  ) -> Self {
    Self {
      connection_id,
      pool,
      app_handle,
      interval_secs: 30,
      max_retries: 5,
    }
  }
  
  pub fn with_interval(mut self, secs: u64) -> Self {
    self.interval_secs = secs;
    self
  }
  
  pub fn with_max_retries(mut self, retries: u32) -> Self {
    self.max_retries = retries;
    self
  }
  
  pub fn spawn(self) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
      self.monitor_loop().await;
    })
  }
  
  async fn monitor_loop(self) {
    let mut interval = time::interval(Duration::from_secs(self.interval_secs));
    let mut miss_count = 0;
    let mut last_status = ConnectionStatus::Ready;
    let mut last_rtt: Option<u32> = None;
    
    loop {
      interval.tick().await;
      
      // Add jitter (±10%)
      let jitter_ms = rand::thread_rng().gen_range(0..3000);
      time::sleep(Duration::from_millis(jitter_ms)).await;
      
      let (status, rtt) = match self.pool.ping().await {
        Ok(duration) => {
          let rtt_ms = duration.as_millis() as u32;
          miss_count = 0;
          
          let status = match rtt_ms {
            0..=150 => ConnectionStatus::Ready,
            151..=1000 => ConnectionStatus::Degraded,
            _ => ConnectionStatus::Degraded,
          };
          
          (status, Some(rtt_ms))
        },
        Err(_) => {
          miss_count += 1;
          
          let status = if miss_count == 1 {
            ConnectionStatus::Degraded
          } else if miss_count >= 2 {
            self.spawn_reconnect().await;
            ConnectionStatus::Reconnecting
          } else {
            ConnectionStatus::Error
          };
          
          (status, None)
        }
      };
      
      // Only emit if status changed or RTT significantly different
      if status != last_status || Self::rtt_changed(last_rtt, rtt) {
        self.emit_health_event(status.clone(), rtt, miss_count);
        last_status = status;
        last_rtt = rtt;
      }
    }
  }
  
  fn rtt_changed(last: Option<u32>, current: Option<u32>) -> bool {
    match (last, current) {
      (Some(l), Some(c)) => {
        let diff = (l as i32 - c as i32).abs();
        diff > 50 // 50ms threshold
      },
      (None, Some(_)) | (Some(_), None) => true,
      _ => false,
    }
  }
  
  fn emit_health_event(&self, status: ConnectionStatus, rtt_ms: Option<u32>, miss_count: u32) {
    let reason = match status {
      ConnectionStatus::Degraded if miss_count > 0 => Some("Connection timeout".to_string()),
      ConnectionStatus::Degraded => Some("High latency detected".to_string()),
      ConnectionStatus::Reconnecting => Some("Attempting to reconnect".to_string()),
      ConnectionStatus::Error => Some("Connection failed".to_string()),
      _ => None,
    };
    
    let event = ConnectionHealthEvent {
      connection_id: self.connection_id.clone(),
      status,
      reason,
      rtt_ms,
      at: SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64,
    };
    
    let _ = self.app_handle.emit("db:connection_status", &event);
  }
  
  async fn spawn_reconnect(&self) {
    let connection_id = self.connection_id.clone();
    let pool = Arc::clone(&self.pool);
    let app_handle = self.app_handle.clone();
    let max_retries = self.max_retries;
    
    tokio::spawn(async move {
      let backoff = [1, 2, 5, 10, 30];
      
      for (attempt, delay) in backoff.iter().take(max_retries as usize).enumerate() {
        time::sleep(Duration::from_secs(*delay)).await;
        
        if pool.ping().await.is_ok() {
          let _ = app_handle.emit("db:connection_recovered", &RecoveredEvent {
            connection_id: connection_id.clone(),
            attempts: (attempt + 1) as u32,
          });
          return;
        }
      }
      
      let _ = app_handle.emit("db:connection_error", &ConnectionErrorEvent {
        connection_id,
        error: format!("Failed to reconnect after {} attempts", max_retries),
      });
    });
  }
}

pub struct HealthRegistry {
  monitors: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
}

impl HealthRegistry {
  pub fn new() -> Self {
    Self {
      monitors: Arc::new(RwLock::new(HashMap::new())),
    }
  }
  
  pub async fn register_monitor(
    &self,
    connection_id: String,
    pool: Arc<dyn DatabasePool>,
    app_handle: AppHandle,
  ) {
    let monitor = HealthMonitor::new(connection_id.clone(), pool, app_handle)
      .with_interval(30)
      .with_max_retries(5);
    
    let handle = monitor.spawn();
    
    let mut monitors = self.monitors.write().await;
    if let Some(old_handle) = monitors.insert(connection_id, handle) {
      old_handle.abort();
    }
  }
  
  pub async fn unregister_monitor(&self, connection_id: &str) {
    let mut monitors = self.monitors.write().await;
    if let Some(handle) = monitors.remove(connection_id) {
      handle.abort();
    }
  }
  
  pub async fn shutdown_all(&self) {
    let mut monitors = self.monitors.write().await;
    for (_, handle) in monitors.drain() {
      handle.abort();
    }
  }
}