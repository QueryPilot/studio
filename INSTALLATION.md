# Query Pilot - Installation Instructions

## 📥 Installation

1. **Open the DMG file:**
   - Double-click `Query Pilot_0.1.0_aarch64.dmg`

2. **Drag to Applications:**
   - Drag the Query Pilot icon to your Applications folder

3. **Launch the app:**
   - Go to Applications folder and open Query Pilot

---

## ⚠️ If You See "Query Pilot is damaged and can't be opened"

This is a macOS security message for apps not downloaded from the App Store. Here's how to fix it:

### Quick Fix (Recommended)

Open **Terminal** (Applications → Utilities → Terminal) and paste:

```bash
xattr -cr "/Applications/Query Pilot.app"
```

Press Enter, then try opening Query Pilot again. ✅

### Using the Fix Script (Alternative)

We've included a helper script:

```bash
# Navigate to the downloaded files
cd ~/Downloads

# Run the fix script
bash fix-damaged-app.sh
```

---

## 🖥️ System Requirements

- **macOS:** 10.15 (Catalina) or later
- **Processor:** Apple Silicon (M1/M2/M3)
- **Memory:** 4 GB RAM minimum
- **Disk Space:** 200 MB

**Note:** Intel Mac support coming soon!

---

## 🔐 Why This Happens

Query Pilot is currently in beta and not yet notarized by Apple. This is completely safe - the "damaged" message is just macOS being cautious about apps from outside the App Store.

We're working on Apple notarization to remove this step in future releases.

---

## ✨ First Launch

After installation:

1. **Grant Permissions:** Query Pilot may ask for permissions to access:
   - Keychain (to store database passwords securely)
   - Network (to connect to databases)

2. **AI Assistant Setup (Optional):**
   - Go to Settings → AI Runtime
   - Add your OpenAI, Anthropic, or Google API key
   - AI features will be enabled

3. **Connect Your First Database:**
   - Click "New Connection"
   - Enter your database details
   - Test connection and save

---

## 🆘 Troubleshooting

### "Operation not permitted" when running fix command

You may need to give Terminal permission:
1. System Settings → Privacy & Security → Full Disk Access
2. Add Terminal to the list
3. Try the fix command again

### App won't open at all

Try these in order:

1. **Right-click → Open:**
   ```
   Right-click Query Pilot.app → Open → Open
   ```

2. **Remove quarantine flag:**
   ```bash
   xattr -cr "/Applications/Query Pilot.app"
   ```

3. **Check for corrupted download:**
   - Re-download the DMG
   - Verify file size matches (should be ~56 MB)

### Can't connect to databases

Make sure:
- Your database server is running
- Firewall allows the connection
- Connection details (host, port, user) are correct

---

## 📚 Documentation

- **Full Documentation:** [Link to your docs]
- **GitHub Repository:** [Link to your repo]
- **Report Issues:** [Link to issues page]

---

## 🔄 Updating

When a new version is released:

1. Download the new DMG
2. Drag the new Query Pilot to Applications (replace old version)
3. Run the fix command again if needed

Your database connections and settings are preserved!

---

## 🗑️ Uninstallation

To remove Query Pilot:

1. Quit the app
2. Delete from Applications folder
3. (Optional) Remove settings:
   ```bash
   rm -rf ~/Library/Application\ Support/dev.querypilot.studio
   ```

---

## 💬 Get Help

- **Email:** support@querypilot.dev (replace with your email)
- **Discord:** [Your Discord link]
- **GitHub Issues:** [Your issues link]

---

## 📝 Version Information

**Current Version:** 0.1.0
**Release Date:** November 2025
**Architecture:** Apple Silicon (ARM64)

---

Thank you for trying Query Pilot! 🚀
