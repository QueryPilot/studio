#!/bin/bash

# Generate Tauri Updater Signing Keys
# This script must be run interactively to set a password

set -e

echo "🔐 Tauri Updater Key Generation"
echo "================================"
echo ""
echo "This will generate a public/private keypair for secure app updates."
echo "You'll be prompted to enter a password to protect the private key."
echo ""

# Create .tauri/updater directory if it doesn't exist
mkdir -p .tauri/updater

# Generate keys
echo "Generating keypair..."
pnpm tauri signer generate -w .tauri/updater/query-pilot.key

echo ""
echo "✅ Keys generated successfully!"
echo ""
echo "📝 Next Steps:"
echo ""
echo "1. The PUBLIC key has been printed above (starts with 'dW50cnVzdGVkIGNvbW1lbnQ6...')"
echo "   Copy it and paste into src-tauri/tauri.conf.json under plugins.updater.pubkey"
echo ""
echo "2. Add the PRIVATE key to GitHub Secrets:"
echo "   - Go to: https://github.com/QueryPilot/studio/settings/secrets/actions"
echo "   - Create new secret: TAURI_PRIVATE_KEY"
echo "   - Paste the contents of .tauri/updater/query-pilot.key"
echo ""
echo "3. The private key password should also be stored as a secret:"
echo "   - Create new secret: TAURI_KEY_PASSWORD"
echo "   - Enter the password you just set"
echo ""
echo "⚠️  IMPORTANT: Never commit the .tauri directory to git!"
echo ""
