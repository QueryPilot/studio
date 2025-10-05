# Development Guide

## Keychain Permission Issues (macOS) - SOLVED

The app now uses the bundle identifier (`com.hieuvd.devdb-studio`) as the keychain service name, which remains consistent across development rebuilds. This eliminates permission prompts while maintaining mandatory keychain security.

### How It Works

- **Consistent Identity**: Uses the same bundle identifier as the Tauri app configuration
- **No Permission Prompts**: macOS recognizes the app as the same identity across rebuilds
- **Mandatory Security**: Keychain is always used - no fallback options
- **Production Ready**: Same security model in development and production

### Setup

Just run the app normally:

```bash
npm run tauri:dev
```

No special setup or environment variables needed. The first run will create the keychain entry, and subsequent runs will reuse it without prompts.

### Troubleshooting

If you still get permission prompts, clean up old entries:

```bash
# Remove any old conflicting keychain entries
security delete-generic-password -s "DevDB Studio" -a "master_key" 2>/dev/null
security delete-generic-password -s "DevDB Studio Dev" -a "master_key" 2>/dev/null

# The app will create a new entry with the correct service name
```

### Security

- ✅ **Always Uses Keychain**: No bypass options - maximum security
- ✅ **Bundle ID Based**: Uses `com.hieuvd.devdb-studio` for consistent identity
- ✅ **Development Friendly**: No permission prompts during active development
- ✅ **Production Ready**: Same security model across all environments
