# macOS Code Signing & Notarization Setup Guide

This guide walks you through setting up code signing and notarization for Query Pilot macOS releases.

## Prerequisites

- Active Apple Developer Program membership ($99/year)
- macOS machine with Xcode or Xcode Command Line Tools
- Access to your GitHub repository settings

## Step 1: Generate Developer ID Certificate

### 1.1 Create Certificate Signing Request (CSR)

1. Open **Keychain Access** on your Mac
2. Menu: `Keychain Access` → `Certificate Assistant` → `Request a Certificate From a Certificate Authority`
3. Fill in:
   - **User Email Address**: Your Apple ID email
   - **Common Name**: Your name or company name
   - **Request**: Select "Saved to disk"
4. Click **Continue** and save the `.certSigningRequest` file

### 1.2 Create Developer ID Certificate

1. Visit [Apple Developer Portal](https://developer.apple.com/account/resources/certificates)
2. Click the **+** button to create a new certificate
3. Select **Developer ID Application** (for distribution outside Mac App Store)
4. Upload the `.certSigningRequest` file you created
5. Download the generated certificate (`.cer` file)
6. Double-click the `.cer` file to install it in Keychain Access

### 1.3 Export Certificate as .p12

1. Open **Keychain Access**
2. Find the **Developer ID Application** certificate (should have a private key nested under it)
3. Right-click the certificate → **Export "Developer ID Application: Your Name (TEAM_ID)"**
4. Save as `.p12` file format
5. Create a strong password when prompted
6. **⚠️ IMPORTANT**: Save this password securely - you'll need it for GitHub secrets

## Step 2: Generate App-Specific Password

1. Visit [Apple ID Account](https://appleid.apple.com/)
2. Sign in with your Apple ID
3. Navigate to **Sign-In and Security** → **App-Specific Passwords**
4. Click **+** to generate a new password
5. Label it descriptively (e.g., "Query Pilot Notarization")
6. **⚠️ CRITICAL**: Copy this password immediately - you won't see it again!

## Step 3: Find Your Team ID

1. Visit [Apple Developer Membership](https://developer.apple.com/account/#!/membership/)
2. Find your **Team ID** under membership details
3. It's usually a 10-character alphanumeric string (e.g., `ABC123XYZ9`)

## Step 4: Configure GitHub Secrets

### 4.1 Encode Certificate to Base64

On your Mac, run this command to encode the `.p12` file and copy it to clipboard:

```bash
base64 -i /path/to/your/certificate.p12 | pbcopy
```

### 4.2 Add Secrets to GitHub

1. Go to your repository: `https://github.com/YOUR_USERNAME/devdb-studio`
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add each of these:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` | Output from the `base64` command |
| `APPLE_CERTIFICATE_PASSWORD` | Password | Password you set when exporting `.p12` |
| `APPLE_DEVELOPER_ID` | email@example.com | Your Apple ID email address |
| `APPLE_PASSWORD` | xxxx-xxxx-xxxx-xxxx | App-specific password from Step 2 |
| `APPLE_TEAM_ID` | ABC123XYZ9 | Your Team ID from Step 3 |

**⚠️ Security Notes:**
- Never commit these values to git
- Never share these secrets publicly
- Rotate the app-specific password if compromised

## Step 5: Update Tauri Configuration (Already Done)

The following files have been configured:

### `src-tauri/tauri.conf.json`
```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": null,
      "entitlements": "entitlements.plist",
      "hardenedRuntime": true
    }
  }
}
```

### `src-tauri/entitlements.plist`
Created with required entitlements for database connections and dynamic libraries.

## Step 6: Test the Setup

### Local Testing (Optional)

To test signing locally without CI:

```bash
# Set environment variables
export APPLE_ID="your-apple-id@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABC123XYZ9"

# Build with signing
pnpm tauri build --target universal-apple-darwin
```

### GitHub Actions Testing

1. Enable the release workflow:
   - Edit `.github/workflows/release.yml`
   - Uncomment the `push: tags:` trigger
2. Create a test tag:
   ```bash
   git tag v0.2.0-test
   git push origin v0.2.0-test
   ```
3. Monitor the workflow at: `https://github.com/YOUR_USERNAME/devdb-studio/actions`

## Step 7: Verify Signing & Notarization

After a successful build, verify the app is properly signed:

```bash
# Check code signature
codesign -dvv /path/to/Query\ Pilot.app

# Verify notarization
spctl -a -vv /path/to/Query\ Pilot.app

# Check entitlements
codesign -d --entitlements - /path/to/Query\ Pilot.app
```

Expected output:
- **Code signature**: Should show "Developer ID Application: Your Name (TEAM_ID)"
- **Notarization**: Should show "accepted" and "source=Notarized Developer ID"
- **Entitlements**: Should list the entitlements from `entitlements.plist`

## Troubleshooting

### "errSecInternalComponent" Error
- The certificate wasn't properly imported into the keychain
- Re-run the "Import Apple certificate" step in the workflow

### Notarization Fails
- Check that `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are correct
- Verify the app-specific password hasn't expired
- Check Apple's notarization logs via `xcrun notarytool log`

### "Invalid Signature" on User Machine
- Ensure `hardenedRuntime: true` in `tauri.conf.json`
- Verify all external binaries (sidecars) are signed
- Check entitlements are properly set

### Build Fails with "No Identity Found"
- Ensure the certificate is a "Developer ID Application" type
- Verify `APPLE_CERTIFICATE` secret contains the full base64 string
- Check `APPLE_CERTIFICATE_PASSWORD` matches the .p12 password

## Additional Resources

- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Tauri macOS Bundle Documentation](https://tauri.app/v1/guides/building/macos)
- [Notarization Workflow](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)

## Security Best Practices

1. **Rotate app-specific passwords** annually
2. **Never share** your `.p12` file or its password
3. **Use separate certificates** for development vs. distribution
4. **Enable 2FA** on your Apple ID
5. **Audit GitHub secrets access** regularly

## Support

If you encounter issues:
1. Check GitHub Actions logs for detailed error messages
2. Review Tauri build output for signing errors
3. Consult Apple's notarization logs
4. Open an issue in the repository with redacted logs
