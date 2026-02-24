-- ============================================================================
-- Query Pilot - PostgreSQL Comprehensive Test Schema
-- ============================================================================
-- Domains: ecommerce (realistic), edge_cases (data types), scale_test (performance)
-- Features: Partitions, Indexes, Views, Materialized Views, Functions, Procedures, Triggers
-- ============================================================================

-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "hstore";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- 1. CLEANUP (Drop all objects in reverse dependency order)
-- ============================================================================
DROP TRIGGER IF EXISTS tr_orders_audit ON orders CASCADE;
DROP TRIGGER IF EXISTS tr_inventory_check ON order_items CASCADE;
DROP TRIGGER IF EXISTS tr_update_product_rating ON reviews CASCADE;
DROP TRIGGER IF EXISTS tr_customers_updated_at ON customers CASCADE;
DROP TRIGGER IF EXISTS tr_products_updated_at ON products CASCADE;

DROP FUNCTION IF EXISTS fn_update_timestamp() CASCADE;
DROP FUNCTION IF EXISTS fn_audit_order_changes() CASCADE;
DROP FUNCTION IF EXISTS fn_check_inventory() CASCADE;
DROP FUNCTION IF EXISTS fn_update_product_rating() CASCADE;
DROP FUNCTION IF EXISTS fn_get_customer_orders(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS fn_calculate_order_total(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS fn_search_products(TEXT) CASCADE;
DROP FUNCTION IF EXISTS fn_get_sales_by_category(DATE, DATE) CASCADE;

DROP PROCEDURE IF EXISTS sp_process_order(INTEGER) CASCADE;
DROP PROCEDURE IF EXISTS sp_restock_product(INTEGER, INTEGER) CASCADE;
DROP PROCEDURE IF EXISTS sp_archive_old_orders(INTEGER) CASCADE;
DROP PROCEDURE IF EXISTS sp_generate_sales_report(DATE, DATE) CASCADE;

DROP MATERIALIZED VIEW IF EXISTS mv_product_sales_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_customer_lifetime_value CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_revenue CASCADE;

DROP VIEW IF EXISTS v_order_details CASCADE;
DROP VIEW IF EXISTS v_product_inventory CASCADE;
DROP VIEW IF EXISTS v_customer_summary CASCADE;
DROP VIEW IF EXISTS v_top_selling_products CASCADE;
DROP VIEW IF EXISTS v_recent_orders CASCADE;

DROP TABLE IF EXISTS order_audit_log CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS addresses CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;

DROP TABLE IF EXISTS all_data_types CASCADE;
DROP TABLE IF EXISTS null_patterns CASCADE;
DROP TABLE IF EXISTS unicode_samples CASCADE;
DROP TABLE IF EXISTS numeric_extremes CASCADE;
DROP TABLE IF EXISTS json_documents CASCADE;
DROP TABLE IF EXISTS temporal_data CASCADE;
DROP TABLE IF EXISTS geometric_data CASCADE;
DROP TABLE IF EXISTS network_data CASCADE;

DROP TABLE IF EXISTS large_table CASCADE;
DROP TABLE IF EXISTS wide_table CASCADE;
DROP TABLE IF EXISTS empty_table CASCADE;
DROP TABLE IF EXISTS single_row_table CASCADE;

DROP TYPE IF EXISTS order_status CASCADE;
DROP TYPE IF EXISTS payment_method CASCADE;
DROP TYPE IF EXISTS address_type CASCADE;

-- ============================================================================
-- 2. CUSTOM TYPES (ENUMS)
-- ============================================================================
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE TYPE payment_method AS ENUM ('credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash', 'crypto');
CREATE TYPE address_type AS ENUM ('billing', 'shipping', 'both');

-- ============================================================================
-- 3. ECOMMERCE DOMAIN - Core Tables
-- ============================================================================

-- Customers table
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    gender CHAR(1) CHECK (gender IN ('M', 'F', 'O')),
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    loyalty_points INTEGER DEFAULT 0,
    preferences JSONB DEFAULT '{}',
    metadata HSTORE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Addresses table
CREATE TABLE addresses (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    address_type address_type NOT NULL DEFAULT 'both',
    street_line1 VARCHAR(255) NOT NULL,
    street_line2 VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100),
    postal_code VARCHAR(20) NOT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_default_per_type UNIQUE (customer_id, address_type, is_default) 
);

-- Categories table (self-referential for hierarchy)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT no_self_reference CHECK (id != parent_id)
);

-- Suppliers table
CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(100),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    address TEXT,
    country CHAR(2),
    is_active BOOLEAN DEFAULT TRUE,
    rating NUMERIC(3,2) CHECK (rating >= 0 AND rating <= 5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    cost_price NUMERIC(12,2) CHECK (cost_price >= 0),
    compare_at_price NUMERIC(12,2),
    currency CHAR(3) DEFAULT 'USD',
    weight_kg NUMERIC(8,3),
    dimensions JSONB, -- {"length": 10, "width": 5, "height": 3, "unit": "cm"}
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    is_digital BOOLEAN DEFAULT FALSE,
    tax_rate NUMERIC(5,2) DEFAULT 0,
    rating_avg NUMERIC(3,2) DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    tags TEXT[],
    attributes JSONB DEFAULT '{}',
    images JSONB DEFAULT '[]',
    search_vector TSVECTOR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Inventory table
CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_code VARCHAR(20) NOT NULL DEFAULT 'MAIN',
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    reorder_level INTEGER DEFAULT 10,
    reorder_quantity INTEGER DEFAULT 50,
    last_restocked_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_product_warehouse UNIQUE (product_id, warehouse_code),
    CONSTRAINT reserved_not_exceed_quantity CHECK (reserved_quantity <= quantity)
);

-- Orders table (PARTITIONED BY RANGE on created_at)
CREATE TABLE orders (
    id SERIAL,
    uuid UUID DEFAULT uuid_generate_v4() NOT NULL,
    order_number VARCHAR(20) NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    status order_status NOT NULL DEFAULT 'pending',
    payment_method payment_method,
    payment_status VARCHAR(20) DEFAULT 'pending',
    shipping_address_id INTEGER REFERENCES addresses(id),
    billing_address_id INTEGER REFERENCES addresses(id),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    shipping_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency CHAR(3) DEFAULT 'USD',
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    shipped_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (id, created_at),
    UNIQUE (order_number, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for orders
CREATE TABLE orders_2023 PARTITION OF orders
    FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
CREATE TABLE orders_2024 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE orders_2025 PARTITION OF orders
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE orders_2026 PARTITION OF orders
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE orders_future PARTITION OF orders
    FOR VALUES FROM ('2027-01-01') TO (MAXVALUE);

-- Order Items table
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    order_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name VARCHAR(255) NOT NULL,
    product_sku VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL,
    discount_percent NUMERIC(5,2) DEFAULT 0,
    tax_rate NUMERIC(5,2) DEFAULT 0,
    total_price NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id, order_created_at) REFERENCES orders(id, created_at) ON DELETE CASCADE
);

-- Reviews table
CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    order_id INTEGER,
    rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(255),
    content TEXT,
    pros TEXT[],
    cons TEXT[],
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    helpful_count INTEGER DEFAULT 0,
    images JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_customer_product_review UNIQUE (product_id, customer_id)
);

-- Order Audit Log table
CREATE TABLE order_audit_log (
    id BIGSERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    changed_by VARCHAR(100),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 4. EDGE CASES DOMAIN - Data Type Testing
-- ============================================================================

-- All PostgreSQL data types
CREATE TABLE all_data_types (
    id SERIAL PRIMARY KEY,
    -- Numeric types
    col_smallint SMALLINT,
    col_integer INTEGER,
    col_bigint BIGINT,
    col_decimal DECIMAL(20,10),
    col_numeric NUMERIC(20,10),
    col_real REAL,
    col_double DOUBLE PRECISION,
    col_smallserial SMALLSERIAL,
    col_serial SERIAL,
    col_bigserial BIGSERIAL,
    col_money MONEY,
    -- Character types
    col_char CHAR(10),
    col_varchar VARCHAR(255),
    col_text TEXT,
    -- Binary types
    col_bytea BYTEA,
    -- Date/Time types
    col_date DATE,
    col_time TIME,
    col_time_tz TIME WITH TIME ZONE,
    col_timestamp TIMESTAMP,
    col_timestamp_tz TIMESTAMP WITH TIME ZONE,
    col_interval INTERVAL,
    -- Boolean
    col_boolean BOOLEAN,
    -- UUID
    col_uuid UUID,
    -- Network types
    col_inet INET,
    col_cidr CIDR,
    col_macaddr MACADDR,
    col_macaddr8 MACADDR8,
    -- Geometric types
    col_point POINT,
    col_line LINE,
    col_lseg LSEG,
    col_box BOX,
    col_path PATH,
    col_polygon POLYGON,
    col_circle CIRCLE,
    -- JSON types
    col_json JSON,
    col_jsonb JSONB,
    -- Array types
    col_int_array INTEGER[],
    col_text_array TEXT[],
    col_json_array JSONB[],
    -- Range types
    col_int4range INT4RANGE,
    col_int8range INT8RANGE,
    col_numrange NUMRANGE,
    col_tsrange TSRANGE,
    col_tstzrange TSTZRANGE,
    col_daterange DATERANGE,
    -- Other types
    col_xml XML,
    col_hstore HSTORE,
    col_tsvector TSVECTOR,
    col_tsquery TSQUERY,
    col_bit BIT(8),
    col_varbit BIT VARYING(64),
    -- Custom enum
    col_order_status order_status,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- NULL pattern testing
CREATE TABLE null_patterns (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    all_null_row TEXT,
    nullable_int INTEGER,
    nullable_text TEXT,
    nullable_bool BOOLEAN,
    nullable_date DATE,
    nullable_json JSONB,
    nullable_array TEXT[],
    default_null TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Unicode and special character testing
CREATE TABLE unicode_samples (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    sample_text TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    char_count INTEGER,
    byte_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Numeric extremes testing
CREATE TABLE numeric_extremes (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    small_val SMALLINT,
    int_val INTEGER,
    big_val BIGINT,
    decimal_val DECIMAL(38,10),
    real_val REAL,
    double_val DOUBLE PRECISION,
    money_val MONEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- JSON document testing
CREATE TABLE json_documents (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    doc_json JSON,
    doc_jsonb JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Temporal data testing
CREATE TABLE temporal_data (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    date_val DATE,
    time_val TIME,
    time_tz_val TIME WITH TIME ZONE,
    ts_val TIMESTAMP,
    ts_tz_val TIMESTAMP WITH TIME ZONE,
    interval_val INTERVAL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Geometric data testing
CREATE TABLE geometric_data (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    point_val POINT,
    line_val LINE,
    lseg_val LSEG,
    box_val BOX,
    path_val PATH,
    polygon_val POLYGON,
    circle_val CIRCLE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Network data testing
CREATE TABLE network_data (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    inet_val INET,
    cidr_val CIDR,
    macaddr_val MACADDR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 5. SCALE TEST DOMAIN - Performance Testing
-- ============================================================================

-- Large table for pagination testing (will be populated with 100K+ rows)
CREATE TABLE large_table (
    id SERIAL PRIMARY KEY,
    random_int INTEGER,
    random_text VARCHAR(100),
    random_date DATE,
    random_bool BOOLEAN,
    category VARCHAR(20),
    amount NUMERIC(12,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Wide table for horizontal scroll testing (50+ columns)
CREATE TABLE wide_table (
    id SERIAL PRIMARY KEY,
    col_001 VARCHAR(50), col_002 VARCHAR(50), col_003 VARCHAR(50), col_004 VARCHAR(50), col_005 VARCHAR(50),
    col_006 VARCHAR(50), col_007 VARCHAR(50), col_008 VARCHAR(50), col_009 VARCHAR(50), col_010 VARCHAR(50),
    col_011 INTEGER, col_012 INTEGER, col_013 INTEGER, col_014 INTEGER, col_015 INTEGER,
    col_016 INTEGER, col_017 INTEGER, col_018 INTEGER, col_019 INTEGER, col_020 INTEGER,
    col_021 NUMERIC(10,2), col_022 NUMERIC(10,2), col_023 NUMERIC(10,2), col_024 NUMERIC(10,2), col_025 NUMERIC(10,2),
    col_026 BOOLEAN, col_027 BOOLEAN, col_028 BOOLEAN, col_029 BOOLEAN, col_030 BOOLEAN,
    col_031 DATE, col_032 DATE, col_033 DATE, col_034 DATE, col_035 DATE,
    col_036 TIMESTAMP, col_037 TIMESTAMP, col_038 TIMESTAMP, col_039 TIMESTAMP, col_040 TIMESTAMP,
    col_041 TEXT, col_042 TEXT, col_043 TEXT, col_044 TEXT, col_045 TEXT,
    col_046 JSONB, col_047 JSONB, col_048 JSONB, col_049 JSONB, col_050 JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Empty table for edge case testing
CREATE TABLE empty_table (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    value INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Single row table
CREATE TABLE single_row_table (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 6. INDEXES
-- ============================================================================

-- Customers indexes
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_name ON customers(last_name, first_name);
CREATE INDEX idx_customers_created_at ON customers(created_at);
CREATE INDEX idx_customers_active ON customers(is_active) WHERE is_active = TRUE;

-- Products indexes
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_supplier ON products(supplier_id);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_products_featured ON products(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_products_search ON products USING GIN(search_vector);
CREATE INDEX idx_products_tags ON products USING GIN(tags);
CREATE INDEX idx_products_attributes ON products USING GIN(attributes);

-- Orders indexes
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_number ON orders(order_number);

-- Order items indexes
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- Reviews indexes
CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_reviews_customer ON reviews(customer_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);

-- Inventory indexes
CREATE INDEX idx_inventory_product ON inventory(product_id);
CREATE INDEX idx_inventory_low_stock ON inventory(quantity) WHERE quantity <= reorder_level;

-- Large table indexes for performance testing
CREATE INDEX idx_large_table_category ON large_table(category);
CREATE INDEX idx_large_table_date ON large_table(random_date);
CREATE INDEX idx_large_table_amount ON large_table(amount);

-- ============================================================================
-- 7. VIEWS
-- ============================================================================

-- Order details view (JOIN multiple tables)
CREATE VIEW v_order_details AS
SELECT 
    o.id AS order_id,
    o.order_number,
    o.status,
    o.total_amount,
    o.created_at AS order_date,
    c.id AS customer_id,
    c.email AS customer_email,
    c.first_name || ' ' || c.last_name AS customer_name,
    COUNT(oi.id) AS item_count,
    SUM(oi.quantity) AS total_quantity
FROM orders o
JOIN customers c ON o.customer_id = c.id
LEFT JOIN order_items oi ON o.id = oi.order_id AND o.created_at = oi.order_created_at
GROUP BY o.id, o.order_number, o.status, o.total_amount, o.created_at, 
         c.id, c.email, c.first_name, c.last_name;

-- Product inventory view
CREATE VIEW v_product_inventory AS
SELECT 
    p.id AS product_id,
    p.sku,
    p.name AS product_name,
    p.price,
    cat.name AS category_name,
    COALESCE(SUM(i.quantity), 0) AS total_stock,
    COALESCE(SUM(i.reserved_quantity), 0) AS reserved_stock,
    COALESCE(SUM(i.quantity - i.reserved_quantity), 0) AS available_stock,
    p.is_active,
    CASE 
        WHEN COALESCE(SUM(i.quantity), 0) = 0 THEN 'out_of_stock'
        WHEN COALESCE(SUM(i.quantity), 0) <= MIN(i.reorder_level) THEN 'low_stock'
        ELSE 'in_stock'
    END AS stock_status
FROM products p
LEFT JOIN categories cat ON p.category_id = cat.id
LEFT JOIN inventory i ON p.id = i.product_id
GROUP BY p.id, p.sku, p.name, p.price, cat.name, p.is_active;

-- Customer summary view
CREATE VIEW v_customer_summary AS
SELECT 
    c.id AS customer_id,
    c.email,
    c.first_name || ' ' || c.last_name AS full_name,
    c.created_at AS member_since,
    COUNT(DISTINCT o.id) AS total_orders,
    COALESCE(SUM(o.total_amount), 0) AS lifetime_value,
    COALESCE(AVG(o.total_amount), 0) AS avg_order_value,
    MAX(o.created_at) AS last_order_date,
    c.loyalty_points
FROM customers c
LEFT JOIN orders o ON c.id = o.customer_id AND o.status NOT IN ('cancelled', 'refunded')
GROUP BY c.id, c.email, c.first_name, c.last_name, c.created_at, c.loyalty_points;

-- Top selling products view
CREATE VIEW v_top_selling_products AS
SELECT 
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    cat.name AS category_name,
    COUNT(DISTINCT oi.order_id) AS order_count,
    SUM(oi.quantity) AS units_sold,
    SUM(oi.total_price) AS revenue,
    p.rating_avg,
    p.rating_count
FROM products p
JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN categories cat ON p.category_id = cat.id
GROUP BY p.id, p.name, p.sku, cat.name, p.rating_avg, p.rating_count
ORDER BY revenue DESC;

-- Recent orders view
CREATE VIEW v_recent_orders AS
SELECT 
    o.id,
    o.order_number,
    o.status,
    o.total_amount,
    o.created_at,
    c.email AS customer_email,
    c.first_name || ' ' || c.last_name AS customer_name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY o.created_at DESC;

-- ============================================================================
-- 8. MATERIALIZED VIEWS
-- ============================================================================

-- Product sales summary (refreshable)
CREATE MATERIALIZED VIEW mv_product_sales_summary AS
SELECT 
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    cat.name AS category_name,
    COUNT(DISTINCT oi.order_id) AS total_orders,
    SUM(oi.quantity) AS total_units_sold,
    SUM(oi.total_price) AS total_revenue,
    AVG(oi.unit_price) AS avg_selling_price,
    MIN(o.created_at) AS first_sale_date,
    MAX(o.created_at) AS last_sale_date
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id AND oi.order_created_at = o.created_at
LEFT JOIN categories cat ON p.category_id = cat.id
GROUP BY p.id, p.name, p.sku, cat.name
WITH DATA;

CREATE UNIQUE INDEX idx_mv_product_sales_product_id ON mv_product_sales_summary(product_id);

-- Customer lifetime value (refreshable)
CREATE MATERIALIZED VIEW mv_customer_lifetime_value AS
SELECT 
    c.id AS customer_id,
    c.email,
    c.first_name,
    c.last_name,
    COUNT(DISTINCT o.id) AS order_count,
    SUM(o.total_amount) AS total_spent,
    AVG(o.total_amount) AS avg_order_value,
    MIN(o.created_at) AS first_order_date,
    MAX(o.created_at) AS last_order_date,
    EXTRACT(DAY FROM MAX(o.created_at) - MIN(o.created_at)) AS customer_lifespan_days,
    CASE 
        WHEN SUM(o.total_amount) >= 10000 THEN 'platinum'
        WHEN SUM(o.total_amount) >= 5000 THEN 'gold'
        WHEN SUM(o.total_amount) >= 1000 THEN 'silver'
        ELSE 'bronze'
    END AS customer_tier
FROM customers c
LEFT JOIN orders o ON c.id = o.customer_id AND o.status NOT IN ('cancelled', 'refunded')
GROUP BY c.id, c.email, c.first_name, c.last_name
WITH DATA;

CREATE UNIQUE INDEX idx_mv_clv_customer_id ON mv_customer_lifetime_value(customer_id);

-- Daily revenue summary
CREATE MATERIALIZED VIEW mv_daily_revenue AS
SELECT 
    DATE(o.created_at) AS order_date,
    COUNT(DISTINCT o.id) AS order_count,
    COUNT(DISTINCT o.customer_id) AS unique_customers,
    SUM(o.total_amount) AS total_revenue,
    AVG(o.total_amount) AS avg_order_value,
    SUM(o.discount_amount) AS total_discounts
FROM orders o
WHERE o.status NOT IN ('cancelled', 'refunded')
GROUP BY DATE(o.created_at)
ORDER BY order_date
WITH DATA;

CREATE UNIQUE INDEX idx_mv_daily_revenue_date ON mv_daily_revenue(order_date);

-- ============================================================================
-- 9. FUNCTIONS
-- ============================================================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Audit order changes function
CREATE OR REPLACE FUNCTION fn_audit_order_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        INSERT INTO order_audit_log (order_id, action, old_values, new_values, changed_by)
        VALUES (
            NEW.id,
            'UPDATE',
            jsonb_build_object(
                'status', OLD.status,
                'total_amount', OLD.total_amount,
                'payment_status', OLD.payment_status
            ),
            jsonb_build_object(
                'status', NEW.status,
                'total_amount', NEW.total_amount,
                'payment_status', NEW.payment_status
            ),
            current_user
        );
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO order_audit_log (order_id, action, old_values, changed_by)
        VALUES (OLD.id, 'DELETE', to_jsonb(OLD), current_user);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Check inventory function
CREATE OR REPLACE FUNCTION fn_check_inventory()
RETURNS TRIGGER AS $$
DECLARE
    available_qty INTEGER;
BEGIN
    SELECT quantity - reserved_quantity INTO available_qty
    FROM inventory
    WHERE product_id = NEW.product_id
    LIMIT 1;
    
    IF available_qty IS NULL OR available_qty < NEW.quantity THEN
        RAISE EXCEPTION 'Insufficient inventory for product %: requested %, available %',
            NEW.product_id, NEW.quantity, COALESCE(available_qty, 0);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update product rating function
CREATE OR REPLACE FUNCTION fn_update_product_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products
    SET rating_avg = (
            SELECT COALESCE(AVG(rating), 0)
            FROM reviews
            WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
            AND is_approved = TRUE
        ),
        rating_count = (
            SELECT COUNT(*)
            FROM reviews
            WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
            AND is_approved = TRUE
        )
    WHERE id = COALESCE(NEW.product_id, OLD.product_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Get customer orders function
CREATE OR REPLACE FUNCTION fn_get_customer_orders(p_customer_id INTEGER)
RETURNS TABLE (
    order_id INTEGER,
    order_number VARCHAR,
    status order_status,
    total_amount NUMERIC,
    item_count BIGINT,
    order_date TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id,
        o.order_number,
        o.status,
        o.total_amount,
        COUNT(oi.id),
        o.created_at
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id AND o.created_at = oi.order_created_at
    WHERE o.customer_id = p_customer_id
    GROUP BY o.id, o.order_number, o.status, o.total_amount, o.created_at
    ORDER BY o.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Calculate order total function
CREATE OR REPLACE FUNCTION fn_calculate_order_total(p_order_id INTEGER)
RETURNS NUMERIC AS $$
DECLARE
    v_subtotal NUMERIC;
    v_tax NUMERIC;
    v_shipping NUMERIC;
    v_discount NUMERIC;
BEGIN
    SELECT 
        COALESCE(SUM(total_price), 0),
        0, -- Simplified tax calculation
        0, -- Simplified shipping
        0  -- Simplified discount
    INTO v_subtotal, v_tax, v_shipping, v_discount
    FROM order_items
    WHERE order_id = p_order_id;
    
    RETURN v_subtotal + v_tax + v_shipping - v_discount;
END;
$$ LANGUAGE plpgsql;

-- Search products function (full-text search)
CREATE OR REPLACE FUNCTION fn_search_products(p_search_term TEXT)
RETURNS TABLE (
    product_id INTEGER,
    name VARCHAR,
    description TEXT,
    price NUMERIC,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.name,
        p.description,
        p.price,
        ts_rank(p.search_vector, plainto_tsquery('english', p_search_term)) AS rank
    FROM products p
    WHERE p.search_vector @@ plainto_tsquery('english', p_search_term)
    AND p.is_active = TRUE
    ORDER BY rank DESC;
END;
$$ LANGUAGE plpgsql;

-- Get sales by category function
CREATE OR REPLACE FUNCTION fn_get_sales_by_category(p_start_date DATE, p_end_date DATE)
RETURNS TABLE (
    category_name VARCHAR,
    order_count BIGINT,
    total_revenue NUMERIC,
    avg_order_value NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.name,
        COUNT(DISTINCT o.id),
        SUM(oi.total_price),
        AVG(oi.total_price)
    FROM categories c
    JOIN products p ON c.id = p.category_id
    JOIN order_items oi ON p.id = oi.product_id
    JOIN orders o ON oi.order_id = o.id AND oi.order_created_at = o.created_at
    WHERE o.created_at::DATE BETWEEN p_start_date AND p_end_date
    AND o.status NOT IN ('cancelled', 'refunded')
    GROUP BY c.id, c.name
    ORDER BY SUM(oi.total_price) DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. STORED PROCEDURES
-- ============================================================================

-- Process order procedure
CREATE OR REPLACE PROCEDURE sp_process_order(p_order_id INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_item RECORD;
BEGIN
    -- Update order status
    UPDATE orders
    SET status = 'processing', updated_at = CURRENT_TIMESTAMP
    WHERE id = p_order_id;
    
    -- Reserve inventory for each item
    FOR v_item IN (
        SELECT product_id, quantity
        FROM order_items
        WHERE order_id = p_order_id
    ) LOOP
        UPDATE inventory
        SET reserved_quantity = reserved_quantity + v_item.quantity,
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = v_item.product_id;
    END LOOP;
    
    COMMIT;
END;
$$;

-- Restock product procedure
CREATE OR REPLACE PROCEDURE sp_restock_product(p_product_id INTEGER, p_quantity INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE inventory
    SET quantity = quantity + p_quantity,
        last_restocked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE product_id = p_product_id;
    
    IF NOT FOUND THEN
        INSERT INTO inventory (product_id, quantity, last_restocked_at)
        VALUES (p_product_id, p_quantity, CURRENT_TIMESTAMP);
    END IF;
    
    COMMIT;
END;
$$;

-- Archive old orders procedure
CREATE OR REPLACE PROCEDURE sp_archive_old_orders(p_days_old INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_archived_count INTEGER;
BEGIN
    UPDATE orders
    SET status = 'archived'
    WHERE created_at < CURRENT_DATE - (p_days_old || ' days')::INTERVAL
    AND status IN ('delivered', 'refunded');
    
    GET DIAGNOSTICS v_archived_count = ROW_COUNT;
    
    RAISE NOTICE 'Archived % orders older than % days', v_archived_count, p_days_old;
    
    COMMIT;
END;
$$;

-- Generate sales report procedure
CREATE OR REPLACE PROCEDURE sp_generate_sales_report(p_start_date DATE, p_end_date DATE)
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_orders INTEGER;
    v_total_revenue NUMERIC;
    v_avg_order_value NUMERIC;
BEGIN
    SELECT 
        COUNT(*),
        COALESCE(SUM(total_amount), 0),
        COALESCE(AVG(total_amount), 0)
    INTO v_total_orders, v_total_revenue, v_avg_order_value
    FROM orders
    WHERE created_at::DATE BETWEEN p_start_date AND p_end_date
    AND status NOT IN ('cancelled', 'refunded');
    
    RAISE NOTICE 'Sales Report for % to %', p_start_date, p_end_date;
    RAISE NOTICE 'Total Orders: %', v_total_orders;
    RAISE NOTICE 'Total Revenue: $%', v_total_revenue;
    RAISE NOTICE 'Average Order Value: $%', ROUND(v_avg_order_value, 2);
    
    -- Refresh materialized views
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_sales_summary;
    
    COMMIT;
END;
$$;

-- ============================================================================
-- 11. TRIGGERS
-- ============================================================================

-- Update timestamp triggers
CREATE TRIGGER tr_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER tr_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- Order audit trigger
CREATE TRIGGER tr_orders_audit
    AFTER UPDATE OR DELETE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_audit_order_changes();

-- Inventory check trigger (disabled by default for seeding)
-- CREATE TRIGGER tr_inventory_check
--     BEFORE INSERT ON order_items
--     FOR EACH ROW
--     EXECUTE FUNCTION fn_check_inventory();

-- Product rating update trigger
CREATE TRIGGER tr_update_product_rating
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_product_rating();

-- ============================================================================
-- 12. COMMENTS (for documentation)
-- ============================================================================
COMMENT ON TABLE customers IS 'Customer accounts for the e-commerce platform';
COMMENT ON TABLE products IS 'Product catalog with full-text search support';
COMMENT ON TABLE orders IS 'Customer orders, partitioned by year for performance';
COMMENT ON TABLE all_data_types IS 'Test table containing all PostgreSQL data types';
COMMENT ON TABLE large_table IS 'Large table for pagination and performance testing (100K+ rows)';
COMMENT ON VIEW v_order_details IS 'Denormalized view of orders with customer info';
COMMENT ON MATERIALIZED VIEW mv_product_sales_summary IS 'Cached product sales analytics, refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_sales_summary';
COMMENT ON FUNCTION fn_search_products IS 'Full-text search function for products';
COMMENT ON PROCEDURE sp_process_order IS 'Process an order: update status and reserve inventory';
