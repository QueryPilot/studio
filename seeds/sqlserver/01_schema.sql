USE master;
GO
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'todoapp')
    CREATE DATABASE todoapp;
GO
USE todoapp;
GO

IF OBJECT_ID('dbo.order_audit_log', 'U') IS NOT NULL DROP TABLE dbo.order_audit_log;
IF OBJECT_ID('dbo.order_items', 'U') IS NOT NULL DROP TABLE dbo.order_items;
IF OBJECT_ID('dbo.orders', 'U') IS NOT NULL DROP TABLE dbo.orders;
IF OBJECT_ID('dbo.reviews', 'U') IS NOT NULL DROP TABLE dbo.reviews;
IF OBJECT_ID('dbo.inventory', 'U') IS NOT NULL DROP TABLE dbo.inventory;
IF OBJECT_ID('dbo.products', 'U') IS NOT NULL DROP TABLE dbo.products;
IF OBJECT_ID('dbo.categories', 'U') IS NOT NULL DROP TABLE dbo.categories;
IF OBJECT_ID('dbo.addresses', 'U') IS NOT NULL DROP TABLE dbo.addresses;
IF OBJECT_ID('dbo.customers', 'U') IS NOT NULL DROP TABLE dbo.customers;
IF OBJECT_ID('dbo.suppliers', 'U') IS NOT NULL DROP TABLE dbo.suppliers;
IF OBJECT_ID('dbo.all_data_types', 'U') IS NOT NULL DROP TABLE dbo.all_data_types;
IF OBJECT_ID('dbo.null_patterns', 'U') IS NOT NULL DROP TABLE dbo.null_patterns;
IF OBJECT_ID('dbo.unicode_samples', 'U') IS NOT NULL DROP TABLE dbo.unicode_samples;
IF OBJECT_ID('dbo.numeric_extremes', 'U') IS NOT NULL DROP TABLE dbo.numeric_extremes;
IF OBJECT_ID('dbo.json_documents', 'U') IS NOT NULL DROP TABLE dbo.json_documents;
IF OBJECT_ID('dbo.temporal_data', 'U') IS NOT NULL DROP TABLE dbo.temporal_data;
IF OBJECT_ID('dbo.spatial_data', 'U') IS NOT NULL DROP TABLE dbo.spatial_data;
IF OBJECT_ID('dbo.large_table', 'U') IS NOT NULL DROP TABLE dbo.large_table;
IF OBJECT_ID('dbo.wide_table', 'U') IS NOT NULL DROP TABLE dbo.wide_table;
IF OBJECT_ID('dbo.empty_table', 'U') IS NOT NULL DROP TABLE dbo.empty_table;
IF OBJECT_ID('dbo.single_row_table', 'U') IS NOT NULL DROP TABLE dbo.single_row_table;

IF OBJECT_ID('dbo.v_order_details', 'V') IS NOT NULL DROP VIEW dbo.v_order_details;
IF OBJECT_ID('dbo.v_product_inventory', 'V') IS NOT NULL DROP VIEW dbo.v_product_inventory;
IF OBJECT_ID('dbo.v_customer_summary', 'V') IS NOT NULL DROP VIEW dbo.v_customer_summary;
IF OBJECT_ID('dbo.v_top_selling_products', 'V') IS NOT NULL DROP VIEW dbo.v_top_selling_products;
IF OBJECT_ID('dbo.v_recent_orders', 'V') IS NOT NULL DROP VIEW dbo.v_recent_orders;
GO

IF OBJECT_ID('dbo.fn_calculate_order_total', 'FN') IS NOT NULL DROP FUNCTION dbo.fn_calculate_order_total;
IF OBJECT_ID('dbo.fn_get_customer_tier', 'FN') IS NOT NULL DROP FUNCTION dbo.fn_get_customer_tier;
IF OBJECT_ID('dbo.fn_format_currency', 'FN') IS NOT NULL DROP FUNCTION dbo.fn_format_currency;
GO

IF OBJECT_ID('dbo.sp_process_order', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_process_order;
IF OBJECT_ID('dbo.sp_restock_product', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_restock_product;
IF OBJECT_ID('dbo.sp_archive_old_orders', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_archive_old_orders;
IF OBJECT_ID('dbo.sp_generate_sales_report', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_generate_sales_report;
GO

IF EXISTS (SELECT * FROM sys.partition_schemes WHERE name = 'ps_orders_date') DROP PARTITION SCHEME ps_orders_date;
IF EXISTS (SELECT * FROM sys.partition_functions WHERE name = 'pf_orders_date') DROP PARTITION FUNCTION pf_orders_date;
GO

CREATE PARTITION FUNCTION pf_orders_date (DATETIME2)
AS RANGE RIGHT FOR VALUES ('2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01');
GO

CREATE PARTITION SCHEME ps_orders_date
AS PARTITION pf_orders_date ALL TO ([PRIMARY]);
GO

CREATE TABLE dbo.customers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    uuid UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL,
    email NVARCHAR(255) UNIQUE NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    first_name NVARCHAR(100) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,
    phone NVARCHAR(20),
    date_of_birth DATE,
    gender CHAR(1) CHECK (gender IN ('M', 'F', 'O')),
    is_active BIT DEFAULT 1,
    is_verified BIT DEFAULT 0,
    loyalty_points INT DEFAULT 0,
    preferences NVARCHAR(MAX),
    metadata NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),
    last_login_at DATETIME2,
    deleted_at DATETIME2
);
CREATE INDEX idx_customers_email ON dbo.customers(email);
CREATE INDEX idx_customers_name ON dbo.customers(last_name, first_name);
GO

CREATE TABLE dbo.addresses (
    id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT NOT NULL,
    address_type NVARCHAR(20) DEFAULT 'both' CHECK (address_type IN ('billing', 'shipping', 'both')),
    street_line1 NVARCHAR(255) NOT NULL,
    street_line2 NVARCHAR(255),
    city NVARCHAR(100) NOT NULL,
    state NVARCHAR(100),
    postal_code NVARCHAR(20) NOT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    is_default BIT DEFAULT 0,
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT fk_addresses_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers(id) ON DELETE CASCADE
);
GO

CREATE TABLE dbo.categories (
    id INT IDENTITY(1,1) PRIMARY KEY,
    parent_id INT NULL,
    name NVARCHAR(100) NOT NULL,
    slug NVARCHAR(100) UNIQUE NOT NULL,
    description NVARCHAR(MAX),
    image_url NVARCHAR(500),
    is_active BIT DEFAULT 1,
    sort_order INT DEFAULT 0,
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES dbo.categories(id)
);
GO

CREATE TABLE dbo.suppliers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    company_name NVARCHAR(255) NOT NULL,
    contact_name NVARCHAR(100),
    contact_email NVARCHAR(255),
    contact_phone NVARCHAR(20),
    address NVARCHAR(MAX),
    country CHAR(2),
    is_active BIT DEFAULT 1,
    rating DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5),
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.products (
    id INT IDENTITY(1,1) PRIMARY KEY,
    uuid UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL,
    sku NVARCHAR(50) UNIQUE NOT NULL,
    name NVARCHAR(255) NOT NULL,
    slug NVARCHAR(255) UNIQUE NOT NULL,
    description NVARCHAR(MAX),
    short_description NVARCHAR(500),
    category_id INT,
    supplier_id INT,
    price DECIMAL(12,2) NOT NULL CHECK (price >= 0),
    cost_price DECIMAL(12,2) CHECK (cost_price >= 0),
    compare_at_price DECIMAL(12,2),
    currency CHAR(3) DEFAULT 'USD',
    weight_kg DECIMAL(8,3),
    dimensions NVARCHAR(MAX),
    is_active BIT DEFAULT 1,
    is_featured BIT DEFAULT 0,
    is_digital BIT DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    rating_avg DECIMAL(3,2) DEFAULT 0,
    rating_count INT DEFAULT 0,
    tags NVARCHAR(MAX),
    attributes NVARCHAR(MAX),
    images NVARCHAR(MAX),
    xml_data XML,
    hierarchy_path HIERARCHYID,
    geography_location GEOGRAPHY,
    geometry_shape GEOMETRY,
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES dbo.categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.suppliers(id) ON DELETE SET NULL
);
CREATE INDEX idx_products_category ON dbo.products(category_id);
CREATE INDEX idx_products_sku ON dbo.products(sku);
CREATE INDEX idx_products_price ON dbo.products(price);
GO

CREATE TABLE dbo.inventory (
    id INT IDENTITY(1,1) PRIMARY KEY,
    product_id INT NOT NULL,
    warehouse_code NVARCHAR(20) NOT NULL DEFAULT 'MAIN',
    quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    reorder_level INT DEFAULT 10,
    reorder_quantity INT DEFAULT 50,
    last_restocked_at DATETIME2,
    updated_at DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES dbo.products(id) ON DELETE CASCADE,
    CONSTRAINT uk_product_warehouse UNIQUE (product_id, warehouse_code)
);
GO

CREATE TABLE dbo.orders (
    id INT IDENTITY(1,1) NOT NULL,
    uuid UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL,
    order_number NVARCHAR(20) NOT NULL,
    customer_id INT NOT NULL,
    status NVARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
    payment_method NVARCHAR(20) CHECK (payment_method IN ('credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash', 'crypto')),
    payment_status NVARCHAR(20) DEFAULT 'pending',
    shipping_address_id INT,
    billing_address_id INT,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    shipping_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency CHAR(3) DEFAULT 'USD',
    notes NVARCHAR(MAX),
    metadata NVARCHAR(MAX),
    ip_address NVARCHAR(45),
    user_agent NVARCHAR(MAX),
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),
    shipped_at DATETIME2,
    delivered_at DATETIME2,
    CONSTRAINT pk_orders PRIMARY KEY CLUSTERED (id, created_at)
) ON ps_orders_date(created_at);
CREATE INDEX idx_orders_customer ON dbo.orders(customer_id) ON ps_orders_date(created_at);
CREATE INDEX idx_orders_status ON dbo.orders(status) ON ps_orders_date(created_at);
CREATE UNIQUE INDEX idx_orders_number ON dbo.orders(order_number, created_at) ON ps_orders_date(created_at);
GO

CREATE TABLE dbo.order_items (
    id INT IDENTITY(1,1) PRIMARY KEY,
    order_id INT NOT NULL,
    order_created_at DATETIME2 NOT NULL,
    product_id INT NOT NULL,
    product_name NVARCHAR(255) NOT NULL,
    product_sku NVARCHAR(50) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    total_price DECIMAL(12,2) NOT NULL,
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES dbo.products(id)
);
CREATE INDEX idx_order_items_order ON dbo.order_items(order_id);
GO

CREATE TABLE dbo.reviews (
    id INT IDENTITY(1,1) PRIMARY KEY,
    product_id INT NOT NULL,
    customer_id INT NOT NULL,
    order_id INT,
    rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title NVARCHAR(255),
    content NVARCHAR(MAX),
    pros NVARCHAR(MAX),
    cons NVARCHAR(MAX),
    is_verified_purchase BIT DEFAULT 0,
    is_approved BIT DEFAULT 0,
    helpful_count INT DEFAULT 0,
    images NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES dbo.products(id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers(id) ON DELETE CASCADE,
    CONSTRAINT uk_product_customer UNIQUE (product_id, customer_id)
);
GO

CREATE TABLE dbo.order_audit_log (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    order_id INT NOT NULL,
    action NVARCHAR(20) NOT NULL,
    old_values NVARCHAR(MAX),
    new_values NVARCHAR(MAX),
    changed_by NVARCHAR(100),
    changed_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.all_data_types (
    id INT IDENTITY(1,1) PRIMARY KEY,
    col_bit BIT,
    col_tinyint TINYINT,
    col_smallint SMALLINT,
    col_int INT,
    col_bigint BIGINT,
    col_decimal DECIMAL(38,18),
    col_numeric NUMERIC(38,18),
    col_float FLOAT,
    col_real REAL,
    col_money MONEY,
    col_smallmoney SMALLMONEY,
    col_char CHAR(100),
    col_varchar VARCHAR(MAX),
    col_nchar NCHAR(100),
    col_nvarchar NVARCHAR(MAX),
    col_text TEXT,
    col_ntext NTEXT,
    col_binary BINARY(100),
    col_varbinary VARBINARY(MAX),
    col_image IMAGE,
    col_date DATE,
    col_time TIME(7),
    col_datetime DATETIME,
    col_datetime2 DATETIME2(7),
    col_datetimeoffset DATETIMEOFFSET(7),
    col_smalldatetime SMALLDATETIME,
    col_uniqueidentifier UNIQUEIDENTIFIER,
    col_xml XML,
    col_hierarchyid HIERARCHYID,
    col_geography GEOGRAPHY,
    col_geometry GEOMETRY,
    col_sql_variant SQL_VARIANT,
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.null_patterns (
    id INT IDENTITY(1,1) PRIMARY KEY,
    description NVARCHAR(100) NOT NULL,
    all_null_row NVARCHAR(MAX),
    nullable_int INT,
    nullable_text NVARCHAR(MAX),
    nullable_bool BIT,
    nullable_date DATE,
    nullable_json NVARCHAR(MAX),
    default_null NVARCHAR(MAX) DEFAULT NULL,
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.unicode_samples (
    id INT IDENTITY(1,1) PRIMARY KEY,
    description NVARCHAR(100) NOT NULL,
    sample_text NVARCHAR(MAX) NOT NULL,
    category NVARCHAR(50) NOT NULL,
    char_count INT,
    byte_count INT,
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.numeric_extremes (
    id INT IDENTITY(1,1) PRIMARY KEY,
    description NVARCHAR(100) NOT NULL,
    tiny_val TINYINT,
    small_val SMALLINT,
    int_val INT,
    big_val BIGINT,
    decimal_val DECIMAL(38,18),
    float_val FLOAT,
    real_val REAL,
    money_val MONEY,
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.json_documents (
    id INT IDENTITY(1,1) PRIMARY KEY,
    description NVARCHAR(100) NOT NULL,
    doc_json NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.temporal_data (
    id INT IDENTITY(1,1) PRIMARY KEY,
    description NVARCHAR(100) NOT NULL,
    date_val DATE,
    time_val TIME(7),
    datetime_val DATETIME,
    datetime2_val DATETIME2(7),
    datetimeoffset_val DATETIMEOFFSET(7),
    smalldatetime_val SMALLDATETIME,
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.spatial_data (
    id INT IDENTITY(1,1) PRIMARY KEY,
    description NVARCHAR(100) NOT NULL,
    geography_point GEOGRAPHY,
    geometry_point GEOMETRY,
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.large_table (
    id INT IDENTITY(1,1) PRIMARY KEY,
    random_int INT,
    random_text NVARCHAR(100),
    random_date DATE,
    random_bool BIT,
    category NVARCHAR(20),
    amount DECIMAL(12,2),
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
CREATE INDEX idx_large_table_category ON dbo.large_table(category);
CREATE INDEX idx_large_table_date ON dbo.large_table(random_date);
GO

CREATE TABLE dbo.wide_table (
    id INT IDENTITY(1,1) PRIMARY KEY,
    col_001 NVARCHAR(50), col_002 NVARCHAR(50), col_003 NVARCHAR(50), col_004 NVARCHAR(50), col_005 NVARCHAR(50),
    col_006 NVARCHAR(50), col_007 NVARCHAR(50), col_008 NVARCHAR(50), col_009 NVARCHAR(50), col_010 NVARCHAR(50),
    col_011 INT, col_012 INT, col_013 INT, col_014 INT, col_015 INT,
    col_016 INT, col_017 INT, col_018 INT, col_019 INT, col_020 INT,
    col_021 DECIMAL(10,2), col_022 DECIMAL(10,2), col_023 DECIMAL(10,2), col_024 DECIMAL(10,2), col_025 DECIMAL(10,2),
    col_026 BIT, col_027 BIT, col_028 BIT, col_029 BIT, col_030 BIT,
    col_031 DATE, col_032 DATE, col_033 DATE, col_034 DATE, col_035 DATE,
    col_036 DATETIME2, col_037 DATETIME2, col_038 DATETIME2, col_039 DATETIME2, col_040 DATETIME2,
    col_041 NVARCHAR(MAX), col_042 NVARCHAR(MAX), col_043 NVARCHAR(MAX), col_044 NVARCHAR(MAX), col_045 NVARCHAR(MAX),
    col_046 NVARCHAR(MAX), col_047 NVARCHAR(MAX), col_048 NVARCHAR(MAX), col_049 NVARCHAR(MAX), col_050 NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.empty_table (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100),
    value INT,
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.single_row_table (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    description NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

CREATE VIEW dbo.v_order_details AS
SELECT 
    o.id AS order_id,
    o.order_number,
    o.status,
    o.total_amount,
    o.created_at AS order_date,
    c.id AS customer_id,
    c.email AS customer_email,
    CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
    COUNT(oi.id) AS item_count,
    SUM(oi.quantity) AS total_quantity
FROM dbo.orders o
JOIN dbo.customers c ON o.customer_id = c.id
LEFT JOIN dbo.order_items oi ON o.id = oi.order_id
GROUP BY o.id, o.order_number, o.status, o.total_amount, o.created_at, 
         c.id, c.email, c.first_name, c.last_name;
GO

CREATE VIEW dbo.v_product_inventory AS
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
FROM dbo.products p
LEFT JOIN dbo.categories cat ON p.category_id = cat.id
LEFT JOIN dbo.inventory i ON p.id = i.product_id
GROUP BY p.id, p.sku, p.name, p.price, cat.name, p.is_active;
GO

CREATE VIEW dbo.v_customer_summary AS
SELECT 
    c.id AS customer_id,
    c.email,
    CONCAT(c.first_name, ' ', c.last_name) AS full_name,
    c.created_at AS member_since,
    COUNT(DISTINCT o.id) AS total_orders,
    COALESCE(SUM(o.total_amount), 0) AS lifetime_value,
    COALESCE(AVG(o.total_amount), 0) AS avg_order_value,
    MAX(o.created_at) AS last_order_date,
    c.loyalty_points
FROM dbo.customers c
LEFT JOIN dbo.orders o ON c.id = o.customer_id AND o.status NOT IN ('cancelled', 'refunded')
GROUP BY c.id, c.email, c.first_name, c.last_name, c.created_at, c.loyalty_points;
GO

CREATE VIEW dbo.v_top_selling_products AS
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
FROM dbo.products p
JOIN dbo.order_items oi ON p.id = oi.product_id
LEFT JOIN dbo.categories cat ON p.category_id = cat.id
GROUP BY p.id, p.name, p.sku, cat.name, p.rating_avg, p.rating_count;
GO

CREATE VIEW dbo.v_recent_orders AS
SELECT 
    o.id,
    o.order_number,
    o.status,
    o.total_amount,
    o.created_at,
    c.email AS customer_email,
    CONCAT(c.first_name, ' ', c.last_name) AS customer_name
FROM dbo.orders o
JOIN dbo.customers c ON o.customer_id = c.id
WHERE o.created_at >= DATEADD(DAY, -30, GETDATE());
GO

CREATE FUNCTION dbo.fn_calculate_order_total(@order_id INT)
RETURNS DECIMAL(12,2)
AS
BEGIN
    DECLARE @total DECIMAL(12,2);
    SELECT @total = COALESCE(SUM(total_price), 0) FROM dbo.order_items WHERE order_id = @order_id;
    RETURN @total;
END;
GO

CREATE FUNCTION dbo.fn_get_customer_tier(@total_spent DECIMAL(12,2))
RETURNS NVARCHAR(20)
AS
BEGIN
    RETURN CASE 
        WHEN @total_spent >= 10000 THEN 'platinum'
        WHEN @total_spent >= 5000 THEN 'gold'
        WHEN @total_spent >= 1000 THEN 'silver'
        ELSE 'bronze'
    END;
END;
GO

CREATE FUNCTION dbo.fn_format_currency(@amount DECIMAL(12,2), @currency CHAR(3))
RETURNS NVARCHAR(50)
AS
BEGIN
    RETURN CONCAT(
        CASE @currency
            WHEN 'USD' THEN '$'
            WHEN 'EUR' THEN N'€'
            WHEN 'GBP' THEN N'£'
            ELSE @currency + ' '
        END,
        FORMAT(@amount, 'N2')
    );
END;
GO

CREATE PROCEDURE dbo.sp_process_order @order_id INT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    
    UPDATE dbo.orders SET status = 'processing', updated_at = SYSDATETIME() WHERE id = @order_id;
    
    UPDATE i SET 
        i.reserved_quantity = i.reserved_quantity + oi.quantity,
        i.updated_at = SYSDATETIME()
    FROM dbo.inventory i
    JOIN dbo.order_items oi ON i.product_id = oi.product_id
    WHERE oi.order_id = @order_id;
    
    COMMIT TRANSACTION;
END;
GO

CREATE PROCEDURE dbo.sp_restock_product @product_id INT, @quantity INT
AS
BEGIN
    SET NOCOUNT ON;
    
    MERGE dbo.inventory AS target
    USING (SELECT @product_id AS product_id, @quantity AS quantity) AS source
    ON target.product_id = source.product_id AND target.warehouse_code = 'MAIN'
    WHEN MATCHED THEN
        UPDATE SET quantity = target.quantity + source.quantity, last_restocked_at = SYSDATETIME(), updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (product_id, warehouse_code, quantity, last_restocked_at) VALUES (source.product_id, 'MAIN', source.quantity, SYSDATETIME());
END;
GO

CREATE PROCEDURE dbo.sp_archive_old_orders @days_old INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @archived_count INT;
    
    UPDATE dbo.orders SET status = 'archived'
    WHERE created_at < DATEADD(DAY, -@days_old, GETDATE())
    AND status IN ('delivered', 'refunded');
    
    SET @archived_count = @@ROWCOUNT;
    SELECT CONCAT('Archived ', @archived_count, ' orders older than ', @days_old, ' days') AS result;
END;
GO

CREATE PROCEDURE dbo.sp_generate_sales_report @start_date DATE, @end_date DATE
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COALESCE(AVG(total_amount), 0) AS avg_order_value,
        COUNT(DISTINCT customer_id) AS unique_customers
    FROM dbo.orders
    WHERE CAST(created_at AS DATE) BETWEEN @start_date AND @end_date
    AND status NOT IN ('cancelled', 'refunded');
    
    SELECT 
        CAST(created_at AS DATE) AS order_date,
        COUNT(*) AS order_count,
        SUM(total_amount) AS daily_revenue
    FROM dbo.orders
    WHERE CAST(created_at AS DATE) BETWEEN @start_date AND @end_date
    AND status NOT IN ('cancelled', 'refunded')
    GROUP BY CAST(created_at AS DATE)
    ORDER BY order_date;
END;
GO

CREATE TRIGGER dbo.tr_customers_updated
ON dbo.customers
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE c SET updated_at = SYSDATETIME()
    FROM dbo.customers c
    INNER JOIN inserted i ON c.id = i.id;
END;
GO

CREATE TRIGGER dbo.tr_orders_audit
ON dbo.orders
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.order_audit_log (order_id, action, old_values, new_values, changed_by)
    SELECT 
        i.id,
        'UPDATE',
        (SELECT d.status, d.total_amount, d.payment_status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
        (SELECT i.status, i.total_amount, i.payment_status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
        SYSTEM_USER
    FROM inserted i
    JOIN deleted d ON i.id = d.id
    WHERE i.status != d.status OR i.total_amount != d.total_amount;
END;
GO

PRINT 'SQL Server schema created successfully';
GO
