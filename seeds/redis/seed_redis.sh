#!/bin/bash
# Redis seed script for Query Pilot development
# Run this after starting the Redis container:
#   ./seeds/redis/seed_redis.sh

# Use docker exec to run redis-cli inside the container
REDIS_CLI="docker exec -i query-pilot-redis redis-cli -a devpass123"

echo "Seeding Redis with test data..."

# Clear existing data (optional, comment out to preserve data)
# $REDIS_CLI FLUSHALL

# ============================================================================
# String Values
# ============================================================================

echo "Creating string values..."
$REDIS_CLI SET "user:1:name" "John Doe" 2>/dev/null
$REDIS_CLI SET "user:1:email" "john@example.com" 2>/dev/null
$REDIS_CLI SET "user:2:name" "Jane Smith" 2>/dev/null
$REDIS_CLI SET "user:2:email" "jane@example.com" 2>/dev/null
$REDIS_CLI SET "app:version" "2.0.1" 2>/dev/null
$REDIS_CLI SET "app:environment" "development" 2>/dev/null
$REDIS_CLI SET "counter:visitors" "1234567" 2>/dev/null
$REDIS_CLI SET "json:config" '{"theme":"dark","language":"en","notifications":{"email":true,"push":false}}' 2>/dev/null

# Strings with TTL
$REDIS_CLI SETEX "session:abc123" 3600 '{"user_id":1,"created_at":"2024-01-15T10:30:00Z"}' 2>/dev/null
$REDIS_CLI SETEX "cache:page:home" 300 "<html>Cached homepage content</html>" 2>/dev/null
$REDIS_CLI SETEX "rate_limit:user:1" 60 "45" 2>/dev/null

# ============================================================================
# Hash Values
# ============================================================================

echo "Creating hash values..."
$REDIS_CLI HSET "user:1" \
    id "1" \
    username "john_doe" \
    email "john@example.com" \
    age "30" \
    active "true" \
    created_at "2024-01-15T10:30:00Z" 2>/dev/null

$REDIS_CLI HSET "user:2" \
    id "2" \
    username "jane_smith" \
    email "jane@example.com" \
    age "28" \
    active "false" \
    created_at "2024-02-20T14:45:00Z" 2>/dev/null

$REDIS_CLI HSET "todo:1" \
    id "1" \
    title "Complete Redis adapter" \
    description "Implement all Redis data type operations" \
    user_id "1" \
    priority "1" \
    completed "false" \
    created_at "2024-01-10T09:00:00Z" 2>/dev/null

$REDIS_CLI HSET "todo:2" \
    id "2" \
    title "Write documentation" \
    description "Create comprehensive API documentation" \
    user_id "1" \
    priority "2" \
    completed "true" \
    created_at "2024-01-08T14:00:00Z" 2>/dev/null

$REDIS_CLI HSET "config:app" \
    name "Query Pilot" \
    version "2.0.0" \
    debug "true" \
    max_connections "100" \
    timeout "30" 2>/dev/null

# ============================================================================
# List Values
# ============================================================================

echo "Creating list values..."
$REDIS_CLI RPUSH "queue:jobs" \
    "job:process_image:1" \
    "job:send_email:2" \
    "job:generate_report:3" \
    "job:sync_data:4" \
    "job:cleanup:5" 2>/dev/null

$REDIS_CLI RPUSH "user:1:notifications" \
    '{"type":"info","message":"Welcome back!","timestamp":"2024-01-15T10:30:00Z"}' \
    '{"type":"warning","message":"Your session will expire soon","timestamp":"2024-01-15T11:00:00Z"}' \
    '{"type":"success","message":"Profile updated successfully","timestamp":"2024-01-15T11:30:00Z"}' 2>/dev/null

$REDIS_CLI RPUSH "logs:app" \
    "[2024-01-15 10:00:00] INFO: Application started" \
    "[2024-01-15 10:00:01] DEBUG: Loading configuration" \
    "[2024-01-15 10:00:02] INFO: Database connected" \
    "[2024-01-15 10:00:05] INFO: Ready to accept connections" 2>/dev/null

$REDIS_CLI RPUSH "tags:popular" "javascript" "python" "rust" "mongodb" "redis" "docker" "kubernetes" 2>/dev/null

# ============================================================================
# Set Values
# ============================================================================

echo "Creating set values..."
$REDIS_CLI SADD "user:1:roles" "admin" "editor" "viewer" 2>/dev/null
$REDIS_CLI SADD "user:2:roles" "viewer" 2>/dev/null

$REDIS_CLI SADD "project:1:members" "user:1" "user:2" "user:3" 2>/dev/null
$REDIS_CLI SADD "project:2:members" "user:1" "user:4" 2>/dev/null

$REDIS_CLI SADD "tags:all" \
    "javascript" "typescript" "python" "rust" "go" \
    "mongodb" "redis" "postgresql" "mysql" \
    "react" "vue" "angular" "svelte" \
    "docker" "kubernetes" "aws" "gcp" 2>/dev/null

$REDIS_CLI SADD "active:sessions" \
    "session:abc123" "session:def456" "session:ghi789" 2>/dev/null

# ============================================================================
# Sorted Set Values (ZSets)
# ============================================================================

echo "Creating sorted set values..."
$REDIS_CLI ZADD "leaderboard:game" \
    9500 "player:alice" \
    8700 "player:bob" \
    7200 "player:charlie" \
    6100 "player:david" \
    5000 "player:eve" \
    4500 "player:frank" \
    3200 "player:grace" 2>/dev/null

$REDIS_CLI ZADD "trending:articles" \
    156 "article:how-to-redis" \
    142 "article:mongodb-best-practices" \
    98 "article:rust-web-development" \
    87 "article:docker-optimization" \
    45 "article:kubernetes-scaling" 2>/dev/null

$REDIS_CLI ZADD "priority:todos" \
    1 "todo:1" \
    2 "todo:2" \
    2 "todo:3" \
    3 "todo:4" \
    5 "todo:5" 2>/dev/null

# Timestamps as scores (for time-series data)
$REDIS_CLI ZADD "events:timeline" \
    1705311600 '{"event":"user_signup","user_id":1}' \
    1705312500 '{"event":"login","user_id":1}' \
    1705313400 '{"event":"page_view","user_id":1,"page":"/dashboard"}' \
    1705314300 '{"event":"logout","user_id":1}' 2>/dev/null

# ============================================================================
# Special Keys
# ============================================================================

echo "Creating special keys..."

# Counter
$REDIS_CLI SET "stats:api_calls" "50000" 2>/dev/null
$REDIS_CLI INCRBY "stats:api_calls" 100 2>/dev/null

# Bitmap (for tracking daily active users)
$REDIS_CLI SETBIT "dau:2024-01-15" 1 1 2>/dev/null
$REDIS_CLI SETBIT "dau:2024-01-15" 2 1 2>/dev/null
$REDIS_CLI SETBIT "dau:2024-01-15" 5 1 2>/dev/null
$REDIS_CLI SETBIT "dau:2024-01-15" 100 1 2>/dev/null
$REDIS_CLI SETBIT "dau:2024-01-15" 1000 1 2>/dev/null

# Keys with different patterns for pattern matching tests
$REDIS_CLI SET "cache:api:users:list" "cached_users_data" 2>/dev/null
$REDIS_CLI SET "cache:api:posts:list" "cached_posts_data" 2>/dev/null
$REDIS_CLI SET "cache:api:comments:list" "cached_comments_data" 2>/dev/null
$REDIS_CLI SET "temp:upload:12345" "processing" 2>/dev/null
$REDIS_CLI SET "temp:upload:67890" "completed" 2>/dev/null

echo ""
echo "Redis seeding complete!"
echo ""
echo "Summary of created keys:"
echo "========================"
$REDIS_CLI DBSIZE 2>/dev/null
echo ""
echo "Keys by pattern:"
USER_COUNT=$($REDIS_CLI KEYS 'user:*' 2>/dev/null | wc -l)
TODO_COUNT=$($REDIS_CLI KEYS 'todo:*' 2>/dev/null | wc -l)
CACHE_COUNT=$($REDIS_CLI KEYS 'cache:*' 2>/dev/null | wc -l)
QUEUE_COUNT=$($REDIS_CLI KEYS 'queue:*' 2>/dev/null | wc -l)
echo "  user:* - $USER_COUNT keys"
echo "  todo:* - $TODO_COUNT keys"
echo "  cache:* - $CACHE_COUNT keys"
echo "  queue:* - $QUEUE_COUNT keys"
