# Query Pilot - Distribution Guide

## 🚨 "Damaged App" Error - FIXED!

When users open your app on another Mac, they see: **"Query Pilot is damaged and can't be opened"**

This happens because macOS adds a quarantine flag to unsigned apps.

---

## ✅ Solutions Created

### For Users (Quick Fix)

**One Command Fix:**
```bash
xattr -cr "/Applications/Query Pilot.app"
```

Copy this command and share it with users who see the error.

### For Distribution (Professional)

I've created a complete package with helper files:

```bash
# Package your build with instructions
make package-dist
```

This creates:
- **`dist-release/`** folder with:
  - The DMG file
  - `INSTALLATION.md` (detailed instructions)
  - `fix-damaged-app.sh` (helper script)
  - `README.txt` (quick start)
  - `checksums.txt` (verification)
- **`Query-Pilot-0.1.0-macOS-ARM64.zip`** (ready to upload)

---

## 📤 How to Distribute

### Option 1: Quick Share (Just the DMG)
```bash
# Send this file:
src-tauri/target/release/bundle/dmg/Query Pilot_0.1.0_aarch64.dmg

# With this fix command:
xattr -cr "/Applications/Query Pilot.app"
```

### Option 2: Professional Package
```bash
# Build and package
make build
make package-dist

# Upload this file:
Query-Pilot-0.1.0-macOS-ARM64.zip
```

Contains everything users need:
- DMG installer
- Fix script
- Installation guide
- Checksums for verification

### Option 3: Permanent Solution (No Errors!)

**Code Sign + Notarize** (requires Apple Developer account):

1. Get Apple Developer account ($99/year)
2. Configure signing in `src-tauri/tauri.conf.json`
3. Build and notarize:
```bash
make build
bash scripts/notarize.sh
```

Users will never see the "damaged" error! ✨

---

## 📝 Files Created

### User-Facing
- **`INSTALLATION.md`** - Complete installation guide
- **`FIX_DAMAGED_APP.md`** - Detailed fix instructions
- **`scripts/fix-damaged-app.sh`** - Automated fix script

### Developer Tools
- **`scripts/package-for-distribution.sh`** - Package with helpers
- **`scripts/notarize.sh`** - Notarization automation
- **`RELEASE.md`** - Full release workflow

### Quick Reference
- **`BUILD_SUCCESS.md`** - Build summary
- **`DISTRIBUTION_GUIDE.md`** - This file

---

## 🎯 Recommended Workflow

### For Beta/Testing:
```bash
make build
make package-dist

# Share: Query-Pilot-0.1.0-macOS-ARM64.zip
```

Include in your download page:
> **macOS Security Note:** First launch requires right-clicking the app and selecting "Open", or running this command in Terminal:
> ```bash
> xattr -cr "/Applications/Query Pilot.app"
> ```

### For Production:
```bash
# Get Apple Developer account
# Configure signing (see RELEASE.md)

make build
bash scripts/notarize.sh
make package-dist

# Share: Signed & notarized DMG
```

No security warnings! Professional experience.

---

## 📋 Add to Your Website/README

### Quick Fix Section:
```markdown
## macOS Installation

If you see "Query Pilot is damaged and can't be opened":

1. Open Terminal
2. Run: `xattr -cr "/Applications/Query Pilot.app"`
3. Launch Query Pilot

[Download Fix Script](link-to-fix-damaged-app.sh)
```

### Full Instructions:
Link to `INSTALLATION.md` from your downloads page.

---

## 🔐 Why This Happens

| Status | User Experience | Solution |
|--------|----------------|----------|
| **Unsigned** | "Damaged" error | Run `xattr -cr` command |
| **Signed** | "Unidentified developer" warning | Right-click → Open |
| **Signed + Notarized** | ✅ No warnings | Professional! |

---

## 🆘 Common User Issues

### "Operation not permitted"
**Solution:** Grant Terminal full disk access
- System Settings → Privacy & Security → Full Disk Access → Add Terminal

### "No such file or directory"
**Solution:** Check app location
```bash
# Find the app
mdfind "kMDItemDisplayName == 'Query Pilot'"

# Fix with correct path
xattr -cr "/actual/path/to/Query Pilot.app"
```

### Still getting the error
**Solution:** Re-download
- Original file may be corrupted
- Check file size (should be ~56 MB)

---

## 💡 Pro Tips

1. **Test on a clean Mac** before releasing
2. **Include fix instructions** in every distribution
3. **Plan for notarization** ASAP for better UX
4. **Monitor feedback** - adjust instructions based on user reports

---

## 📞 Support Template

When users report the error, reply with:

> Thanks for reporting! This is a known macOS security behavior for apps outside the App Store.
>
> **Quick fix:**
> Open Terminal and run:
> ```bash
> xattr -cr "/Applications/Query Pilot.app"
> ```
>
> Then try opening Query Pilot again. This is safe - it just removes a quarantine flag macOS adds to downloaded apps.
>
> We're working on Apple notarization to eliminate this step in future releases.
>
> Let me know if this helps!

---

## ✅ Next Steps

- [ ] Test the fix on another Mac
- [ ] Add installation instructions to your website
- [ ] Consider getting Apple Developer account for signing
- [ ] Plan notarization for next release

---

**Your app is ready to distribute!** 🚀

Just choose your method:
- **Quick:** Share DMG + fix command
- **Better:** `make package-dist` → share the ZIP
- **Best:** Code sign + notarize → no warnings!
