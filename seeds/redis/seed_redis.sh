#!/bin/bash
# ============================================================================
# Query Pilot - Redis Comprehensive Test Data Seeder
# ============================================================================
# Domains: ecommerce (realistic), edge_cases (data types), scale_test (performance)
# Features: All Redis data structures (Strings, Hashes, Lists, Sets, Sorted Sets, Streams, HyperLogLog, Bitmaps)
# ============================================================================

# Use docker exec to run redis-cli inside the container
REDIS_CLI="docker exec -i query-pilot-redis redis-cli -a devpass123"

echo "============================================================================"
echo "Query Pilot - Redis Seed Script"
echo "============================================================================"

# Clear existing data
echo "Clearing existing data..."
$REDIS_CLI FLUSHALL 2>/dev/null

# ============================================================================
# 1. ECOMMERCE DOMAIN - STRING VALUES
# ============================================================================
echo ""
echo "[1/10] Creating String values..."

# Customer session tokens
$REDIS_CLI SET "session:cust:1" '{"customer_id":1,"email":"emily.chen@techcorp.io","name":"Emily Chen","role":"customer","created_at":"2025-01-15T10:30:00Z"}' 2>/dev/null
$REDIS_CLI EXPIRE "session:cust:1" 7200 2>/dev/null
$REDIS_CLI SET "session:cust:2" '{"customer_id":2,"email":"marcus.rodriguez@startup.co","name":"Marcus Rodriguez","role":"customer","created_at":"2025-01-15T11:00:00Z"}' 2>/dev/null
$REDIS_CLI EXPIRE "session:cust:2" 7200 2>/dev/null
$REDIS_CLI SET "session:cust:5" '{"customer_id":5,"email":"akira.tanaka@design.jp","name":"Akira Tanaka","role":"customer","created_at":"2025-01-15T12:00:00Z"}' 2>/dev/null
$REDIS_CLI EXPIRE "session:cust:5" 7200 2>/dev/null

# Application configuration
$REDIS_CLI SET "config:app:name" "Query Pilot E-Commerce" 2>/dev/null
$REDIS_CLI SET "config:app:version" "2.1.0" 2>/dev/null
$REDIS_CLI SET "config:app:environment" "development" 2>/dev/null
$REDIS_CLI SET "config:app:maintenance_mode" "false" 2>/dev/null
$REDIS_CLI SET "config:payment:stripe_enabled" "true" 2>/dev/null
$REDIS_CLI SET "config:payment:paypal_enabled" "true" 2>/dev/null
$REDIS_CLI SET "config:shipping:free_threshold" "50.00" 2>/dev/null
$REDIS_CLI SET "config:shipping:default_carrier" "fedex" 2>/dev/null

# Counters
$REDIS_CLI SET "counter:orders:total" "15847" 2>/dev/null
$REDIS_CLI SET "counter:orders:today" "127" 2>/dev/null
$REDIS_CLI SET "counter:products:active" "17" 2>/dev/null
$REDIS_CLI SET "counter:customers:registered" "20" 2>/dev/null
$REDIS_CLI SET "counter:reviews:total" "1253" 2>/dev/null
$REDIS_CLI SET "counter:visitors:today" "3456" 2>/dev/null
$REDIS_CLI SET "counter:api:requests" "1048576" 2>/dev/null

# Cache entries with TTL
$REDIS_CLI SETEX "cache:homepage:featured" 300 '{"products":[{"id":1,"name":"MacBook Pro 16-inch M3 Max","price":3499.00},{"id":3,"name":"Sony WH-1000XM5 Headphones","price":349.99},{"id":6,"name":"Apple Watch Ultra 2","price":799.00}]}' 2>/dev/null
$REDIS_CLI SETEX "cache:categories:tree" 600 '[{"id":1,"name":"Electronics","children":[{"id":2,"name":"Computers"},{"id":3,"name":"Audio"},{"id":4,"name":"Wearables"}]},{"id":5,"name":"Home & Garden"}]' 2>/dev/null
$REDIS_CLI SETEX "cache:product:1:details" 900 '{"id":1,"name":"MacBook Pro 16-inch M3 Max","sku":"MBP-16-M3MAX","price":3499.00,"stock":45,"rating":4.8}' 2>/dev/null
$REDIS_CLI SETEX "cache:exchange:rates" 3600 '{"USD":1,"EUR":0.92,"GBP":0.79,"JPY":149.50,"CAD":1.36,"AUD":1.53}' 2>/dev/null

# Rate limiting
$REDIS_CLI SETEX "ratelimit:api:192.168.1.100" 60 "47" 2>/dev/null
$REDIS_CLI SETEX "ratelimit:api:192.168.1.101" 60 "12" 2>/dev/null
$REDIS_CLI SETEX "ratelimit:login:emily.chen@techcorp.io" 300 "2" 2>/dev/null

# ============================================================================
# 2. ECOMMERCE DOMAIN - HASH VALUES (Customer profiles, Products, Orders)
# ============================================================================
echo "[2/10] Creating Hash values..."

# Customer profiles
$REDIS_CLI HSET "customer:1" \
    id "1" \
    email "emily.chen@techcorp.io" \
    first_name "Emily" \
    last_name "Chen" \
    phone "+1-415-555-0123" \
    loyalty_points "2500" \
    tier "gold" \
    is_verified "true" \
    created_at "2024-03-15T08:30:00Z" \
    last_order_at "2025-01-10T14:22:00Z" \
    total_orders "47" \
    lifetime_value "12450.00" 2>/dev/null

$REDIS_CLI HSET "customer:2" \
    id "2" \
    email "marcus.rodriguez@startup.co" \
    first_name "Marcus" \
    last_name "Rodriguez" \
    phone "+1-512-555-0456" \
    loyalty_points "1200" \
    tier "silver" \
    is_verified "true" \
    created_at "2024-05-20T11:15:00Z" \
    last_order_at "2025-01-08T09:45:00Z" \
    total_orders "23" \
    lifetime_value "5670.00" 2>/dev/null

$REDIS_CLI HSET "customer:3" \
    id "3" \
    email "sarah.johnson@enterprise.com" \
    first_name "Sarah" \
    last_name "Johnson" \
    phone "+1-212-555-0789" \
    loyalty_points "5800" \
    tier "platinum" \
    is_verified "true" \
    created_at "2023-11-01T15:00:00Z" \
    last_order_at "2025-01-12T16:30:00Z" \
    total_orders "89" \
    lifetime_value "34200.00" 2>/dev/null

$REDIS_CLI HSET "customer:5" \
    id "5" \
    email "akira.tanaka@design.jp" \
    first_name "Akira" \
    last_name "Tanaka" \
    phone "+81-3-5555-0123" \
    loyalty_points "800" \
    tier "bronze" \
    is_verified "true" \
    created_at "2024-08-10T03:00:00Z" \
    last_order_at "2025-01-05T22:15:00Z" \
    total_orders "12" \
    lifetime_value "2890.00" 2>/dev/null

$REDIS_CLI HSET "customer:8" \
    id "8" \
    email "olivia.martinez@creative.studio" \
    first_name "Olivia" \
    last_name "Martinez" \
    phone "+1-305-555-0321" \
    loyalty_points "150" \
    tier "bronze" \
    is_verified "false" \
    created_at "2025-01-02T12:00:00Z" \
    last_order_at "" \
    total_orders "2" \
    lifetime_value "450.00" 2>/dev/null

# Product details
$REDIS_CLI HSET "product:1" \
    id "1" \
    sku "MBP-16-M3MAX" \
    name "MacBook Pro 16-inch M3 Max" \
    category_id "2" \
    price "3499.00" \
    cost_price "2800.00" \
    stock "45" \
    reserved "3" \
    rating_avg "4.8" \
    rating_count "234" \
    is_featured "true" \
    is_active "true" \
    weight_kg "2.14" \
    created_at "2024-01-15T00:00:00Z" 2>/dev/null

$REDIS_CLI HSET "product:3" \
    id "3" \
    sku "SONY-WH1000XM5" \
    name "Sony WH-1000XM5 Headphones" \
    category_id "3" \
    price "349.99" \
    cost_price "220.00" \
    stock "120" \
    reserved "8" \
    rating_avg "4.7" \
    rating_count "892" \
    is_featured "true" \
    is_active "true" \
    weight_kg "0.25" \
    created_at "2024-02-01T00:00:00Z" 2>/dev/null

$REDIS_CLI HSET "product:6" \
    id "6" \
    sku "APPLE-WATCH-ULTRA2" \
    name "Apple Watch Ultra 2" \
    category_id "4" \
    price "799.00" \
    cost_price "550.00" \
    stock "67" \
    reserved "5" \
    rating_avg "4.6" \
    rating_count "445" \
    is_featured "true" \
    is_active "true" \
    weight_kg "0.062" \
    created_at "2024-03-01T00:00:00Z" 2>/dev/null

$REDIS_CLI HSET "product:9" \
    id "9" \
    sku "HERMAN-AERON" \
    name "Herman Miller Aeron Chair" \
    category_id "5" \
    price "1395.00" \
    cost_price "900.00" \
    stock "23" \
    reserved "2" \
    rating_avg "4.9" \
    rating_count "1256" \
    is_featured "false" \
    is_active "true" \
    weight_kg "18.1" \
    created_at "2024-04-15T00:00:00Z" 2>/dev/null

$REDIS_CLI HSET "product:12" \
    id "12" \
    sku "DYSON-V15" \
    name "Dyson V15 Detect Vacuum" \
    category_id "5" \
    price "749.99" \
    cost_price "480.00" \
    stock "38" \
    reserved "0" \
    rating_avg "4.5" \
    rating_count "678" \
    is_featured "false" \
    is_active "true" \
    weight_kg "3.1" \
    created_at "2024-05-01T00:00:00Z" 2>/dev/null

# Order details
$REDIS_CLI HSET "order:15847" \
    id "15847" \
    customer_id "1" \
    status "delivered" \
    subtotal "3848.99" \
    tax "346.41" \
    shipping "0.00" \
    total "4195.40" \
    payment_method "credit_card" \
    shipping_address '{"street":"123 Tech Valley Blvd","city":"San Francisco","state":"CA","zip":"94107","country":"US"}' \
    items_count "2" \
    created_at "2025-01-10T14:22:00Z" \
    shipped_at "2025-01-11T09:00:00Z" \
    delivered_at "2025-01-13T15:30:00Z" 2>/dev/null

$REDIS_CLI HSET "order:15846" \
    id "15846" \
    customer_id "3" \
    status "shipped" \
    subtotal "1395.00" \
    tax "125.55" \
    shipping "0.00" \
    total "1520.55" \
    payment_method "paypal" \
    shipping_address '{"street":"456 Enterprise Ave","city":"New York","state":"NY","zip":"10001","country":"US"}' \
    items_count "1" \
    created_at "2025-01-12T16:30:00Z" \
    shipped_at "2025-01-13T08:00:00Z" \
    delivered_at "" 2>/dev/null

$REDIS_CLI HSET "order:15845" \
    id "15845" \
    customer_id "2" \
    status "processing" \
    subtotal "799.00" \
    tax "71.91" \
    shipping "9.99" \
    total "880.90" \
    payment_method "credit_card" \
    shipping_address '{"street":"789 Startup Lane","city":"Austin","state":"TX","zip":"78701","country":"US"}' \
    items_count "1" \
    created_at "2025-01-14T10:15:00Z" \
    shipped_at "" \
    delivered_at "" 2>/dev/null

$REDIS_CLI HSET "order:15844" \
    id "15844" \
    customer_id "5" \
    status "pending" \
    subtotal "349.99" \
    tax "35.00" \
    shipping "25.00" \
    total "409.99" \
    payment_method "bank_transfer" \
    shipping_address '{"street":"1-2-3 Shibuya","city":"Tokyo","state":"","zip":"150-0002","country":"JP"}' \
    items_count "1" \
    created_at "2025-01-15T02:00:00Z" \
    shipped_at "" \
    delivered_at "" 2>/dev/null

# Shopping carts
$REDIS_CLI HSET "cart:customer:8" \
    customer_id "8" \
    items '[{"product_id":3,"sku":"SONY-WH1000XM5","name":"Sony WH-1000XM5 Headphones","quantity":1,"price":349.99},{"product_id":12,"sku":"DYSON-V15","name":"Dyson V15 Detect Vacuum","quantity":1,"price":749.99}]' \
    items_count "2" \
    subtotal "1099.98" \
    updated_at "2025-01-15T11:30:00Z" 2>/dev/null
$REDIS_CLI EXPIRE "cart:customer:8" 604800 2>/dev/null

$REDIS_CLI HSET "cart:guest:abc123xyz" \
    session_id "abc123xyz" \
    items '[{"product_id":1,"sku":"MBP-16-M3MAX","name":"MacBook Pro 16-inch M3 Max","quantity":1,"price":3499.00}]' \
    items_count "1" \
    subtotal "3499.00" \
    updated_at "2025-01-15T12:00:00Z" 2>/dev/null
$REDIS_CLI EXPIRE "cart:guest:abc123xyz" 86400 2>/dev/null

# Inventory tracking
$REDIS_CLI HSET "inventory:product:1" \
    product_id "1" \
    sku "MBP-16-M3MAX" \
    warehouse_main "45" \
    warehouse_east "12" \
    warehouse_west "8" \
    reserved "3" \
    reorder_level "10" \
    last_restocked "2025-01-10T00:00:00Z" 2>/dev/null

$REDIS_CLI HSET "inventory:product:3" \
    product_id "3" \
    sku "SONY-WH1000XM5" \
    warehouse_main "120" \
    warehouse_east "45" \
    warehouse_west "32" \
    reserved "8" \
    reorder_level "25" \
    last_restocked "2025-01-12T00:00:00Z" 2>/dev/null

# ============================================================================
# 3. ECOMMERCE DOMAIN - LIST VALUES (Queues, Activity feeds, Recent items)
# ============================================================================
echo "[3/10] Creating List values..."

# Order processing queue
$REDIS_CLI RPUSH "queue:orders:pending" \
    '{"order_id":15845,"customer_id":2,"total":880.90,"priority":"normal"}' \
    '{"order_id":15844,"customer_id":5,"total":409.99,"priority":"normal"}' 2>/dev/null

$REDIS_CLI RPUSH "queue:orders:high_priority" \
    '{"order_id":15850,"customer_id":3,"total":5200.00,"priority":"high","reason":"platinum_customer"}' 2>/dev/null

# Email notification queue
$REDIS_CLI RPUSH "queue:notifications:email" \
    '{"type":"order_confirmation","to":"marcus.rodriguez@startup.co","order_id":15845}' \
    '{"type":"shipping_update","to":"sarah.johnson@enterprise.com","order_id":15846}' \
    '{"type":"review_request","to":"emily.chen@techcorp.io","order_id":15840}' \
    '{"type":"abandoned_cart","to":"olivia.martinez@creative.studio","cart_value":1099.98}' 2>/dev/null

# Inventory restock queue
$REDIS_CLI RPUSH "queue:inventory:restock" \
    '{"product_id":7,"sku":"BOSE-QC45","current_stock":8,"reorder_qty":50}' \
    '{"product_id":15,"sku":"AIRPODS-PRO2","current_stock":12,"reorder_qty":100}' 2>/dev/null

# Customer activity feed
$REDIS_CLI LPUSH "activity:customer:1" \
    '{"action":"order_placed","order_id":15847,"timestamp":"2025-01-10T14:22:00Z"}' \
    '{"action":"review_submitted","product_id":1,"rating":5,"timestamp":"2025-01-08T16:00:00Z"}' \
    '{"action":"wishlist_add","product_id":9,"timestamp":"2025-01-05T10:30:00Z"}' 2>/dev/null
$REDIS_CLI LTRIM "activity:customer:1" 0 99 2>/dev/null

$REDIS_CLI LPUSH "activity:customer:3" \
    '{"action":"order_placed","order_id":15846,"timestamp":"2025-01-12T16:30:00Z"}' \
    '{"action":"login","ip":"203.45.67.89","timestamp":"2025-01-12T16:25:00Z"}' \
    '{"action":"product_view","product_id":9,"timestamp":"2025-01-12T16:20:00Z"}' 2>/dev/null

# Recently viewed products per customer
$REDIS_CLI LPUSH "recently_viewed:customer:1" "1" "3" "6" "9" "12" "2" "5" "8" 2>/dev/null
$REDIS_CLI LTRIM "recently_viewed:customer:1" 0 19 2>/dev/null

$REDIS_CLI LPUSH "recently_viewed:customer:2" "6" "1" "3" "15" "9" 2>/dev/null
$REDIS_CLI LTRIM "recently_viewed:customer:2" 0 19 2>/dev/null

# Application logs (recent)
$REDIS_CLI LPUSH "logs:app:recent" \
    '[2025-01-15 12:00:05] INFO: Order 15847 delivered successfully' \
    '[2025-01-15 11:58:32] INFO: Payment processed for order 15845' \
    '[2025-01-15 11:55:00] DEBUG: Cache refreshed for product catalog' \
    '[2025-01-15 11:50:15] WARN: Low stock alert for product SKU BOSE-QC45' \
    '[2025-01-15 11:45:00] INFO: Daily backup completed' \
    '[2025-01-15 11:30:22] INFO: New customer registered: olivia.martinez@creative.studio' \
    '[2025-01-15 11:00:00] INFO: Scheduled price update completed for 5 products' \
    '[2025-01-15 10:30:00] INFO: Application started successfully' 2>/dev/null
$REDIS_CLI LTRIM "logs:app:recent" 0 999 2>/dev/null

# Search history
$REDIS_CLI LPUSH "search:history:customer:1" \
    '{"query":"macbook pro","results":3,"timestamp":"2025-01-15T10:00:00Z"}' \
    '{"query":"wireless headphones","results":8,"timestamp":"2025-01-14T15:30:00Z"}' \
    '{"query":"office chair ergonomic","results":5,"timestamp":"2025-01-12T09:00:00Z"}' 2>/dev/null

# ============================================================================
# 4. ECOMMERCE DOMAIN - SET VALUES (Tags, Categories, Permissions)
# ============================================================================
echo "[4/10] Creating Set values..."

# Product tags
$REDIS_CLI SADD "tags:product:1" "laptop" "apple" "professional" "m3" "high-performance" "portable" 2>/dev/null
$REDIS_CLI SADD "tags:product:3" "headphones" "sony" "wireless" "noise-cancelling" "premium-audio" 2>/dev/null
$REDIS_CLI SADD "tags:product:6" "smartwatch" "apple" "fitness" "health" "gps" "diving" 2>/dev/null
$REDIS_CLI SADD "tags:product:9" "office" "ergonomic" "chair" "herman-miller" "premium" 2>/dev/null
$REDIS_CLI SADD "tags:product:12" "vacuum" "dyson" "cordless" "home" "cleaning" 2>/dev/null

# Products by category
$REDIS_CLI SADD "category:2:products" "1" "2" "4" "10" 2>/dev/null  # Computers
$REDIS_CLI SADD "category:3:products" "3" "7" "8" "15" 2>/dev/null  # Audio
$REDIS_CLI SADD "category:4:products" "6" "11" "14" 2>/dev/null     # Wearables
$REDIS_CLI SADD "category:5:products" "9" "12" "13" "16" "17" 2>/dev/null  # Home

# Customer wishlists
$REDIS_CLI SADD "wishlist:customer:1" "9" "12" "15" 2>/dev/null
$REDIS_CLI SADD "wishlist:customer:2" "1" "6" "9" 2>/dev/null
$REDIS_CLI SADD "wishlist:customer:3" "3" "12" 2>/dev/null
$REDIS_CLI SADD "wishlist:customer:5" "1" "3" "6" "9" 2>/dev/null

# Products in customer carts (for quick lookup)
$REDIS_CLI SADD "cart:products:customer:8" "3" "12" 2>/dev/null

# Active promotions applied to products
$REDIS_CLI SADD "promo:WINTER2025:products" "3" "7" "8" "12" 2>/dev/null
$REDIS_CLI SADD "promo:TECHSALE:products" "1" "2" "4" "6" "10" 2>/dev/null

# Customers who purchased specific products
$REDIS_CLI SADD "product:1:buyers" "1" "3" "7" "12" "15" 2>/dev/null
$REDIS_CLI SADD "product:3:buyers" "1" "2" "3" "5" "8" "11" "14" "18" 2>/dev/null
$REDIS_CLI SADD "product:6:buyers" "2" "3" "9" "13" 2>/dev/null

# Admin user roles and permissions
$REDIS_CLI SADD "admin:roles:superadmin" "user:admin:1" 2>/dev/null
$REDIS_CLI SADD "admin:roles:manager" "user:admin:2" "user:admin:3" 2>/dev/null
$REDIS_CLI SADD "admin:roles:support" "user:admin:4" "user:admin:5" "user:admin:6" 2>/dev/null

$REDIS_CLI SADD "admin:permissions:superadmin" "users:*" "orders:*" "products:*" "settings:*" "reports:*" 2>/dev/null
$REDIS_CLI SADD "admin:permissions:manager" "users:read" "orders:*" "products:*" "reports:read" 2>/dev/null
$REDIS_CLI SADD "admin:permissions:support" "users:read" "orders:read" "orders:update" "products:read" 2>/dev/null

# Active user sessions (for concurrent session tracking)
$REDIS_CLI SADD "sessions:active" "session:cust:1" "session:cust:2" "session:cust:5" 2>/dev/null

# Featured and sale products
$REDIS_CLI SADD "products:featured" "1" "3" "6" 2>/dev/null
$REDIS_CLI SADD "products:on_sale" "3" "7" "12" "15" 2>/dev/null
$REDIS_CLI SADD "products:new_arrivals" "16" "17" 2>/dev/null
$REDIS_CLI SADD "products:bestsellers" "1" "3" "6" "9" "12" 2>/dev/null

# ============================================================================
# 5. ECOMMERCE DOMAIN - SORTED SET VALUES (Rankings, Leaderboards, Schedules)
# ============================================================================
echo "[5/10] Creating Sorted Set values..."

# Product sales ranking (score = units sold)
$REDIS_CLI ZADD "ranking:products:sales" \
    1523 "product:3" \
    1089 "product:1" \
    892 "product:6" \
    756 "product:12" \
    645 "product:9" \
    543 "product:2" \
    432 "product:7" \
    321 "product:15" \
    234 "product:4" \
    189 "product:10" 2>/dev/null

# Product revenue ranking (score = total revenue in cents)
$REDIS_CLI ZADD "ranking:products:revenue" \
    3810361 "product:1" \
    532646 "product:3" \
    712908 "product:6" \
    566957 "product:12" \
    900495 "product:9" \
    215460 "product:2" \
    108864 "product:7" \
    112056 "product:15" \
    140166 "product:4" \
    94311 "product:10" 2>/dev/null

# Customer loyalty points ranking
$REDIS_CLI ZADD "ranking:customers:loyalty" \
    5800 "customer:3" \
    2500 "customer:1" \
    1800 "customer:7" \
    1500 "customer:12" \
    1200 "customer:2" \
    950 "customer:9" \
    800 "customer:5" \
    650 "customer:15" \
    400 "customer:11" \
    150 "customer:8" 2>/dev/null

# Product ratings (score = average rating * 100 for precision)
$REDIS_CLI ZADD "ranking:products:rating" \
    490 "product:9" \
    480 "product:1" \
    470 "product:3" \
    465 "product:7" \
    460 "product:6" \
    455 "product:2" \
    450 "product:12" \
    445 "product:15" \
    440 "product:4" \
    430 "product:10" 2>/dev/null

# Search term popularity (score = search count)
$REDIS_CLI ZADD "search:popular" \
    4523 "macbook" \
    3891 "headphones" \
    3245 "iphone" \
    2876 "airpods" \
    2543 "apple watch" \
    2234 "laptop" \
    1987 "wireless" \
    1654 "samsung" \
    1432 "chair" \
    1298 "vacuum" 2>/dev/null

# Trending products (score = view count in last 24h)
$REDIS_CLI ZADD "trending:products:24h" \
    1245 "product:1" \
    1089 "product:3" \
    876 "product:6" \
    654 "product:16" \
    543 "product:17" \
    432 "product:9" \
    321 "product:12" \
    234 "product:2" 2>/dev/null

# Scheduled tasks (score = Unix timestamp)
$REDIS_CLI ZADD "scheduler:tasks" \
    1736956800 '{"task":"send_newsletter","segment":"all_customers"}' \
    1736960400 '{"task":"update_exchange_rates","source":"api"}' \
    1736964000 '{"task":"generate_daily_report","type":"sales"}' \
    1736971200 '{"task":"cleanup_expired_carts","days":7}' \
    1737043200 '{"task":"backup_database","type":"full"}' 2>/dev/null

# Price history for product:1 (score = timestamp)
$REDIS_CLI ZADD "price:history:product:1" \
    1704067200 "3299.00" \
    1706745600 "3399.00" \
    1709251200 "3499.00" \
    1711929600 "3299.00" \
    1714521600 "3499.00" 2>/dev/null

# Order timeline (score = timestamp)
$REDIS_CLI ZADD "orders:timeline:customer:1" \
    1736524920 "order:15847" \
    1735920000 "order:15820" \
    1735315200 "order:15795" \
    1734710400 "order:15770" \
    1734105600 "order:15745" 2>/dev/null

# ============================================================================
# 6. REDIS STREAMS (Event sourcing, Message queues)
# ============================================================================
echo "[6/10] Creating Stream values..."

# Order events stream
$REDIS_CLI XADD "stream:orders" "*" \
    event "order_created" \
    order_id "15847" \
    customer_id "1" \
    total "4195.40" \
    timestamp "2025-01-10T14:22:00Z" 2>/dev/null

$REDIS_CLI XADD "stream:orders" "*" \
    event "payment_completed" \
    order_id "15847" \
    payment_method "credit_card" \
    amount "4195.40" \
    timestamp "2025-01-10T14:23:00Z" 2>/dev/null

$REDIS_CLI XADD "stream:orders" "*" \
    event "order_shipped" \
    order_id "15847" \
    carrier "fedex" \
    tracking "FX123456789" \
    timestamp "2025-01-11T09:00:00Z" 2>/dev/null

$REDIS_CLI XADD "stream:orders" "*" \
    event "order_delivered" \
    order_id "15847" \
    signed_by "Emily Chen" \
    timestamp "2025-01-13T15:30:00Z" 2>/dev/null

$REDIS_CLI XADD "stream:orders" "*" \
    event "order_created" \
    order_id "15846" \
    customer_id "3" \
    total "1520.55" \
    timestamp "2025-01-12T16:30:00Z" 2>/dev/null

$REDIS_CLI XADD "stream:orders" "*" \
    event "order_shipped" \
    order_id "15846" \
    carrier "ups" \
    tracking "1Z999AA10123456784" \
    timestamp "2025-01-13T08:00:00Z" 2>/dev/null

# Inventory events stream
$REDIS_CLI XADD "stream:inventory" "*" \
    event "stock_updated" \
    product_id "1" \
    sku "MBP-16-M3MAX" \
    old_quantity "48" \
    new_quantity "45" \
    reason "order_15847" \
    timestamp "2025-01-10T14:22:00Z" 2>/dev/null

$REDIS_CLI XADD "stream:inventory" "*" \
    event "low_stock_alert" \
    product_id "7" \
    sku "BOSE-QC45" \
    current_quantity "8" \
    reorder_level "10" \
    timestamp "2025-01-15T11:50:15Z" 2>/dev/null

$REDIS_CLI XADD "stream:inventory" "*" \
    event "restock_completed" \
    product_id "3" \
    sku "SONY-WH1000XM5" \
    quantity_added "50" \
    new_total "120" \
    timestamp "2025-01-12T08:00:00Z" 2>/dev/null

# Customer events stream
$REDIS_CLI XADD "stream:customers" "*" \
    event "customer_registered" \
    customer_id "20" \
    email "new.customer@example.com" \
    source "organic" \
    timestamp "2025-01-15T10:00:00Z" 2>/dev/null

$REDIS_CLI XADD "stream:customers" "*" \
    event "customer_verified" \
    customer_id "20" \
    method "email" \
    timestamp "2025-01-15T10:15:00Z" 2>/dev/null

$REDIS_CLI XADD "stream:customers" "*" \
    event "loyalty_tier_upgrade" \
    customer_id "2" \
    old_tier "bronze" \
    new_tier "silver" \
    points "1200" \
    timestamp "2025-01-08T00:00:00Z" 2>/dev/null

# Create consumer groups for stream processing
$REDIS_CLI XGROUP CREATE "stream:orders" "order_processors" 0 MKSTREAM 2>/dev/null
$REDIS_CLI XGROUP CREATE "stream:orders" "notification_senders" 0 MKSTREAM 2>/dev/null
$REDIS_CLI XGROUP CREATE "stream:inventory" "stock_monitors" 0 MKSTREAM 2>/dev/null

# ============================================================================
# 7. HYPERLOGLOG (Cardinality estimation)
# ============================================================================
echo "[7/10] Creating HyperLogLog values..."

# Unique visitors per day
$REDIS_CLI PFADD "hll:visitors:2025-01-15" \
    "visitor:a1b2c3" "visitor:d4e5f6" "visitor:g7h8i9" \
    "visitor:j0k1l2" "visitor:m3n4o5" "visitor:p6q7r8" \
    "visitor:s9t0u1" "visitor:v2w3x4" "visitor:y5z6a7" \
    "visitor:b8c9d0" "visitor:e1f2g3" "visitor:h4i5j6" 2>/dev/null

$REDIS_CLI PFADD "hll:visitors:2025-01-14" \
    "visitor:a1b2c3" "visitor:k7l8m9" "visitor:n0o1p2" \
    "visitor:q3r4s5" "visitor:t6u7v8" "visitor:w9x0y1" 2>/dev/null

$REDIS_CLI PFADD "hll:visitors:2025-01-13" \
    "visitor:d4e5f6" "visitor:z2a3b4" "visitor:c5d6e7" \
    "visitor:f8g9h0" "visitor:i1j2k3" 2>/dev/null

# Unique product views per product
$REDIS_CLI PFADD "hll:product:1:views" \
    "cust:1" "cust:2" "cust:3" "cust:5" "cust:7" "cust:9" "cust:12" "cust:15" \
    "guest:abc" "guest:def" "guest:ghi" "guest:jkl" 2>/dev/null

$REDIS_CLI PFADD "hll:product:3:views" \
    "cust:1" "cust:2" "cust:3" "cust:4" "cust:6" "cust:8" "cust:10" \
    "guest:mno" "guest:pqr" "guest:stu" 2>/dev/null

# Unique search queries per day
$REDIS_CLI PFADD "hll:searches:2025-01-15" \
    "macbook" "headphones" "laptop" "apple watch" "airpods" \
    "wireless earbuds" "samsung" "iphone case" "usb-c hub" "monitor" 2>/dev/null

# ============================================================================
# 8. BITMAP VALUES (Feature flags, User tracking)
# ============================================================================
echo "[8/10] Creating Bitmap values..."

# Daily active customers (bit position = customer_id)
$REDIS_CLI SETBIT "bitmap:dau:2025-01-15" 1 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-15" 2 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-15" 3 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-15" 5 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-15" 8 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-15" 12 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-15" 15 1 2>/dev/null

$REDIS_CLI SETBIT "bitmap:dau:2025-01-14" 1 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-14" 3 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-14" 7 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-14" 9 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:dau:2025-01-14" 11 1 2>/dev/null

# Feature flags per customer (bit position = feature_id)
# Features: 0=dark_mode, 1=beta_features, 2=email_notifications, 3=push_notifications, 4=2fa_enabled
$REDIS_CLI SETBIT "bitmap:features:customer:1" 0 1 2>/dev/null  # dark_mode
$REDIS_CLI SETBIT "bitmap:features:customer:1" 1 1 2>/dev/null  # beta_features
$REDIS_CLI SETBIT "bitmap:features:customer:1" 2 1 2>/dev/null  # email_notifications
$REDIS_CLI SETBIT "bitmap:features:customer:1" 4 1 2>/dev/null  # 2fa_enabled

$REDIS_CLI SETBIT "bitmap:features:customer:3" 0 0 2>/dev/null  # light_mode
$REDIS_CLI SETBIT "bitmap:features:customer:3" 2 1 2>/dev/null  # email_notifications
$REDIS_CLI SETBIT "bitmap:features:customer:3" 3 1 2>/dev/null  # push_notifications
$REDIS_CLI SETBIT "bitmap:features:customer:3" 4 1 2>/dev/null  # 2fa_enabled

# Email campaign tracking (bit = customer received/opened/clicked)
$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:sent" 1 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:sent" 2 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:sent" 3 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:sent" 5 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:sent" 7 1 2>/dev/null

$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:opened" 1 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:opened" 3 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:opened" 7 1 2>/dev/null

$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:clicked" 1 1 2>/dev/null
$REDIS_CLI SETBIT "bitmap:campaign:WINTER2025:clicked" 3 1 2>/dev/null

# ============================================================================
# 9. EDGE CASES - Special data patterns
# ============================================================================
echo "[9/10] Creating Edge Case values..."

# Unicode and emoji strings
$REDIS_CLI SET "edge:unicode:japanese" "日本語テキスト - Japanese text" 2>/dev/null
$REDIS_CLI SET "edge:unicode:chinese" "中文文本 - Chinese text" 2>/dev/null
$REDIS_CLI SET "edge:unicode:arabic" "النص العربي - Arabic text" 2>/dev/null
$REDIS_CLI SET "edge:unicode:russian" "Русский текст - Russian text" 2>/dev/null
$REDIS_CLI SET "edge:unicode:emoji" "Product rating: 5 stars" 2>/dev/null
$REDIS_CLI SET "edge:unicode:mixed" "Cafe latte with hearts" 2>/dev/null

# Special characters
$REDIS_CLI SET "edge:special:quotes" "He said \"Hello World\" and left" 2>/dev/null
$REDIS_CLI SET "edge:special:backslash" "Path: C:\\Users\\Admin\\Documents" 2>/dev/null
$REDIS_CLI SET "edge:special:newlines" "Line 1\nLine 2\nLine 3" 2>/dev/null
$REDIS_CLI SET "edge:special:tabs" "Col1\tCol2\tCol3" 2>/dev/null

# Numeric edge cases
$REDIS_CLI SET "edge:number:max_int" "9223372036854775807" 2>/dev/null
$REDIS_CLI SET "edge:number:min_int" "-9223372036854775808" 2>/dev/null
$REDIS_CLI SET "edge:number:float_precision" "3.141592653589793238" 2>/dev/null
$REDIS_CLI SET "edge:number:scientific" "1.23e-10" 2>/dev/null
$REDIS_CLI SET "edge:number:zero" "0" 2>/dev/null
$REDIS_CLI SET "edge:number:negative_zero" "-0" 2>/dev/null

# Empty and null-like values
$REDIS_CLI SET "edge:empty:string" "" 2>/dev/null
$REDIS_CLI SET "edge:empty:json_object" "{}" 2>/dev/null
$REDIS_CLI SET "edge:empty:json_array" "[]" 2>/dev/null
$REDIS_CLI SET "edge:null:literal" "null" 2>/dev/null
$REDIS_CLI SET "edge:null:undefined" "undefined" 2>/dev/null

# Very long values
LONG_STRING=$(python3 -c "print('x' * 10000)" 2>/dev/null || printf 'x%.0s' {1..10000})
$REDIS_CLI SET "edge:long:string" "$LONG_STRING" 2>/dev/null

# Binary-safe data (base64 encoded)
$REDIS_CLI SET "edge:binary:data" "SGVsbG8gV29ybGQhIFRoaXMgaXMgYmluYXJ5IHNhZmUgZGF0YS4=" 2>/dev/null

# Deeply nested JSON
$REDIS_CLI SET "edge:json:nested" '{"level1":{"level2":{"level3":{"level4":{"level5":{"value":"deep"}}}}}}' 2>/dev/null

# Large JSON array
$REDIS_CLI SET "edge:json:large_array" '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50]' 2>/dev/null

# Boolean-like strings
$REDIS_CLI SET "edge:bool:true_lower" "true" 2>/dev/null
$REDIS_CLI SET "edge:bool:true_upper" "TRUE" 2>/dev/null
$REDIS_CLI SET "edge:bool:true_mixed" "True" 2>/dev/null
$REDIS_CLI SET "edge:bool:yes" "yes" 2>/dev/null
$REDIS_CLI SET "edge:bool:one" "1" 2>/dev/null
$REDIS_CLI SET "edge:bool:false_lower" "false" 2>/dev/null
$REDIS_CLI SET "edge:bool:no" "no" 2>/dev/null
$REDIS_CLI SET "edge:bool:zero" "0" 2>/dev/null

# Date/time edge cases
$REDIS_CLI SET "edge:time:iso8601" "2025-01-15T12:30:45.123Z" 2>/dev/null
$REDIS_CLI SET "edge:time:unix_epoch" "0" 2>/dev/null
$REDIS_CLI SET "edge:time:y2k38" "2147483647" 2>/dev/null
$REDIS_CLI SET "edge:time:far_future" "4102444800" 2>/dev/null

# ============================================================================
# 10. SCALE TEST - Large data sets
# ============================================================================
echo "[10/10] Creating Scale Test values..."

# Large hash with many fields
echo "  Creating large hash (100 fields)..."
for i in $(seq 1 100); do
    $REDIS_CLI HSET "scale:large_hash" "field_$i" "value_$i" 2>/dev/null
done

# Large list
echo "  Creating large list (1000 items)..."
for i in $(seq 1 1000); do
    $REDIS_CLI RPUSH "scale:large_list" "item_$i" 2>/dev/null
done

# Large set
echo "  Creating large set (500 members)..."
for i in $(seq 1 500); do
    $REDIS_CLI SADD "scale:large_set" "member_$i" 2>/dev/null
done

# Large sorted set
echo "  Creating large sorted set (500 members)..."
for i in $(seq 1 500); do
    $REDIS_CLI ZADD "scale:large_zset" $i "member_$i" 2>/dev/null
done

# Many keys with pattern
echo "  Creating pattern keys (100 keys)..."
for i in $(seq 1 100); do
    $REDIS_CLI SET "scale:pattern:key_$i" "value_$i" 2>/dev/null
done

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "============================================================================"
echo "Redis Seeding Complete!"
echo "============================================================================"
echo ""
echo "Summary of created keys:"
echo "========================"
$REDIS_CLI DBSIZE 2>/dev/null
echo ""
echo "Keys by pattern:"
CUSTOMER_COUNT=$($REDIS_CLI KEYS 'customer:*' 2>/dev/null | wc -l | tr -d ' ')
PRODUCT_COUNT=$($REDIS_CLI KEYS 'product:*' 2>/dev/null | wc -l | tr -d ' ')
ORDER_COUNT=$($REDIS_CLI KEYS 'order:*' 2>/dev/null | wc -l | tr -d ' ')
CACHE_COUNT=$($REDIS_CLI KEYS 'cache:*' 2>/dev/null | wc -l | tr -d ' ')
QUEUE_COUNT=$($REDIS_CLI KEYS 'queue:*' 2>/dev/null | wc -l | tr -d ' ')
STREAM_COUNT=$($REDIS_CLI KEYS 'stream:*' 2>/dev/null | wc -l | tr -d ' ')
RANKING_COUNT=$($REDIS_CLI KEYS 'ranking:*' 2>/dev/null | wc -l | tr -d ' ')
EDGE_COUNT=$($REDIS_CLI KEYS 'edge:*' 2>/dev/null | wc -l | tr -d ' ')
SCALE_COUNT=$($REDIS_CLI KEYS 'scale:*' 2>/dev/null | wc -l | tr -d ' ')

echo "  customer:*  - $CUSTOMER_COUNT keys"
echo "  product:*   - $PRODUCT_COUNT keys"
echo "  order:*     - $ORDER_COUNT keys"
echo "  cache:*     - $CACHE_COUNT keys"
echo "  queue:*     - $QUEUE_COUNT keys"
echo "  stream:*    - $STREAM_COUNT keys"
echo "  ranking:*   - $RANKING_COUNT keys"
echo "  edge:*      - $EDGE_COUNT keys (edge cases)"
echo "  scale:*     - $SCALE_COUNT keys (scale tests)"
echo ""
echo "Data Structures Used:"
echo "  - Strings (sessions, config, counters, cache)"
echo "  - Hashes (customers, products, orders, carts, inventory)"
echo "  - Lists (queues, activity feeds, logs, history)"
echo "  - Sets (tags, wishlists, categories, permissions)"
echo "  - Sorted Sets (rankings, schedules, timelines)"
echo "  - Streams (order events, inventory events, customer events)"
echo "  - HyperLogLog (unique visitors, product views)"
echo "  - Bitmaps (daily active users, feature flags, campaigns)"
echo ""
echo "Ready for Query Pilot testing!"
