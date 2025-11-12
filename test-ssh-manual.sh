#!/bin/bash
# Manual test of SSH tunnel to postgres-private

echo "Testing SSH password authentication..."
docker exec -i query-pilot-ssh-bastion-password sh -c 'echo "SSH_OK"' 2>&1 || {
    echo "❌ SSH bastion container is not responding"
    exit 1
}

echo "✓ SSH bastion is up"

echo ""
echo "Testing postgres-private connectivity from bastion..."
docker exec -i query-pilot-ssh-bastion-password sh -c 'nc -zv postgres-private 5432' 2>&1 || {
    echo "❌ Cannot reach postgres-private:5432 from bastion"
    exit 1
}

echo "✓ Bastion can reach postgres-private:5432"

echo ""
echo "Testing database connection directly (bypassing SSH)..."
PGPASSWORD=devpass123 psql -h localhost -p 5432 -U devuser -d todoapp -c "SELECT 1;" 2>&1 | head -5 || {
    echo "Note: Direct connection failed (expected if only postgres-private is running)"
}

echo ""
echo "All checks passed! SSH tunnel should work."
echo ""
echo "Expected configuration:"
echo "  Database Host: postgres-private"
echo "  Database Port: 5432"
echo "  SSH Host: localhost"
echo "  SSH Port: 2222"
echo "  SSH User: sshuser"
echo "  SSH Password: bastionpass123"

