# Backend (Rust/Tauri) Guidelines

## Tauri Configuration

### Window Management
- Overlay titlebar style with hidden title
- Decorations enabled (using native controls)
- Default size: 900x650 (minimum)
- Center window on startup
- Window state persistence
- macOS Private API enabled

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
- Bundle identifier: com.hieuvd.devdb-studio
- Code signing for distribution
- Minimum macOS version: 10.15

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