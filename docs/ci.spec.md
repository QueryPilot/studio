# CI/CD & Testing Strategy

**Status:** Planning
**Last Updated:** 2025-11-08
**Owner:** Engineering Team

---

## Overview

This document outlines the comprehensive testing and CI/CD strategy for Query Pilot (DevDB Studio). It addresses the challenge of testing a Tauri 2 application where E2E testing via WebDriver is limited to Windows only.

### Goals

1. **High Coverage**: Achieve 70-80% test coverage without full E2E testing
2. **Fast Feedback**: Unit tests complete in <10 minutes
3. **Cross-Platform**: Test on macOS, Linux, Windows in parallel
4. **Reliable**: Minimize flaky tests and maintenance burden
5. **Real Integration**: Test against actual PostgreSQL databases
6. **Security**: Test sensitive features (keychain, vault) with mocks

### Constraints

- **Tauri WebDriver** only supports Windows (not a blocker)
- **OS Keychain** requires platform-specific services (requires mocking)
- **Database Dependencies** require Docker containers
- **Multi-Component** architecture (Rust backend + React frontend + Bun sidecar)

---

## Testing Architecture

### Testing Pyramid

```
           ┌─────────────────┐
           │   E2E Tests     │  10% - Windows only, pre-release
           │  (WebDriver)    │
           └─────────────────┘
          ┌───────────────────┐
          │ Integration Tests │  30% - Database operations
          │  (testcontainers) │
          └───────────────────┘
        ┌─────────────────────────┐
        │      Unit Tests         │  60% - Fast, comprehensive
        │  (Rust + TS + Sidecar)  │
        └─────────────────────────┘
```

### Test Types by Component

| Component | Unit Tests | Integration Tests | E2E Tests |
|-----------|------------|-------------------|-----------|
| **Rust Backend** | ✅ All platforms | ✅ Linux + PostgreSQL | ⚠️ Windows only |
| **React Frontend** | ✅ All platforms | ✅ Mocked Tauri | ⚠️ Windows only |
| **AI Sidecar** | ✅ All platforms | ✅ HTTP endpoints | ⚠️ Windows only |

---

## Tier 1: Unit Tests

**Runtime:** 5-8 minutes | **Platforms:** macOS, Linux, Windows | **Priority:** CRITICAL

### Rust Backend Unit Tests

#### Test Coverage Areas

```rust
// src-tauri/src/core/cell_value.rs
// Test: All CellValue variants, MessagePack serialization
#[cfg(test)]
mod tests {
    use super::*;
    use rmp_serde::{to_vec, from_slice};

    #[test]
    fn test_cell_value_msgpack_roundtrip() {
        let test_cases = vec![
            CellValue::Null,
            CellValue::Boolean(true),
            CellValue::Integer(42),
            CellValue::BigInt(9223372036854775807),
            CellValue::Float(3.14159),
            CellValue::Text("Hello, 世界".to_string()),
            CellValue::Bytes(vec![0x00, 0xFF, 0xAB]),
            CellValue::Json(serde_json::json!({"key": "value"})),
        ];

        for val in test_cases {
            let encoded = to_vec(&val).unwrap();
            let decoded: CellValue = from_slice(&encoded).unwrap();
            assert_eq!(val, decoded, "Failed roundtrip for {:?}", val);
        }
    }

    #[test]
    fn test_cell_value_display() {
        assert_eq!(CellValue::Null.to_string(), "NULL");
        assert_eq!(CellValue::Integer(42).to_string(), "42");
        assert_eq!(CellValue::Text("test".into()).to_string(), "test");
    }
}
```

#### Type Mapping Tests

```rust
// src-tauri/src/adapters/postgres/types.rs
// Test: PostgreSQL type OID -> CellValue conversion
#[cfg(test)]
mod tests {
    use super::*;
    use tokio_postgres::types::Type;

    #[test]
    fn test_postgres_type_mapping() {
        assert_eq!(map_pg_type(&Type::INT4), "integer");
        assert_eq!(map_pg_type(&Type::VARCHAR), "text");
        assert_eq!(map_pg_type(&Type::TIMESTAMPTZ), "timestamp with time zone");
        assert_eq!(map_pg_type(&Type::JSON), "json");
        assert_eq!(map_pg_type(&Type::JSONB), "jsonb");
    }

    #[test]
    fn test_array_type_detection() {
        assert!(is_array_type(&Type::INT4_ARRAY));
        assert!(!is_array_type(&Type::INT4));
    }
}
```

#### Vault Encryption Tests (Mocked Keychain)

```rust
// src-tauri/src/vault.rs
// Test: Encryption/decryption with mocked keychain
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_encryption_decryption() {
        let password = "test_password_123";
        let plaintext = b"sensitive connection data";

        let encrypted = encrypt_vault_data(plaintext, password).unwrap();
        assert_ne!(encrypted, plaintext, "Data should be encrypted");

        let decrypted = decrypt_vault_data(&encrypted, password).unwrap();
        assert_eq!(decrypted, plaintext, "Decryption should restore original");
    }

    #[test]
    fn test_vault_wrong_password() {
        let plaintext = b"sensitive data";
        let encrypted = encrypt_vault_data(plaintext, "correct").unwrap();

        let result = decrypt_vault_data(&encrypted, "wrong");
        assert!(result.is_err(), "Wrong password should fail");
    }
}
```

#### AI Sidecar Lifecycle Tests

```rust
// src-tauri/src/ai/manager.rs
// Test: Sidecar process management with mocking
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_sidecar_port_allocation() {
        let manager = AiManager::new();
        let port1 = manager.allocate_port().await;
        let port2 = manager.allocate_port().await;

        assert_ne!(port1, port2, "Ports should be unique");
        assert!(port1 >= 3000 && port1 <= 65535);
    }

    #[tokio::test]
    async fn test_api_key_storage() {
        let manager = AiManager::new();

        manager.set_api_key("openai", "sk-test123").await.unwrap();
        let key = manager.get_api_key("openai").await.unwrap();

        assert_eq!(key, "sk-test123");
    }
}
```

#### Priority Test Files

| File | Focus | Complexity |
|------|-------|------------|
| `src-tauri/src/core/cell_value.rs` | Serialization, type safety | Medium |
| `src-tauri/src/adapters/postgres/types.rs` | Type mapping | Low |
| `src-tauri/src/adapters/postgres/fast_converter.rs` | Row conversion logic | High |
| `src-tauri/src/vault.rs` | Encryption/decryption | Medium |
| `src-tauri/src/ai/manager.rs` | Process lifecycle | Medium |
| `src-tauri/src/core/manager.rs` | Connection pooling | High |

---

### Frontend Unit Tests (Vitest)

#### Store Testing Pattern

```typescript
// src/stores/__tests__/connectionStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useConnectionStore } from '@/stores/connectionStore';

describe('connectionStore', () => {
  beforeEach(() => {
    // Reset store state
    useConnectionStore.setState({
      profiles: [],
      activeConnections: new Map(),
    });
  });

  it('should add connection profile', () => {
    const store = useConnectionStore.getState();
    const profile = {
      id: 'test-1',
      name: 'Test DB',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
    };

    store.addProfile(profile);

    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0]).toEqual(profile);
  });

  it('should update connection profile', () => {
    const store = useConnectionStore.getState();
    store.addProfile({ id: 'test-1', name: 'Old Name' });

    store.updateProfile('test-1', { name: 'New Name' });

    expect(store.profiles[0].name).toBe('New Name');
  });

  it('should track active connections', () => {
    const store = useConnectionStore.getState();

    store.setConnectionActive('profile-1', true);
    expect(store.isConnected('profile-1')).toBe(true);

    store.setConnectionActive('profile-1', false);
    expect(store.isConnected('profile-1')).toBe(false);
  });

  it('should get profile by id', () => {
    const store = useConnectionStore.getState();
    const profile = { id: 'test-1', name: 'Test' };
    store.addProfile(profile);

    const found = store.getProfileById('test-1');
    expect(found).toEqual(profile);

    const notFound = store.getProfileById('nonexistent');
    expect(notFound).toBeUndefined();
  });
});
```

#### Service Layer Tests (Mocked Tauri)

```typescript
// src/test-utils/mockTauri.ts
import { vi } from 'vitest';

export const mockTauriInvoke = vi.fn();

export const createTauriMocks = () => ({
  'get_databases': vi.fn(() => Promise.resolve(['postgres', 'testdb'])),
  'get_tables': vi.fn(() => Promise.resolve(['users', 'posts'])),
  'stream_query': vi.fn((args) => Promise.resolve({
    success: true,
    data: new Uint8Array([/* MessagePack encoded */]),
  })),
  'execute_sql': vi.fn(() => Promise.resolve({ rowsAffected: 1 })),
});

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: mockTauriInvoke,
}));

// Usage in tests:
beforeEach(() => {
  const mocks = createTauriMocks();
  mockTauriInvoke.mockImplementation((cmd, args) => {
    const handler = mocks[cmd];
    if (!handler) throw new Error(`Mock not found: ${cmd}`);
    return handler(args);
  });
});
```

```typescript
// src/services/__tests__/databaseService.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabases, streamQuery } from '@/services/databaseService';
import { mockTauriInvoke, createTauriMocks } from '@/test-utils/mockTauri';

describe('databaseService', () => {
  beforeEach(() => {
    const mocks = createTauriMocks();
    mockTauriInvoke.mockImplementation((cmd, args) => mocks[cmd]?.(args));
  });

  it('should fetch databases', async () => {
    const databases = await getDatabases('connection-1');

    expect(databases).toEqual(['postgres', 'testdb']);
    expect(mockTauriInvoke).toHaveBeenCalledWith('get_databases', {
      connectionId: 'connection-1',
    });
  });

  it('should handle errors gracefully', async () => {
    mockTauriInvoke.mockRejectedValueOnce(new Error('Connection failed'));

    await expect(getDatabases('bad-id')).rejects.toThrow('Connection failed');
  });

  it('should decode MessagePack responses', async () => {
    const result = await streamQuery('connection-1', 'SELECT 1');

    expect(result.success).toBe(true);
    expect(result.data).toBeInstanceOf(Uint8Array);
  });
});
```

#### Utility Function Tests

```typescript
// src/utils/__tests__/formatters.test.ts
import { describe, it, expect } from 'vitest';
import { formatCellValue, formatBytes, formatDuration } from '@/utils/formatters';
import { CellValue } from '@/types/database';

describe('formatters', () => {
  it('should format null values', () => {
    expect(formatCellValue(null)).toBe('NULL');
  });

  it('should format numbers with locale', () => {
    expect(formatCellValue(1234567)).toBe('1,234,567');
    expect(formatCellValue(3.14159)).toBe('3.14');
  });

  it('should format dates', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    const formatted = formatCellValue(date);
    expect(formatted).toContain('2024-01-15');
  });

  it('should format byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });

  it('should format durations', () => {
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(65000)).toBe('1m 5s');
  });
});
```

#### Priority Test Files

| File | Focus | Complexity |
|------|-------|------------|
| `src/stores/connectionStore.ts` | State management | Medium |
| `src/stores/workbenchStore.ts` | Panel layout | Medium |
| `src/stores/aiStore.ts` | AI configuration | Low |
| `src/services/databaseService.ts` | Tauri integration | High |
| `src/utils/formatters.ts` | Data formatting | Low |
| `src/utils/validators.ts` | Input validation | Medium |

---

### AI Sidecar Tests (Bun)

#### HTTP Endpoint Tests

```typescript
// src-tauri/sidecar-ai/tests/endpoints.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

describe('AI Sidecar Endpoints', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Start test server on random port
    server = await startServer({ port: 0 });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  describe('GET /health', () => {
    it('should return 200 OK', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
    });
  });

  describe('POST /config', () => {
    it('should accept API keys', async () => {
      const res = await fetch(`${baseUrl}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKeys: {
            openai: 'sk-test123',
            anthropic: 'sk-ant-test456',
          },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.configured).toEqual(['openai', 'anthropic']);
    });

    it('should validate API key format', async () => {
      const res = await fetch(`${baseUrl}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKeys: { openai: '' }, // Empty key
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /providers', () => {
    it('should list available providers', async () => {
      const res = await fetch(`${baseUrl}/providers`);
      const data = await res.json();

      expect(data.providers).toContain('openai');
      expect(data.providers).toContain('anthropic');
      expect(data.providers).toContain('google');
      expect(data.providers).toContain('ollama');
    });
  });

  describe('POST /chat', () => {
    it('should stream chat responses', async () => {
      // Configure mock provider first
      await fetch(`${baseUrl}/config`, {
        method: 'POST',
        body: JSON.stringify({ apiKeys: { openai: 'mock-key' } }),
      });

      const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let chunks: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toContain('data:');
    });
  });
});
```

#### Provider Configuration Tests

```typescript
// src-tauri/sidecar-ai/tests/providers.test.ts
import { describe, it, expect } from 'bun:test';
import { configureProvider, getProvider } from '../src/providers';

describe('Provider Configuration', () => {
  it('should configure OpenAI provider', () => {
    configureProvider('openai', { apiKey: 'sk-test' });
    const provider = getProvider('openai');

    expect(provider).toBeDefined();
    expect(provider.name).toBe('openai');
  });

  it('should configure Anthropic provider', () => {
    configureProvider('anthropic', { apiKey: 'sk-ant-test' });
    const provider = getProvider('anthropic');

    expect(provider).toBeDefined();
    expect(provider.name).toBe('anthropic');
  });

  it('should throw for invalid provider', () => {
    expect(() => getProvider('invalid')).toThrow();
  });

  it('should update existing provider config', () => {
    configureProvider('openai', { apiKey: 'old-key' });
    configureProvider('openai', { apiKey: 'new-key' });

    const provider = getProvider('openai');
    expect(provider.apiKey).toBe('new-key');
  });
});
```

---

## Tier 2: Integration Tests

**Runtime:** 10-15 minutes | **Platform:** Linux only | **Priority:** HIGH

### Rust Integration Tests with testcontainers

#### Setup testcontainers-rs

```toml
# src-tauri/Cargo.toml
[dev-dependencies]
testcontainers = "0.15"
testcontainers-postgres = "0.15"
tokio-test = "0.4"
```

#### Database Integration Test Example

```rust
// src-tauri/tests/integration/postgres_adapter.rs
use testcontainers::*;
use testcontainers_postgres::Postgres;
use devdb_studio::adapters::postgres::PostgresAdapter;
use devdb_studio::core::adapter::DbAdapter;

#[tokio::test]
async fn test_query_execution_with_real_db() {
    // Start PostgreSQL container
    let docker = clients::Cli::default();
    let postgres = Postgres::default();
    let node = docker.run(postgres);

    // Get connection details
    let host = "localhost";
    let port = node.get_host_port_ipv4(5432);
    let connection_string = format!(
        "postgresql://postgres:postgres@{}:{}/postgres",
        host, port
    );

    // Connect via adapter
    let adapter = PostgresAdapter::connect(&connection_string).await.unwrap();

    // Create test table
    adapter.execute(
        "CREATE TABLE users (id SERIAL PRIMARY KEY, name VARCHAR(100))"
    ).await.unwrap();

    // Insert test data
    adapter.execute(
        "INSERT INTO users (name) VALUES ('Alice'), ('Bob')"
    ).await.unwrap();

    // Query and verify
    let result = adapter.query("SELECT * FROM users ORDER BY id").await.unwrap();

    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.columns[0].name, "id");
    assert_eq!(result.columns[1].name, "name");

    // Verify CellValue conversion
    assert_eq!(result.rows[0].get("id"), &CellValue::Integer(1));
    assert_eq!(result.rows[0].get("name"), &CellValue::Text("Alice".into()));
}

#[tokio::test]
async fn test_connection_pooling() {
    let docker = clients::Cli::default();
    let postgres = Postgres::default();
    let node = docker.run(postgres);
    let connection_string = format!(/* ... */);

    let adapter = PostgresAdapter::connect(&connection_string).await.unwrap();

    // Execute multiple queries in parallel
    let queries = (0..20).map(|i| {
        let adapter = adapter.clone();
        tokio::spawn(async move {
            adapter.query(&format!("SELECT {} as num", i)).await
        })
    });

    let results = futures::future::join_all(queries).await;

    // All queries should succeed (pool handles concurrency)
    for result in results {
        assert!(result.unwrap().is_ok());
    }
}

#[tokio::test]
async fn test_transaction_rollback() {
    let docker = clients::Cli::default();
    let postgres = Postgres::default();
    let node = docker.run(postgres);
    let connection_string = format!(/* ... */);

    let adapter = PostgresAdapter::connect(&connection_string).await.unwrap();

    adapter.execute("CREATE TABLE test (id INT)").await.unwrap();

    // Start transaction
    adapter.execute("BEGIN").await.unwrap();
    adapter.execute("INSERT INTO test VALUES (1)").await.unwrap();
    adapter.execute("ROLLBACK").await.unwrap();

    // Verify rollback
    let result = adapter.query("SELECT * FROM test").await.unwrap();
    assert_eq!(result.rows.len(), 0);
}

#[tokio::test]
async fn test_introspection_queries() {
    let docker = clients::Cli::default();
    let postgres = Postgres::default();
    let node = docker.run(postgres);
    let connection_string = format!(/* ... */);

    let adapter = PostgresAdapter::connect(&connection_string).await.unwrap();

    // Test schema introspection
    let schemas = adapter.get_schemas("postgres").await.unwrap();
    assert!(schemas.contains(&"public".to_string()));

    // Create test objects
    adapter.execute(
        "CREATE TABLE test_table (id SERIAL PRIMARY KEY, data TEXT)"
    ).await.unwrap();

    // Test table introspection
    let tables = adapter.get_tables("postgres", "public").await.unwrap();
    assert!(tables.iter().any(|t| t.name == "test_table"));

    // Test column introspection
    let columns = adapter.get_table_columns("postgres", "public", "test_table")
        .await.unwrap();

    assert_eq!(columns.len(), 2);
    assert_eq!(columns[0].name, "id");
    assert_eq!(columns[0].data_type, "integer");
}
```

#### Tauri Command Integration Tests

```rust
// src-tauri/tests/integration/commands.rs
use tauri::test::MockRuntime;
use devdb_studio::commands::*;

#[tokio::test]
async fn test_stream_query_command() {
    let docker = clients::Cli::default();
    let postgres = Postgres::default();
    let node = docker.run(postgres);

    // Setup test app state
    let app = tauri::test::mock_app();
    let state = app.state::<AppState>();

    // Connect to test database
    let connection_id = connect_to_database(
        state,
        ConnectionProfile {
            id: "test".into(),
            host: "localhost".into(),
            port: node.get_host_port_ipv4(5432),
            database: "postgres".into(),
            // ...
        }
    ).await.unwrap();

    // Execute query command
    let result = stream_query(
        state,
        connection_id.clone(),
        "SELECT 1 as num".into(),
    ).await.unwrap();

    // Verify MessagePack response
    let decoded: QueryResult = rmp_serde::from_slice(&result.data).unwrap();
    assert_eq!(decoded.rows.len(), 1);
}
```

---

### Frontend Integration Tests

#### Component + Store Integration

```typescript
// src/components/__tests__/TableStructure.integration.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TableStructure } from '@/components/TableStructure';
import { useConnectionStore } from '@/stores/connectionStore';
import { mockTauriInvoke } from '@/test-utils/mockTauri';

describe('TableStructure Integration', () => {
  beforeEach(() => {
    // Setup store with test connection
    useConnectionStore.setState({
      activeConnections: new Map([['conn-1', { connected: true }]]),
    });

    // Mock Tauri responses
    mockTauriInvoke.mockImplementation((cmd) => {
      if (cmd === 'get_table_columns') {
        return Promise.resolve([
          { name: 'id', data_type: 'integer', is_nullable: false },
          { name: 'email', data_type: 'varchar', is_nullable: false },
          { name: 'created_at', data_type: 'timestamp', is_nullable: true },
        ]);
      }
      return Promise.reject('Unknown command');
    });
  });

  it('should load and display table columns', async () => {
    render(
      <TableStructure
        connectionId="conn-1"
        database="testdb"
        schema="public"
        tableName="users"
      />
    );

    // Loading state
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Wait for data
    await waitFor(() => {
      expect(screen.getByText('id')).toBeInTheDocument();
      expect(screen.getByText('email')).toBeInTheDocument();
      expect(screen.getByText('created_at')).toBeInTheDocument();
    });

    // Verify types displayed
    expect(screen.getByText('integer')).toBeInTheDocument();
    expect(screen.getByText('varchar')).toBeInTheDocument();
  });

  it('should handle errors gracefully', async () => {
    mockTauriInvoke.mockRejectedValueOnce(new Error('Table not found'));

    render(<TableStructure tableName="nonexistent" />);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
      expect(screen.getByText(/table not found/i)).toBeInTheDocument();
    });
  });
});
```

#### Workbench Panel Integration

```typescript
// src/components/__tests__/Workbench.integration.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workbench } from '@/components/Workbench';
import { useWorkbenchStore } from '@/stores/workbenchStore';

describe('Workbench Integration', () => {
  it('should persist panel layout to store', async () => {
    const user = userEvent.setup();

    render(<Workbench />);

    // Open a panel
    const queryButton = screen.getByRole('button', { name: /query/i });
    await user.click(queryButton);

    // Verify store updated
    const state = useWorkbenchStore.getState();
    expect(state.panels).toContainEqual(
      expect.objectContaining({ type: 'query' })
    );
  });

  it('should restore panel layout from store', () => {
    // Pre-populate store
    useWorkbenchStore.setState({
      panels: [
        { id: '1', type: 'query', title: 'Query 1' },
        { id: '2', type: 'table-data', title: 'Users' },
      ],
    });

    render(<Workbench />);

    expect(screen.getByText('Query 1')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
  });
});
```

---

## Tier 3: E2E Tests (Optional)

**Runtime:** 20-30 minutes | **Platform:** Windows only | **Priority:** LOW

### Tauri WebDriver Setup

```toml
# src-tauri/Cargo.toml
[dev-dependencies]
tauri-driver = "2.0"
```

```javascript
// tests/e2e/setup.js
const { spawn } = require('child_process');
const { Builder } = require('selenium-webdriver');

async function setupE2E() {
  // Start Tauri driver
  const driver = spawn('tauri-driver', ['--port', '4444']);

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Create WebDriver client
  const webdriver = await new Builder()
    .forBrowser('wry')
    .usingServer('http://localhost:4444/')
    .build();

  return { driver, webdriver };
}

module.exports = { setupE2E };
```

```javascript
// tests/e2e/connection.test.js
const { setupE2E } = require('./setup');
const { By, until } = require('selenium-webdriver');

describe('Connection Flow E2E', () => {
  let driver, webdriver;

  beforeAll(async () => {
    ({ driver, webdriver } = await setupE2E());
  });

  afterAll(async () => {
    await webdriver.quit();
    driver.kill();
  });

  it('should create new connection profile', async () => {
    // Click new connection button
    const newButton = await webdriver.wait(
      until.elementLocated(By.css('[data-testid="new-connection"]')),
      5000
    );
    await newButton.click();

    // Fill connection form
    await webdriver.findElement(By.id('name')).sendKeys('Test DB');
    await webdriver.findElement(By.id('host')).sendKeys('localhost');
    await webdriver.findElement(By.id('port')).sendKeys('5432');

    // Save
    await webdriver.findElement(By.css('[data-testid="save"]')).click();

    // Verify in list
    const connectionItem = await webdriver.wait(
      until.elementLocated(By.xpath('//div[contains(text(), "Test DB")]')),
      5000
    );
    expect(await connectionItem.getText()).toBe('Test DB');
  });
});
```

**Note:** E2E tests are only recommended for pre-release validation due to Windows-only limitation.

---

## GitHub Actions Workflows

### Workflow 1: Unit Tests (`unit-tests.yml`)

```yaml
name: Unit Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: Unit Tests (${{ matrix.os }})
    runs-on: ${{ matrix.os }}

    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      # Rust setup with caching
      - name: Setup Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - name: Cache Rust dependencies
        uses: actions/cache@v3
        with:
          path: |
            ~/.cargo/bin/
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            src-tauri/target/
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-

      # Node/pnpm setup with caching
      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install frontend dependencies
        run: pnpm install

      # Bun setup for sidecar
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install sidecar dependencies
        working-directory: src-tauri/sidecar-ai
        run: bun install

      # Run tests
      - name: Run Rust unit tests
        working-directory: src-tauri
        run: cargo test --lib --bins -- --nocapture

      - name: Run Rust doc tests
        working-directory: src-tauri
        run: cargo test --doc

      - name: Run frontend unit tests
        run: pnpm test:unit

      - name: Run sidecar tests
        working-directory: src-tauri/sidecar-ai
        run: bun test

      # Linting (only on Linux to save time)
      - name: Run Rust clippy
        if: matrix.os == 'ubuntu-latest'
        working-directory: src-tauri
        run: cargo clippy -- -D warnings

      - name: Run frontend linter
        if: matrix.os == 'ubuntu-latest'
        run: pnpm lint

      - name: TypeScript type check
        if: matrix.os == 'ubuntu-latest'
        run: pnpm typecheck
```

---

### Workflow 2: Integration Tests (`integration-tests.yml`)

```yaml
name: Integration Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  integration:
    name: Integration Tests
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: testdb
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Rust toolchain
        uses: dtolnay/rust-toolchain@stable

      - name: Cache Rust dependencies
        uses: actions/cache@v3
        with:
          path: |
            ~/.cargo/bin/
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            src-tauri/target/
          key: ubuntu-cargo-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: ubuntu-cargo-

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Wait for PostgreSQL
        run: |
          until pg_isready -h localhost -p 5432 -U postgres; do
            echo "Waiting for PostgreSQL..."
            sleep 2
          done

      - name: Seed test database
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/testdb
        run: |
          psql $DATABASE_URL -f tests/fixtures/seed.sql

      - name: Run Rust integration tests
        working-directory: src-tauri
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/testdb
        run: cargo test --test '*' -- --nocapture

      - name: Run frontend integration tests
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/testdb
        run: pnpm test:integration

      # Upload coverage (optional)
      - name: Generate coverage report
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        working-directory: src-tauri
        run: |
          cargo install cargo-tarpaulin
          cargo tarpaulin --out Xml --output-dir coverage

      - name: Upload coverage to Codecov
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: codecov/codecov-action@v3
        with:
          files: src-tauri/coverage/cobertura.xml
          flags: integration
```

---

### Workflow 3: Build Verification (`build.yml`)

```yaml
name: Build Verification

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  release:
    types: [created]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Build (${{ matrix.platform }})
    runs-on: ${{ matrix.os }}

    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            platform: linux
            target: x86_64-unknown-linux-gnu
          - os: macos-latest
            platform: macos
            target: aarch64-apple-darwin
          - os: windows-latest
            platform: windows
            target: x86_64-pc-windows-msvc

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install Linux dependencies
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev \
            build-essential \
            curl \
            wget \
            file \
            libxdo-dev \
            libssl-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev

      - name: Cache dependencies
        uses: actions/cache@v3
        with:
          path: |
            ~/.cargo
            src-tauri/target
            ~/.pnpm-store
          key: ${{ runner.os }}-build-${{ hashFiles('**/Cargo.lock', '**/pnpm-lock.yaml') }}

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: pnpm install

      - name: Build AI sidecar
        working-directory: src-tauri/sidecar-ai
        run: pnpm build:sidecar

      - name: Build Tauri app
        run: pnpm tauri:build

      - name: Upload artifacts
        if: github.event_name == 'release'
        uses: actions/upload-artifact@v3
        with:
          name: app-${{ matrix.platform }}
          path: |
            src-tauri/target/release/bundle/**/*
            !src-tauri/target/release/bundle/**/debug
```

---

### Workflow 4: E2E Tests - Windows Only (`e2e-windows.yml`)

```yaml
name: E2E Tests (Windows)

on:
  workflow_dispatch: # Manual trigger only
  schedule:
    - cron: '0 0 * * 0' # Weekly on Sunday

jobs:
  e2e:
    name: E2E Tests
    runs-on: windows-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: pnpm install

      - name: Build application
        run: pnpm tauri:build

      - name: Install Tauri Driver
        run: cargo install tauri-driver

      - name: Run E2E tests
        run: pnpm test:e2e

      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-test-results
          path: tests/e2e/screenshots/
```

---

## Mock Strategies

### 1. Keychain Mocking (Rust)

```rust
// src-tauri/src/keychain.rs
#[cfg_attr(test, automock)]
pub trait KeychainProvider: Send + Sync {
    fn get(&self, service: &str, key: &str) -> Result<String, KeychainError>;
    fn set(&self, service: &str, key: &str, value: &str) -> Result<(), KeychainError>;
    fn delete(&self, service: &str, key: &str) -> Result<(), KeychainError>;
}

#[cfg(not(test))]
pub struct OsKeychain;

#[cfg(not(test))]
impl KeychainProvider for OsKeychain {
    fn get(&self, service: &str, key: &str) -> Result<String, KeychainError> {
        keyring::Entry::new(service, key)?.get_password()
    }

    fn set(&self, service: &str, key: &str, value: &str) -> Result<(), KeychainError> {
        keyring::Entry::new(service, key)?.set_password(value)
    }

    fn delete(&self, service: &str, key: &str) -> Result<(), KeychainError> {
        keyring::Entry::new(service, key)?.delete_password()
    }
}

// Usage in tests
#[cfg(test)]
mod tests {
    use super::*;
    use mockall::predicate::*;

    #[test]
    fn test_vault_unlock_with_mock_keychain() {
        let mut mock_keychain = MockKeychainProvider::new();

        mock_keychain
            .expect_get()
            .with(eq("devdb-studio"), eq("vault_password"))
            .times(1)
            .returning(|_, _| Ok("test_password".to_string()));

        let vault = Vault::new(Box::new(mock_keychain));
        let result = vault.unlock().unwrap();

        assert!(result);
    }
}
```

### 2. Tauri IPC Mocking (TypeScript)

```typescript
// src/test-utils/mockTauri.ts
import { vi } from 'vitest';
import type { InvokeArgs } from '@tauri-apps/api/tauri';

export const createMockTauri = () => {
  const mocks = {
    get_databases: vi.fn(() => Promise.resolve(['postgres', 'testdb'])),
    get_schemas: vi.fn(() => Promise.resolve(['public', 'private'])),
    get_tables: vi.fn(() => Promise.resolve([
      { name: 'users', type: 'table', rows: 100 },
      { name: 'posts', type: 'table', rows: 500 },
    ])),
    get_table_columns: vi.fn(() => Promise.resolve([
      { name: 'id', data_type: 'integer', is_nullable: false },
      { name: 'name', data_type: 'varchar', is_nullable: false },
    ])),
    stream_query: vi.fn(() => Promise.resolve({
      success: true,
      data: new Uint8Array([/* MessagePack */]),
    })),
    execute_sql: vi.fn(() => Promise.resolve({ rowsAffected: 1 })),
  };

  const invoke = vi.fn(<T = unknown>(cmd: string, args?: InvokeArgs): Promise<T> => {
    const handler = mocks[cmd];
    if (!handler) {
      return Promise.reject(new Error(`Mock not found for command: ${cmd}`));
    }
    return handler(args);
  });

  return { invoke, mocks };
};

// Auto-mock for all tests
vi.mock('@tauri-apps/api/tauri', () => {
  const { invoke } = createMockTauri();
  return { invoke };
});

// Manual setup for specific tests
export const setupTauriMocks = (overrides?: Partial<typeof mocks>) => {
  const { invoke, mocks } = createMockTauri();

  if (overrides) {
    Object.assign(mocks, overrides);
  }

  return { invoke, mocks };
};
```

### 3. AI Sidecar HTTP Mocking (MSW)

```typescript
// src/test-utils/mockAiSidecar.ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const createMockAiServer = () => {
  const handlers = [
    http.get('http://localhost:*/health', () => {
      return HttpResponse.json({ status: 'ok' });
    }),

    http.post('http://localhost:*/config', async ({ request }) => {
      const body = await request.json();
      return HttpResponse.json({
        configured: Object.keys(body.apiKeys || {}),
      });
    }),

    http.get('http://localhost:*/providers', () => {
      return HttpResponse.json({
        providers: ['openai', 'anthropic', 'google', 'ollama'],
      });
    }),

    http.post('http://localhost:*/chat', () => {
      const stream = new ReadableStream({
        start(controller) {
          // Simulate SSE streaming
          controller.enqueue(
            new TextEncoder().encode('data: {"type":"token","content":"Hello"}\n\n')
          );
          controller.enqueue(
            new TextEncoder().encode('data: {"type":"token","content":" World"}\n\n')
          );
          controller.enqueue(
            new TextEncoder().encode('data: {"type":"done"}\n\n')
          );
          controller.close();
        },
      });

      return new HttpResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }),
  ];

  return setupServer(...handlers);
};

// Usage in tests
import { beforeAll, afterAll, afterEach } from 'vitest';

const server = createMockAiServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### 4. Database Adapter Mocking

```rust
// src-tauri/src/core/adapter.rs
#[cfg_attr(test, automock)]
#[async_trait]
pub trait DbAdapter: Send + Sync {
    async fn query(&self, sql: &str) -> Result<QueryResult>;
    async fn execute(&self, sql: &str) -> Result<ExecuteResult>;
    async fn get_databases(&self) -> Result<Vec<String>>;
    async fn get_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>>;
    // ... more methods
}

// Usage in command tests
#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn test_stream_query_command() {
        let mut mock_adapter = MockDbAdapter::new();

        mock_adapter
            .expect_query()
            .with(eq("SELECT 1"))
            .times(1)
            .returning(|_| Ok(QueryResult {
                columns: vec![Column { name: "?column?".into(), data_type: "integer".into() }],
                rows: vec![Row { cells: vec![CellValue::Integer(1)] }],
            }));

        let state = AppState {
            connection_manager: Arc::new(Mutex::new(
                ConnectionManager::new_with_adapter(mock_adapter)
            )),
        };

        let result = stream_query(state, "conn-1".into(), "SELECT 1".into())
            .await
            .unwrap();

        assert!(result.success);
    }
}
```

---

## Phased Implementation

### Phase 1: Foundation (1-2 weeks)

**Goal:** Establish fast, reliable unit tests on all platforms

#### Week 1
- [ ] Create `.github/workflows/unit-tests.yml`
- [ ] Setup Rust/Node/Bun caching configuration
- [ ] Add Rust unit tests:
  - [ ] `cell_value.rs` - Serialization tests
  - [ ] `types.rs` - Type mapping tests
  - [ ] Utility modules
- [ ] Add Frontend unit tests:
  - [ ] `connectionStore.ts`
  - [ ] `formatters.ts`
  - [ ] `validators.ts`
- [ ] Configure Vitest with proper mocking setup

#### Week 2
- [ ] Add Sidecar unit tests:
  - [ ] Endpoint handlers
  - [ ] Provider configuration
- [ ] Create mock utilities:
  - [ ] `mockTauri.ts`
  - [ ] `MockKeychainProvider` trait
- [ ] Add test commands to Makefile
- [ ] Setup PR checks (require tests to pass)

**Success Criteria:**
- ✅ CI runs in <10 minutes
- ✅ 30-40% code coverage
- ✅ All tests pass on macOS, Linux, Windows
- ✅ No flaky tests

---

### Phase 2: Integration (2-3 weeks)

**Goal:** Add real database testing with testcontainers

#### Week 3
- [ ] Add `testcontainers-rs` to dependencies
- [ ] Create PostgreSQL integration test suite:
  - [ ] Connection pooling
  - [ ] Query execution
  - [ ] Transaction handling
  - [ ] Introspection queries
- [ ] Create `.github/workflows/integration-tests.yml`
- [ ] Setup PostgreSQL service in GitHub Actions

#### Week 4
- [ ] Add Tauri command integration tests
- [ ] Add Frontend integration tests:
  - [ ] Component + Store integration
  - [ ] Service layer tests
- [ ] Add AI sidecar HTTP endpoint tests
- [ ] Setup MSW for HTTP mocking

#### Week 5
- [ ] Create test fixtures and seed data
- [ ] Add test database migrations
- [ ] Document integration test patterns
- [ ] Optimize test execution time

**Success Criteria:**
- ✅ Integration tests run in <15 minutes
- ✅ 50-60% code coverage
- ✅ Real PostgreSQL database tested
- ✅ All Tauri commands tested
- ✅ HTTP endpoints tested

---

### Phase 3: Advanced (Optional, 1-2 weeks)

**Goal:** Pre-release validation and quality metrics

#### Week 6
- [ ] Create Windows E2E workflow (manual trigger)
- [ ] Add Tauri WebDriver tests:
  - [ ] Connection flow
  - [ ] Query execution
  - [ ] Table browsing
- [ ] Setup code coverage reporting (codecov.io)
- [ ] Add coverage badges to README

#### Week 7 (Optional)
- [ ] Add performance benchmarks
- [ ] Setup mutation testing (cargo-mutants)
- [ ] Add security scanning (cargo-audit)
- [ ] Create nightly build workflow

**Success Criteria:**
- ✅ E2E tests available for Windows
- ✅ Code coverage tracked over time
- ✅ Performance regressions detected
- ✅ Security vulnerabilities caught early

---

## Makefile Integration

```makefile
# Testing commands
.PHONY: test test-unit test-integration test-frontend test-backend test-sidecar test-all test-ci

# Run all unit tests (fast)
test-unit:
	@echo "Running Rust unit tests..."
	cd src-tauri && cargo test --lib --bins
	@echo "Running frontend unit tests..."
	pnpm test:unit
	@echo "Running sidecar tests..."
	cd src-tauri/sidecar-ai && bun test

# Run integration tests (requires Docker)
test-integration:
	@echo "Starting PostgreSQL container..."
	docker-compose up -d postgres
	@echo "Waiting for PostgreSQL..."
	sleep 5
	@echo "Running Rust integration tests..."
	cd src-tauri && cargo test --test '*'
	@echo "Running frontend integration tests..."
	pnpm test:integration
	@echo "Stopping containers..."
	docker-compose down

# Run frontend tests only
test-frontend:
	pnpm test

# Run backend tests only
test-backend:
	cd src-tauri && cargo test

# Run sidecar tests only
test-sidecar:
	cd src-tauri/sidecar-ai && bun test

# Run all tests
test-all: test-unit test-integration

# CI-optimized test command
test-ci:
	cd src-tauri && cargo test --lib --bins -- --nocapture --test-threads=1
	pnpm test:ci

# Quick smoke test
test-quick:
	@echo "Running quick smoke tests..."
	cd src-tauri && cargo test --lib cell_value
	pnpm test:unit formatters

# Test with coverage
test-coverage:
	cd src-tauri && cargo tarpaulin --out Html --output-dir coverage
	pnpm test:coverage

# Watch mode for development
test-watch:
	pnpm test:watch

# Aliases
t: test-unit
ti: test-integration
```

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run --config vitest.config.unit.ts",
    "test:integration": "vitest run --config vitest.config.integration.ts",
    "test:watch": "vitest watch",
    "test:ci": "vitest run --reporter=verbose --coverage",
    "test:e2e": "playwright test"
  }
}
```

---

## Test Coverage Targets

### By Component

| Component | Phase 1 | Phase 2 | Phase 3 |
|-----------|---------|---------|---------|
| **Rust Backend** | 30% | 60% | 75% |
| **React Frontend** | 25% | 50% | 70% |
| **AI Sidecar** | 40% | 60% | 75% |
| **Overall** | 30% | 55% | 73% |

### By Test Type

| Type | Lines | Files | Priority |
|------|-------|-------|----------|
| **Unit Tests** | 60% | All modules | CRITICAL |
| **Integration Tests** | 30% | Commands, adapters | HIGH |
| **E2E Tests** | 10% | Critical flows | LOW |

---

## Success Metrics

### CI/CD Performance

- **Unit Test Runtime:** <10 minutes (target: 5-8 minutes)
- **Integration Test Runtime:** <15 minutes (target: 10-12 minutes)
- **Build Time:** <20 minutes per platform
- **Total PR Check Time:** <25 minutes

### Quality Metrics

- **Test Success Rate:** >99% (minimize flakiness)
- **Code Coverage:** >70% overall
- **Mutation Score:** >60% (if mutation testing added)
- **Security Vulnerabilities:** 0 high/critical

### Developer Experience

- **Time to First Failure:** <5 minutes (fail fast)
- **Test Feedback Clarity:** Clear error messages
- **Local Test Speed:** <30 seconds for unit tests
- **CI Cache Hit Rate:** >80%

---

## Trade-offs & Decisions

### ✅ DECISION: Focus on Unit + Integration Tests

**Rationale:**
- 80% of bugs caught without E2E complexity
- Fast feedback loop (<10 min)
- Cross-platform support without WebDriver
- Lower maintenance burden
- Real database testing via testcontainers

### ⚠️ DECISION: Windows-only E2E (Manual Trigger)

**Rationale:**
- Tauri WebDriver Windows-only limitation
- E2E tests are slow and fragile
- Better value from comprehensive integration tests
- Manual pre-release validation sufficient

### ✅ DECISION: testcontainers-rs for Database Testing

**Rationale:**
- Real PostgreSQL instances in tests
- Isolated test environments
- Parallel test execution
- Better than mocking database behavior

### ✅ DECISION: Mock OS Keychain

**Rationale:**
- OS keychain requires platform-specific services
- Trait-based mocking provides flexibility
- Tests remain fast and portable
- Core encryption logic still tested

### ✅ DECISION: Separate Unit/Integration Workflows

**Rationale:**
- Unit tests run on all platforms (parallel)
- Integration tests run on Linux only (Docker support)
- Faster feedback for most common issues
- Efficient resource usage

---

## Alternative Approaches Considered

### ❌ Playwright for Full E2E

**Rejected because:**
- Cannot access Tauri native APIs
- Would require extensive mocking (negates E2E value)
- Better to test frontend in isolation with mocked Tauri

### ❌ Cross-platform E2E with Selenium

**Rejected because:**
- Tauri WebDriver doesn't support macOS/Linux yet
- Selenium can't interact with native Tauri windows
- Too complex for limited benefit

### ❌ Manual Testing Only

**Rejected because:**
- No regression detection
- Slow feedback loop
- Not scalable
- Risky for critical features (vault encryption, query execution)

### ✅ Contract Testing (Future Consideration)

**Worth exploring:**
- Test Frontend ↔ Rust interface contracts
- Test Rust ↔ Sidecar HTTP contracts
- Tools: Pact, Spring Cloud Contract
- Would complement integration tests

---

## Resources & References

### Documentation
- [Tauri Testing Guide](https://tauri.app/v1/guides/testing/)
- [testcontainers-rs](https://github.com/testcontainers/testcontainers-rs)
- [Vitest](https://vitest.dev/)
- [MSW (Mock Service Worker)](https://mswjs.io/)
- [GitHub Actions](https://docs.github.com/en/actions)

### Tools
- **Rust:** cargo test, cargo-tarpaulin, cargo-mutants
- **Frontend:** Vitest, Testing Library, MSW
- **Sidecar:** Bun test
- **CI:** GitHub Actions
- **Coverage:** Codecov, Coveralls

### Example Repositories
- [Tauri Examples](https://github.com/tauri-apps/tauri/tree/dev/examples)
- [testcontainers-rs Examples](https://github.com/testcontainers/testcontainers-rs/tree/main/testcontainers/tests)

---

## Next Steps

1. **Review and approve** this specification
2. **Choose implementation phase** (recommended: start with Phase 1)
3. **Assign tasks** to team members
4. **Create tracking issues** in GitHub
5. **Begin implementation** with unit tests
6. **Iterate and improve** based on learnings

---

## Appendix: Test File Organization

```
devdb-studio/
├── src-tauri/
│   ├── src/
│   │   ├── core/
│   │   │   ├── cell_value.rs
│   │   │   └── cell_value.test.rs         # Unit tests
│   │   ├── adapters/
│   │   │   └── postgres/
│   │   │       ├── adapter.rs
│   │   │       └── adapter.test.rs        # Unit tests
│   ├── tests/
│   │   ├── integration/
│   │   │   ├── postgres_adapter.rs        # Integration tests
│   │   │   ├── commands.rs
│   │   │   └── connection_pool.rs
│   │   └── fixtures/
│   │       └── seed.sql
├── src/
│   ├── stores/
│   │   ├── connectionStore.ts
│   │   └── __tests__/
│   │       └── connectionStore.test.ts    # Unit tests
│   ├── services/
│   │   ├── databaseService.ts
│   │   └── __tests__/
│   │       └── databaseService.test.ts
│   ├── components/
│   │   ├── TableStructure.tsx
│   │   └── __tests__/
│   │       ├── TableStructure.unit.test.tsx
│   │       └── TableStructure.integration.test.tsx
│   └── test-utils/
│       ├── mockTauri.ts
│       ├── mockAiSidecar.ts
│       └── testHelpers.ts
├── src-tauri/sidecar-ai/
│   ├── src/
│   │   └── index.ts
│   └── tests/
│       ├── endpoints.test.ts              # Unit tests
│       └── providers.test.ts
└── tests/
    └── e2e/                               # E2E tests (optional)
        ├── setup.js
        ├── connection.test.js
        └── query.test.js
```

---

**Document Version:** 1.0
**Last Review:** 2025-11-08
**Next Review:** After Phase 1 completion
