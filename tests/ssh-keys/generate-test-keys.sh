#!/usr/bin/env bash
#
# Generate test SSH keys for integration tests
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔐 Generating test SSH keys..."

# RSA key (unencrypted) - for key-based auth tests
if [[ ! -f test_rsa_key ]]; then
  ssh-keygen -t rsa -b 4096 -f test_rsa_key -N "" -C "test-rsa@querypilot" >/dev/null 2>&1
  echo "  ✅ Generated test_rsa_key (4096-bit RSA, unencrypted)"
fi

# Ed25519 key (encrypted with passphrase) - for encrypted key tests
if [[ ! -f test_ed25519_key ]]; then
  ssh-keygen -t ed25519 -f test_ed25519_key -N "testpass123" -C "test-ed25519@querypilot" >/dev/null 2>&1
  echo "  ✅ Generated test_ed25519_key (Ed25519, passphrase: testpass123)"
fi

# ECDSA key (unencrypted) - for ECDSA support tests
if [[ ! -f test_ecdsa_key ]]; then
  ssh-keygen -t ecdsa -b 521 -f test_ecdsa_key -N "" -C "test-ecdsa@querypilot" >/dev/null 2>&1
  echo "  ✅ Generated test_ecdsa_key (ECDSA P-521, unencrypted)"
fi

echo ""
echo "✅ All test keys generated successfully"
echo ""
echo "📋 Key Summary:"
echo "  - test_rsa_key:      RSA 4096-bit (unencrypted)"
echo "  - test_ed25519_key:  Ed25519 (encrypted with 'testpass123')"
echo "  - test_ecdsa_key:    ECDSA P-521 (unencrypted)"
echo ""
echo "⚠️  These keys are FOR TESTING ONLY. Never use in production!"
