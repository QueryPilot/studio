# SSH & SSM Troubleshooting Guide

Common issues and solutions for SSH tunnel and AWS SSM bastion connections in Query Pilot.

## Table of Contents

- [SSH Tunnel Issues](#ssh-tunnel-issues)
- [AWS SSM Issues](#aws-ssm-issues)
- [Database Connection Issues](#database-connection-issues)
- [Platform-Specific Issues](#platform-specific-issues)
- [Performance Issues](#performance-issues)

---

## SSH Tunnel Issues

### "SSH connection test timed out"

**Cause:** Network connectivity issue or incorrect host/port.

**Solution:**
1. Verify the SSH host is reachable:
   ```bash
   ping <ssh-host>
   telnet <ssh-host> <ssh-port>
   ```
2. Check firewall rules allow SSH connections
3. Verify the SSH port (default: 22)
4. Try increasing the timeout in a future release

---

### "SSH key file does not exist"

**Cause:** Invalid or missing SSH private key file.

**Solution:**
1. Verify the key file path:
   ```bash
   ls -la ~/.ssh/id_ed25519
   ```
2. Ensure you selected the **private** key, not the `.pub` file
3. Check file permissions (should be `600` or `400`):
   ```bash
   chmod 600 ~/.ssh/id_ed25519
   ```

---

### "Encrypted SSH keys are not supported directly"

**Cause:** You selected an encrypted key without using SSH agent.

**Solution:**
Use SSH agent to unlock your encrypted keys:
```bash
# Start SSH agent
eval "$(ssh-agent -s)"

# Add your encrypted key (you'll be prompted for the passphrase)
ssh-add ~/.ssh/id_ed25519

# Verify it's loaded
ssh-add -l
```

Then in Query Pilot, enable **Use SSH Agent** instead of selecting the key file directly.

---

### "Host key verification failed"

**Cause:** The SSH host key doesn't match your `~/.ssh/known_hosts` or is missing.

**Solution:**
1. **First connection**: The host key is unknown. You'll be prompted to trust it.
2. **Key changed**: If the host key changed (server reinstall, MITM attack), remove the old key:
   ```bash
   ssh-keygen -R <ssh-host>
   ```
3. **Manual verification**: Connect via terminal first to verify the fingerprint:
   ```bash
   ssh -v user@host
   ```

---

### "Permission denied (publickey)"

**Cause:** SSH key not authorized on the bastion.

**Solution:**
1. Ensure your **public key** is in `~/.ssh/authorized_keys` on the bastion:
   ```bash
   # Copy your public key
   cat ~/.ssh/id_ed25519.pub
   
   # On the bastion, add it to authorized_keys
   echo "ssh-ed25519 AAAA..." >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
2. Verify the username is correct
3. Check bastion SSH config allows public key auth

---

### "Too many SSH test attempts"

**Cause:** Rate limiting to prevent abuse.

**Solution:**
Wait 10 seconds before trying again. If you're testing frequently, consider using the **Save & Connect** flow instead of repeatedly clicking **Test**.

---

## AWS SSM Issues

### "AWS credentials provider is not configured"

**Cause:** No valid AWS credentials found.

**Solution:**
1. **For AWS Profile**: Configure your profile:
   ```bash
   aws configure --profile my-profile
   ```
2. **For OAuth**: Ensure you've authenticated and have a valid token stored
3. Verify credentials work:
   ```bash
   aws sts get-caller-identity --profile my-profile
   ```

---

### "Failed to start SSM session: AccessDeniedException"

**Cause:** Insufficient IAM permissions.

**Solution:**
Your IAM role/user needs these permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ssm:StartSession",
      "ssm:TerminateSession"
    ],
    "Resource": [
      "arn:aws:ec2:*:*:instance/*",
      "arn:aws:ssm:*:*:document/AWS-StartPortForwardingSessionToRemoteHost"
    ]
  }]
}
```

---

### "SSM response missing session_id"

**Cause:** SSM start-session call failed or returned incomplete data.

**Solution:**
1. Verify the target ID is correct (instance ID or ECS task ARN)
2. Ensure the target is running and reachable
3. Check that SSM agent is running on the target:
   ```bash
   aws ssm describe-instance-information \
     --filters "Key=InstanceIds,Values=i-0123456789abcdef0"
   ```

---

### "session-manager-plugin not found in application bundle"

**Cause:** The bundled session-manager-plugin binary is missing.

**Solution:**
1. Reinstall Query Pilot
2. If building from source, run:
   ```bash
   make setup-ssm-plugin
   ```
3. Verify the binary exists:
   ```bash
   ls src-tauri/sidecars/session-manager-plugin-*
   ```

---

### "SSM tunnel failed to become ready within 5 seconds"

**Cause:** The session-manager-plugin process started but the local port didn't begin listening.

**Solution:**
1. Check logs for plugin errors
2. Verify network connectivity to AWS SSM endpoints
3. Ensure no firewall blocking outbound HTTPS (port 443)
4. Try a different region

---

### "OAuth token expired"

**Cause:** Your OAuth access token has expired (typically after 1 hour).

**Solution:**
1. Re-authenticate using the OAuth flow
2. Future versions will auto-refresh tokens
3. For now, clear the token and re-authenticate:
   ```bash
   # Via CLI (future feature)
   query-pilot clear-oauth-token --provider microsoft
   ```

---

## Database Connection Issues

### "Database connection fails after SSH/SSM succeeds"

**Cause:** The database isn't reachable **from the bastion**, or credentials are wrong.

**Solution:**
1. **Test from bastion**: SSH into the bastion and verify connectivity:
   ```bash
   # For PostgreSQL
   psql -h <db-host> -p <db-port> -U <db-user> -d <db-name>
   
   # For MySQL
   mysql -h <db-host> -P <db-port> -u <db-user> -p
   ```
2. Check the database allows connections from the bastion's IP
3. Verify database credentials (username/password)
4. Ensure the database server is running

---

### "Remote Host" vs "Database Host"

**Important distinction:**

- **SSH Host / SSM Target**: The bastion server you're connecting to
- **Database Host**: The database server **as seen from the bastion**

For example:
- If your database is `db.internal.company.com` and reachable from the bastion
- Use `db.internal.company.com` as the **Database Host**, not `localhost`

**Special case:** If the database is running **on the same bastion**:
- Use `localhost` or `127.0.0.1` as the Database Host

---

## Platform-Specific Issues

### macOS: "App is damaged and can't be opened"

**Cause:** Gatekeeper quarantine on the app bundle or sidecars.

**Solution:**
```bash
xattr -cr /Applications/Query\ Pilot.app
```

---

### macOS: SSH agent not found

**Cause:** SSH agent not running or keychain integration missing.

**Solution:**
1. Start SSH agent:
   ```bash
   eval "$(ssh-agent -s)"
   ```
2. Add key to macOS Keychain:
   ```bash
   ssh-add --apple-use-keychain ~/.ssh/id_ed25519
   ```
3. Configure SSH to use keychain:
   ```bash
   # In ~/.ssh/config
   Host *
     UseKeychain yes
     AddKeysToAgent yes
   ```

---

### Linux: "Keyring error"

**Cause:** No keyring backend available (headless systems).

**Solution:**
Query Pilot needs a keyring to securely store passphrases and OAuth tokens. Install one:
```bash
# For GNOME
sudo apt-get install gnome-keyring

# For KDE
sudo apt-get install kwalletmanager

# For headless systems (not recommended for security)
# Use unencrypted SSH keys and AWS profiles
```

---

### Windows: PowerShell execution policy

**Cause:** Can't run the SSM plugin download script.

**Solution:**
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then run:
```powershell
.\scripts\download-ssm-plugin.ps1
```

---

## Performance Issues

### Slow query execution over SSH

**Cause:** Network latency or tunnel overhead.

**Solution:**
1. **Use compression** (future feature): SSH compression reduces bandwidth
2. **Optimize queries**: Fetch less data, use `LIMIT` clauses
3. **Consider a closer bastion**: Choose a bastion in the same region as your database
4. **Use SSM instead of SSH**: AWS SSM often has better latency within AWS

---

### Connection hangs during tunnel setup

**Cause:** Slow network or DNS resolution.

**Solution:**
1. Use IP addresses instead of hostnames
2. Check DNS resolution:
   ```bash
   nslookup <ssh-host>
   dig <ssh-host>
   ```
3. Try a different DNS server (e.g., `8.8.8.8`, `1.1.1.1`)

---

## Debugging Tips

### Enable verbose logging

_(Future feature)_

Query Pilot will support verbose logging for SSH and SSM connections:
```bash
QUERY_PILOT_LOG=debug query-pilot
```

### Test connections manually

**SSH:**
```bash
ssh -v -i ~/.ssh/id_ed25519 user@bastion-host -L 15432:db-host:5432
psql -h localhost -p 15432 -U dbuser -d dbname
```

**AWS SSM:**
```bash
aws ssm start-session \
  --target i-0123456789abcdef0 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["db-host"],"portNumber":["5432"],"localPortNumber":["15432"]}'
  
psql -h localhost -p 15432 -U dbuser -d dbname
```

### Check system logs

- **macOS**: `~/Library/Logs/Query Pilot/`
- **Linux**: `~/.local/share/query-pilot/logs/`
- **Windows**: `%APPDATA%\Query Pilot\logs\`

---

## Still Having Issues?

1. **Check the logs** (see above)
2. **Try the manual test** commands to isolate the problem
3. **Open an issue** on [GitHub](https://github.com/yourusername/query-pilot/issues) with:
   - Steps to reproduce
   - Error messages
   - OS and Query Pilot version
   - (Redacted) connection configuration

---

## Common Pitfalls

❌ **Using `localhost` as SSH Host**
- Use the actual bastion hostname/IP

❌ **Using bastion hostname as Database Host**
- Use the internal database hostname (as seen from the bastion)

❌ **Mixing up public and private keys**
- Query Pilot needs your **private** key (`id_ed25519`), not the public key (`id_ed25519.pub`)

❌ **Forgetting to add keys to authorized_keys**
- Your public key must be on the bastion's `~/.ssh/authorized_keys`

❌ **Wrong IAM permissions for SSM**
- Ensure both `ssm:StartSession` **and** access to the SSM document

---

**Need more help?** Join our [Discord community](https://discord.gg/querypilot) or check the [user guide](./ssh-and-ssm-user-guide.md).


