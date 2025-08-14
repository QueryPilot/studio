use tauri::State;
use serde::{Serialize, Deserialize};
use crate::storage::SecureStorage;
use crate::cache::{CacheStats, PoolStats};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Performance metrics structure
#[derive(Debug, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub cache_stats: CacheStats,
    pub connection_pools: Vec<ConnectionPoolInfo>,
    pub memory_usage: MemoryUsage,
    pub encryption_stats: EncryptionStats,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionPoolInfo {
    pub connection_id: String,
    pub stats: Option<PoolStats>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryUsage {
    pub total_memory_mb: f64,
    pub used_memory_mb: f64,
    pub cache_memory_mb: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptionStats {
    pub total_encryptions: u64,
    pub total_decryptions: u64,
    pub avg_encryption_time_ms: f64,
    pub avg_decryption_time_ms: f64,
}

/// Get performance metrics
#[tauri::command]
pub async fn get_performance_metrics(
    state: State<'_, Arc<Mutex<Option<SecureStorage>>>>,
) -> Result<PerformanceMetrics, String> {
    let storage = state.lock().await;
    let storage = storage.as_ref().ok_or("Secure storage not initialized")?;
    
    // Get cache statistics
    let cache_stats = storage.get_cache_stats();
    
    // Get connection pool statistics
    let pool_ids = storage.get_active_connection_ids().await;
    let mut connection_pools = Vec::new();
    
    for id in pool_ids {
        let stats = storage.get_pool_stats(&id).await;
        connection_pools.push(ConnectionPoolInfo {
            connection_id: id,
            stats,
        });
    }
    
    // Calculate memory usage (approximation)
    let memory_usage = MemoryUsage {
        total_memory_mb: 512.0, // Example values
        used_memory_mb: 128.0,
        cache_memory_mb: (cache_stats.active_entries * 2) as f64 / 1024.0, // Rough estimate
    };
    
    // Encryption statistics (would need to be tracked in actual implementation)
    let encryption_stats = EncryptionStats {
        total_encryptions: 0,
        total_decryptions: 0,
        avg_encryption_time_ms: 0.5,
        avg_decryption_time_ms: 0.3,
    };
    
    Ok(PerformanceMetrics {
        cache_stats,
        connection_pools,
        memory_usage,
        encryption_stats,
    })
}

/// Clear performance caches
#[tauri::command]
pub async fn clear_performance_caches(
    state: State<'_, Arc<Mutex<Option<SecureStorage>>>>,
) -> Result<(), String> {
    let mut storage = state.lock().await;
    let storage = storage.as_mut().ok_or("Secure storage not initialized")?;
    
    storage.clear_cache();
    storage.cleanup_expired_cache();
    
    Ok(())
}

/// Optimize connection pools
#[tauri::command]
pub async fn optimize_connection_pools(
    state: State<'_, Arc<Mutex<Option<SecureStorage>>>>,
) -> Result<String, String> {
    let storage = state.lock().await;
    let storage = storage.as_ref().ok_or("Secure storage not initialized")?;
    
    storage.cleanup_idle_pools().await;
    
    Ok("Connection pools optimized".to_string())
}

/// Get cache hit rate
#[tauri::command]
pub async fn get_cache_hit_rate(
    state: State<'_, Arc<Mutex<Option<SecureStorage>>>>,
) -> Result<f64, String> {
    let storage = state.lock().await;
    let storage = storage.as_ref().ok_or("Secure storage not initialized")?;
    
    let stats = storage.get_cache_stats();
    
    // Calculate hit rate (would need actual tracking in implementation)
    let hit_rate = if stats.total_entries > 0 {
        (stats.active_entries as f64 / stats.total_entries as f64) * 100.0
    } else {
        0.0
    };
    
    Ok(hit_rate)
}