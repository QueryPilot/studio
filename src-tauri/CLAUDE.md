# Backend (Rust/Tauri) Guidelines

## Tauri Configuration

### Window Management
- Transparent background with overlay titlebar
- Decorations disabled for custom titlebar
- Window state persistence

### Security
- Content Security Policy (CSP) configured
- IPC commands use proper permissions
- Secure storage in app data directory

### Plugins
- SQL Plugin for database operations
- Clipboard Manager for copy/paste
- Opener Plugin for external links

### Build Configuration
- Production builds use release optimizations
- Bundle identifiers: com.devdb.studio
- Code signing for distribution

## Rust Patterns

### Error Handling
- Use `Result<T, E>` for fallible operations
- Custom error types with proper Display impl
- Propagate errors with `?` operator

### IPC Commands
- Async command handlers
- Proper serialization with serde
- Type-safe command definitions

### Database Operations
- Use Tauri SQL plugin
- Connection pooling where appropriate
- Parameterized queries only