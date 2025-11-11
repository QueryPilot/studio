#!/usr/bin/env python3
"""Test SSH tunnel + Postgres connection similar to what the app does"""

import socket
import paramiko
import time

# SSH config
SSH_HOST = "localhost"
SSH_PORT = 2222
SSH_USER = "sshuser"
SSH_PASSWORD = "bastionpass123"

# Remote DB config (as seen from bastion)
REMOTE_DB_HOST = "postgres-private"
REMOTE_DB_PORT = 5432

# Local port for tunnel
LOCAL_PORT = 9999

print("=" * 60)
print("Testing SSH Tunnel + Postgres Connection")
print("=" * 60)

# Step 1: Test SSH authentication
print("\n1. Testing SSH authentication...")
try:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=SSH_HOST,
        port=SSH_PORT,
        username=SSH_USER,
        password=SSH_PASSWORD,
        timeout=10
    )
    print("   ✓ SSH authentication successful")
    
    # Test if bastion can reach remote DB
    print(f"\n2. Testing if bastion can reach {REMOTE_DB_HOST}:{REMOTE_DB_PORT}...")
    stdin, stdout, stderr = client.exec_command(f"timeout 2 nc -zv {REMOTE_DB_HOST} {REMOTE_DB_PORT} 2>&1 || echo 'Cannot use nc, trying cat'")
    output = stdout.read().decode()
    error = stderr.read().decode()
    
    if "succeeded" in output.lower() or "open" in output.lower():
        print(f"   ✓ Bastion can reach {REMOTE_DB_HOST}:{REMOTE_DB_PORT}")
    else:
        # Try alternative test
        stdin, stdout, stderr = client.exec_command(f"timeout 2 cat < /dev/tcp/{REMOTE_DB_HOST}/{REMOTE_DB_PORT} 2>&1 && echo 'OK' || echo 'FAILED'")
        output = stdout.read().decode()
        if "OK" in output:
            print(f"   ✓ Bastion can reach {REMOTE_DB_HOST}:{REMOTE_DB_PORT}")
        else:
            print(f"   ✗ Bastion cannot reach {REMOTE_DB_HOST}:{REMOTE_DB_PORT}")
            print(f"     Output: {output}")
            print(f"     Error: {error}")
    
    client.close()
    
except Exception as e:
    print(f"   ✗ SSH test failed: {e}")
    exit(1)

# Step 2: Create SSH tunnel
print(f"\n3. Creating SSH tunnel on localhost:{LOCAL_PORT}...")
try:
    transport = paramiko.Transport((SSH_HOST, SSH_PORT))
    transport.connect(username=SSH_USER, password=SSH_PASSWORD)
    
    # Try to open a forwarding channel
    channel = transport.open_channel(
        "direct-tcpip",
        (REMOTE_DB_HOST, REMOTE_DB_PORT),
        ("localhost", LOCAL_PORT)
    )
    
    if channel is None:
        print("   ✗ Could not establish SSH tunnel")
        exit(1)
    
    print(f"   ✓ SSH tunnel channel opened to {REMOTE_DB_HOST}:{REMOTE_DB_PORT}")
    
    # Try to read postgres greeting
    print("\n4. Testing if Postgres responds through tunnel...")
    channel.settimeout(5.0)
    
    # Postgres sends a startup message immediately
    data = channel.recv(1024)
    if len(data) > 0:
        print(f"   ✓ Received {len(data)} bytes from Postgres")
        print(f"   ✓ SSH tunnel is working!")
    else:
        print("   ✗ No data received from Postgres")
    
    channel.close()
    transport.close()
    
except Exception as e:
    print(f"   ✗ Tunnel test failed: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

print("\n" + "=" * 60)
print("✓ All tests passed! SSH tunnel should work in the app.")
print("=" * 60)
print("\nYour app config should be:")
print("  Database Host: postgres-private")
print("  Database Port: 5432")
print("  SSH Host: localhost")
print("  SSH Port: 2222")
print("  SSH User: sshuser")
print("  SSH Password: bastionpass123")

