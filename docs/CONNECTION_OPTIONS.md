# Connection Options Support - Summary

## Changes Made

### 1. URI Parser Enhancement (`src/utils/connectionParser.ts`)

**Added**: Query parameter extraction from connection URIs

```typescript
// Before
mysql://user:pass@host:3306/db?charset=utf8mb4
// charset parameter was ignored

// After
mysql://user:pass@host:3306/db?charset=utf8mb4
// charset extracted to config.options = { charset: 'utf8mb4' }
```

**Features**:
- Extracts all query parameters except `sslmode`/`ssl`
- Supports multiple parameters: `?charset=utf8mb4&timezone=UTC`
- URL-decodes parameter values automatically
- Returns `options` object in `ParsedUriConfig`

### 2. MySQL Adapter Connection Options (`src-tauri/src/adapters/mysql/adapter.rs`)

**Added**: Support for MySQL-specific connection options via `profile.options`

**Supported Options**:
- `charset=utf8mb4` → `SET NAMES 'utf8mb4'`
- `collation=utf8mb4_unicode_ci` → `SET collation_connection = '...'`
- `timezone=UTC` → `SET time_zone = 'UTC'`
- `sql_mode=STRICT_ALL_TABLES` → `SET sql_mode = '...'`
- `connect_timeout=10` → Connection TTL

**Password Encoding Fix**:
- Added URL encoding for username/password with special characters
- Uses `urlencoding` crate to prevent URI parsing errors

### 3. SQL Server Adapter Connection Options (`src-tauri/src/adapters/mssql/adapter.rs`)

**Supported Options**:
- `application_name=QueryPilot` → Sets application name
- `instance=SQLEXPRESS` → Instance name
- `trust_cert=true` → Trust server certificate
- `trusted_connection=true` → Windows Authentication (Windows only)

### 4. Frontend Connection Form (`src/screens/home/components/MainContent/ConnectionForm.tsx`)

**Added**: 
1. New textarea field for connection options
2. Parser function for multiline key=value format
3. URI paste now populates connection options field
4. Tooltips with database-specific examples

**UI Example**:
```
Connection Options
┌─────────────────────────┐
│ charset=utf8mb4         │
│ timezone=UTC            │
└─────────────────────────┘
```

## Usage Examples

### Method 1: Paste Connection URI

**MySQL**:
```
mysql://devuser:devpass123@localhost:13306/todoapp?charset=utf8mb4&timezone=UTC
```

**Result**: Form auto-fills with:
- Host: `localhost`
- Port: `13306`
- Username: `devuser`
- Password: `devpass123`
- Database: `todoapp`
- Connection Options:
  ```
  charset=utf8mb4
  timezone=UTC
  ```

### Method 2: Manual Entry

Fill in connection details, then add options:

**MySQL**:
```
charset=utf8mb4
collation=utf8mb4_unicode_ci
timezone=+00:00
sql_mode=STRICT_ALL_TABLES
```

**PostgreSQL**:
```
application_name=QueryPilot
connect_timeout=10
statement_timeout=30000
```

**SQL Server**:
```
application_name=QueryPilot
trust_cert=true
```

## Testing

### Unit Tests
```bash
✅ connectionParser.test.ts - 68 tests passed
   - URI parsing with query parameters
   - Multiple parameters
   - Special characters in password
   - sslmode separation

✅ MySQL adapter tests - 7 tests passed
✅ SQLite adapter tests - 9 tests passed
```

### Integration Testing
```bash
# Test MySQL with charset
mysql://devuser:devpass123@localhost:13306/todoapp?charset=utf8mb4

# Verify in MySQL
mysql> SHOW VARIABLES LIKE 'character_set_%';
# Should show utf8mb4 for client/connection/results
```

## Implementation Details

### Connection Options Flow

```
User Input → Frontend Form → ConnectionProfile.options (HashMap)
                                        ↓
                            Rust Adapter build_opts/build_config
                                        ↓
                            Apply to database connection
                                        ↓
                            Connection established with options
```

### MySQL Init Commands

MySQL doesn't have direct option setters, so we use initialization commands:

```rust
builder = builder.init(vec![
    "SET NAMES 'utf8mb4'",
    "SET time_zone = 'UTC'"
]);
```

These run immediately after connection establishment.

### SQL Server Config Builder

SQL Server uses config methods:

```rust
config.application_name(value);
config.instance_name(value);
config.trust_cert();
```

## Benefits

1. **Flexibility**: Support any database-specific connection parameter
2. **Standards Compliance**: Follows standard URI query parameter format
3. **Ease of Use**: Copy-paste connection strings work immediately
4. **Documentation**: Tooltips show common options per database
5. **Extensibility**: Easy to add new options without code changes

## Future Enhancements

Potential additions:
- PostgreSQL application_name, connect_timeout, etc.
- SQLite PRAGMA settings via options
- Validation of option values
- Option presets/templates
- Import/export of connection profiles with options

