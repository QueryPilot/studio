# P0-001: Connection Health Monitoring

## Priority
P0 - Critical Foundation

## Dependencies
None - This is a foundational task

## Estimated Effort
4-6 hours

## Problem Statement
Currently, there's no way to detect when database connections become unhealthy or disconnected. Users experience timeouts and errors without warning, leading to poor UX and potential data loss.

## Acceptance Criteria
- [ ] Backend sends periodic ping to each active connection (configurable interval, default 30s)
- [ ] Health status tracked per connection (healthy/degraded/error)
- [ ] Frontend receives real-time health updates via Tauri events
- [ ] Visual indicator in UI shows connection status
- [ ] Auto-reconnect attempt on connection loss (with backoff)
- [ ] User notification when connection degrades or fails

## Implementation Notes

### Backend (Rust)
```rust
// src-tauri/src/database/health_monitor.rs
pub struct HealthMonitor {
    interval: Duration,
    max_retries: u32,
    backoff_multiplier: f64,
}

pub struct HealthStatus {
    pub state: ConnectionState,  // Healthy, Degraded, Error
    pub last_ping: Instant,
    pub rtt_ms: Option<u32>,
    pub consecutive_failures: u32,
}

impl HealthMonitor {
    pub async fn start(
        conn_id: String,
        pool: Arc<DatabasePool>,
        app_handle: AppHandle,
    ) -> JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            let mut failures = 0;
            
            loop {
                interval.tick().await;
                
                match ping_connection(&pool).await {
                    Ok(rtt) => {
                        failures = 0;
                        emit_health_event(&app_handle, &conn_id, HealthStatus {
                            state: ConnectionState::Healthy,
                            rtt_ms: Some(rtt),
                            // ...
                        });
                    }
                    Err(e) => {
                        failures += 1;
                        if failures >= 3 {
                            // Attempt reconnection
                            attempt_reconnect(&pool).await;
                        }
                    }
                }
            }
        })
    }
}
```

### Frontend (React/TypeScript)
```typescript
// src/stores/connectionHealthStore.ts
interface ConnectionHealth {
  connectionId: string;
  state: 'healthy' | 'degraded' | 'error';
  lastPing: Date;
  rttMs?: number;
}

export const useConnectionHealthStore = create<HealthStore>((set) => ({
  health: new Map<string, ConnectionHealth>(),
  
  updateHealth: (connectionId: string, status: ConnectionHealth) =>
    set((state) => ({
      health: new Map(state.health).set(connectionId, status)
    })),
}));

// src/hooks/useConnectionHealth.ts
export function useConnectionHealth(connectionId: string) {
  const health = useConnectionHealthStore((s) => s.health.get(connectionId));
  
  useEffect(() => {
    const unlisten = listen('connection-health', (event) => {
      if (event.payload.connectionId === connectionId) {
        updateHealth(connectionId, event.payload);
      }
    });
    
    return () => { unlisten(); };
  }, [connectionId]);
  
  return health;
}
```

## Files to Modify
- `src-tauri/src/database/connection_manager.rs` - Add health monitor integration
- `src-tauri/src/database/mod.rs` - Export health monitor module
- Create `src-tauri/src/database/health_monitor.rs` - New health monitoring module
- `src-tauri/src/commands/database.rs` - Add health subscription command
- Create `src/stores/connectionHealthStore.ts` - Frontend health state
- Create `src/hooks/useConnectionHealth.ts` - React hook for health status
- `src/components/ConnectionStatus.tsx` - Visual health indicator component

## Testing Requirements
1. **Unit Tests**
   - Test ping retry logic with backoff
   - Test state transitions (healthy → degraded → error)
   - Test reconnection attempts

2. **Integration Tests**
   - Simulate network interruption
   - Verify event emission to frontend
   - Test multiple connections simultaneously

3. **Manual Testing**
   - Stop database server while connected
   - Network throttling to simulate high latency
   - Verify UI updates in real-time

## Success Metrics
- Connection issues detected within 60 seconds
- Successful auto-reconnect rate > 80%
- Zero data loss during temporary disconnections
- UI accurately reflects connection state

## Notes
- Consider WebSocket for more efficient real-time updates
- May need rate limiting on reconnection attempts
- Should persist health history for debugging