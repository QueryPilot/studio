USE todoapp;
SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

DROP TABLE IF EXISTS order_audit_log;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS addresses;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS suppliers;

DROP TABLE IF EXISTS all_data_types;
DROP TABLE IF EXISTS null_patterns;
DROP TABLE IF EXISTS unicode_samples;
DROP TABLE IF EXISTS numeric_extremes;
DROP TABLE IF EXISTS json_documents;
DROP TABLE IF EXISTS temporal_data;
DROP TABLE IF EXISTS spatial_data;

DROP TABLE IF EXISTS large_table;
DROP TABLE IF EXISTS wide_table;
DROP TABLE IF EXISTS empty_table;
DROP TABLE IF EXISTS single_row_table;

DROP VIEW IF EXISTS v_order_details;
DROP VIEW IF EXISTS v_product_inventory;
DROP VIEW IF EXISTS v_customer_summary;
DROP VIEW IF EXISTS v_top_selling_products;
DROP VIEW IF EXISTS v_recent_orders;

DROP PROCEDURE IF EXISTS sp_process_order;
DROP PROCEDURE IF EXISTS sp_restock_product;
DROP PROCEDURE IF EXISTS sp_archive_old_orders;
DROP PROCEDURE IF EXISTS sp_generate_sales_report;

DROP FUNCTION IF EXISTS fn_calculate_order_total;
DROP FUNCTION IF EXISTS fn_get_customer_tier;
DROP FUNCTION IF EXISTS fn_format_currency;

DROP TRIGGER IF EXISTS tr_customers_before_update;
DROP TRIGGER IF EXISTS tr_products_before_update;
DROP TRIGGER IF EXISTS tr_orders_after_update;
DROP TRIGGER IF EXISTS tr_reviews_after_insert;

CREATE TABLE customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uuid CHAR(36),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    gender ENUM('M', 'F', 'O'),
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    loyalty_points INT DEFAULT 0,
    preferences JSON,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL,
    deleted_at TIMESTAMP NULL,
    INDEX idx_email (email),
    INDEX idx_name (last_name, first_name),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE addresses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    address_type ENUM('billing', 'shipping', 'both') DEFAULT 'both',
    street_line1 VARCHAR(255) NOT NULL,
    street_line2 VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100),
    postal_code VARCHAR(20) NOT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_addresses_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    INDEX idx_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parent_id INT NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_parent (parent_id),
    INDEX idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(100),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    address TEXT,
    country CHAR(2),
    is_active BOOLEAN DEFAULT TRUE,
    rating DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uuid CHAR(36),
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    category_id INT,
    supplier_id INT,
    price DECIMAL(12,2) NOT NULL CHECK (price >= 0),
    cost_price DECIMAL(12,2) CHECK (cost_price >= 0),
    compare_at_price DECIMAL(12,2),
    currency CHAR(3) DEFAULT 'USD',
    weight_kg DECIMAL(8,3),
    dimensions JSON,
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    is_digital BOOLEAN DEFAULT FALSE,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    rating_avg DECIMAL(3,2) DEFAULT 0,
    rating_count INT DEFAULT 0,
    tags JSON,
    attributes JSON,
    images JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    INDEX idx_category (category_id),
    INDEX idx_sku (sku),
    INDEX idx_price (price),
    FULLTEXT INDEX ft_search (name, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    warehouse_code VARCHAR(20) NOT NULL DEFAULT 'MAIN',
    quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    reorder_level INT DEFAULT 10,
    reorder_quantity INT DEFAULT 50,
    last_restocked_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY uk_product_warehouse (product_id, warehouse_code),
    INDEX idx_low_stock (quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE orders (
    id INT AUTO_INCREMENT,
    uuid CHAR(36),
    order_number VARCHAR(20) NOT NULL,
    customer_id INT NOT NULL,
    status ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded') DEFAULT 'pending',
    payment_method ENUM('credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash', 'crypto'),
    payment_status VARCHAR(20) DEFAULT 'pending',
    shipping_address_id INT,
    billing_address_id INT,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    shipping_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency CHAR(3) DEFAULT 'USD',
    notes TEXT,
    metadata JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    shipped_at DATETIME NULL,
    delivered_at DATETIME NULL,
    PRIMARY KEY (id, created_at),
    UNIQUE KEY uk_order_number (order_number, created_at),
    INDEX idx_customer (customer_id),
    INDEX idx_status (status),
    INDEX idx_order_number (order_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

CREATE TABLE order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    order_created_at DATETIME NOT NULL,
    product_id INT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_sku VARCHAR(50) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    total_price DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_order (order_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    customer_id INT NOT NULL,
    order_id INT,
    rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(255),
    content TEXT,
    pros JSON,
    cons JSON,
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    helpful_count INT DEFAULT 0,
    images JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    UNIQUE KEY uk_product_customer (product_id, customer_id),
    INDEX idx_rating (rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_values JSON,
    new_values JSON,
    changed_by VARCHAR(100),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE all_data_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    col_tinyint TINYINT,
    col_tinyint_unsigned TINYINT UNSIGNED,
    col_smallint SMALLINT,
    col_mediumint MEDIUMINT,
    col_int INT,
    col_bigint BIGINT,
    col_decimal DECIMAL(65,30),
    col_float FLOAT,
    col_double DOUBLE,
    col_bit BIT(64),
    col_char CHAR(255),
    col_varchar VARCHAR(1000),
    col_tinytext TINYTEXT,
    col_text TEXT,
    col_mediumtext MEDIUMTEXT,
    col_longtext LONGTEXT,
    col_binary BINARY(255),
    col_varbinary VARBINARY(1000),
    col_tinyblob TINYBLOB,
    col_blob BLOB,
    col_mediumblob MEDIUMBLOB,
    col_longblob LONGBLOB,
    col_date DATE,
    col_time TIME(6),
    col_datetime DATETIME(6),
    col_timestamp TIMESTAMP(6) NULL,
    col_year YEAR,
    col_json JSON,
    col_enum ENUM('value1', 'value2', 'value3', 'other'),
    col_set SET('a', 'b', 'c', 'd', 'e'),
    col_geometry GEOMETRY,
    col_point POINT,
    col_linestring LINESTRING,
    col_polygon POLYGON,
    col_uuid CHAR(36) DEFAULT (UUID()),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE null_patterns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    all_null_row TEXT,
    nullable_int INT,
    nullable_text TEXT,
    nullable_bool BOOLEAN,
    nullable_date DATE,
    nullable_json JSON,
    default_null TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE unicode_samples (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    sample_text TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    char_count INT,
    byte_count INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE numeric_extremes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    tiny_val TINYINT,
    small_val SMALLINT,
    int_val INT,
    big_val BIGINT,
    decimal_val DECIMAL(65,30),
    float_val FLOAT,
    double_val DOUBLE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE json_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    doc_json JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    -- Functional index removed for MariaDB compatibility
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE temporal_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    date_val DATE,
    time_val TIME(6),
    datetime_val DATETIME(6),
    timestamp_val TIMESTAMP(6) NULL,
    year_val YEAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spatial_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    point_val POINT NOT NULL,
    linestring_val LINESTRING,
    polygon_val POLYGON,
    geometry_val GEOMETRY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    SPATIAL INDEX idx_point (point_val)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE large_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    random_int INT,
    random_text VARCHAR(100),
    random_date DATE,
    random_bool BOOLEAN,
    category VARCHAR(20),
    amount DECIMAL(12,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_date (random_date),
    INDEX idx_amount (amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wide_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    col_001 VARCHAR(50), col_002 VARCHAR(50), col_003 VARCHAR(50), col_004 VARCHAR(50), col_005 VARCHAR(50),
    col_006 VARCHAR(50), col_007 VARCHAR(50), col_008 VARCHAR(50), col_009 VARCHAR(50), col_010 VARCHAR(50),
    col_011 INT, col_012 INT, col_013 INT, col_014 INT, col_015 INT,
    col_016 INT, col_017 INT, col_018 INT, col_019 INT, col_020 INT,
    col_021 DECIMAL(10,2), col_022 DECIMAL(10,2), col_023 DECIMAL(10,2), col_024 DECIMAL(10,2), col_025 DECIMAL(10,2),
    col_026 BOOLEAN, col_027 BOOLEAN, col_028 BOOLEAN, col_029 BOOLEAN, col_030 BOOLEAN,
    col_031 DATE, col_032 DATE, col_033 DATE, col_034 DATE, col_035 DATE,
    col_036 DATETIME, col_037 DATETIME, col_038 DATETIME, col_039 DATETIME, col_040 DATETIME,
    col_041 TEXT, col_042 TEXT, col_043 TEXT, col_044 TEXT, col_045 TEXT,
    col_046 JSON, col_047 JSON, col_048 JSON, col_049 JSON, col_050 JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE empty_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    value INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE single_row_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE VIEW v_order_details AS
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
FROM orders o
JOIN customers c ON o.customer_id = c.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id, o.order_number, o.status, o.total_amount, o.created_at, 
         c.id, c.email, c.first_name, c.last_name;

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

CREATE VIEW v_customer_summary AS
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
FROM customers c
LEFT JOIN orders o ON c.id = o.customer_id AND o.status NOT IN ('cancelled', 'refunded')
GROUP BY c.id, c.email, c.first_name, c.last_name, c.created_at, c.loyalty_points;

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

CREATE VIEW v_recent_orders AS
SELECT 
    o.id,
    o.order_number,
    o.status,
    o.total_amount,
    o.created_at,
    c.email AS customer_email,
    CONCAT(c.first_name, ' ', c.last_name) AS customer_name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
ORDER BY o.created_at DESC;

DELIMITER //

CREATE FUNCTION fn_calculate_order_total(p_order_id INT) 
RETURNS DECIMAL(12,2)
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(12,2);
    SELECT COALESCE(SUM(total_price), 0) INTO v_total
    FROM order_items WHERE order_id = p_order_id;
    RETURN v_total;
END //

CREATE FUNCTION fn_get_customer_tier(p_total_spent DECIMAL(12,2)) 
RETURNS VARCHAR(20)
DETERMINISTIC
BEGIN
    RETURN CASE 
        WHEN p_total_spent >= 10000 THEN 'platinum'
        WHEN p_total_spent >= 5000 THEN 'gold'
        WHEN p_total_spent >= 1000 THEN 'silver'
        ELSE 'bronze'
    END;
END //

CREATE FUNCTION fn_format_currency(p_amount DECIMAL(12,2), p_currency CHAR(3)) 
RETURNS VARCHAR(50)
DETERMINISTIC
BEGIN
    RETURN CONCAT(
        CASE p_currency
            WHEN 'USD' THEN '$'
            WHEN 'EUR' THEN '€'
            WHEN 'GBP' THEN '£'
            ELSE p_currency
        END,
        FORMAT(p_amount, 2)
    );
END //

CREATE PROCEDURE sp_process_order(IN p_order_id INT)
BEGIN
    DECLARE v_item_product_id INT;
    DECLARE v_item_quantity INT;
    DECLARE done INT DEFAULT FALSE;
    DECLARE item_cursor CURSOR FOR 
        SELECT product_id, quantity FROM order_items WHERE order_id = p_order_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    
    START TRANSACTION;
    
    UPDATE orders SET status = 'processing', updated_at = NOW() WHERE id = p_order_id;
    
    OPEN item_cursor;
    read_loop: LOOP
        FETCH item_cursor INTO v_item_product_id, v_item_quantity;
        IF done THEN LEAVE read_loop; END IF;
        
        UPDATE inventory 
        SET reserved_quantity = reserved_quantity + v_item_quantity, updated_at = NOW()
        WHERE product_id = v_item_product_id;
    END LOOP;
    CLOSE item_cursor;
    
    COMMIT;
END //

CREATE PROCEDURE sp_restock_product(IN p_product_id INT, IN p_quantity INT)
BEGIN
    INSERT INTO inventory (product_id, quantity, last_restocked_at)
    VALUES (p_product_id, p_quantity, NOW())
    ON DUPLICATE KEY UPDATE 
        quantity = quantity + p_quantity,
        last_restocked_at = NOW(),
        updated_at = NOW();
END //

CREATE PROCEDURE sp_archive_old_orders(IN p_days_old INT)
BEGIN
    DECLARE v_archived_count INT;
    
    UPDATE orders SET status = 'archived'
    WHERE created_at < DATE_SUB(CURDATE(), INTERVAL p_days_old DAY)
    AND status IN ('delivered', 'refunded');
    
    SET v_archived_count = ROW_COUNT();
    SELECT CONCAT('Archived ', v_archived_count, ' orders older than ', p_days_old, ' days') AS result;
END //

CREATE PROCEDURE sp_generate_sales_report(IN p_start_date DATE, IN p_end_date DATE)
BEGIN
    SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COALESCE(AVG(total_amount), 0) AS avg_order_value,
        COUNT(DISTINCT customer_id) AS unique_customers
    FROM orders
    WHERE DATE(created_at) BETWEEN p_start_date AND p_end_date
    AND status NOT IN ('cancelled', 'refunded');
    
    SELECT 
        DATE(created_at) AS order_date,
        COUNT(*) AS order_count,
        SUM(total_amount) AS daily_revenue
    FROM orders
    WHERE DATE(created_at) BETWEEN p_start_date AND p_end_date
    AND status NOT IN ('cancelled', 'refunded')
    GROUP BY DATE(created_at)
    ORDER BY order_date;
END //

CREATE TRIGGER tr_customers_before_update
BEFORE UPDATE ON customers
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

CREATE TRIGGER tr_products_before_update
BEFORE UPDATE ON products
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

CREATE TRIGGER tr_orders_after_update
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status OR OLD.total_amount != NEW.total_amount THEN
        INSERT INTO order_audit_log (order_id, action, old_values, new_values, changed_by)
        VALUES (
            NEW.id,
            'UPDATE',
            JSON_OBJECT('status', OLD.status, 'total_amount', OLD.total_amount),
            JSON_OBJECT('status', NEW.status, 'total_amount', NEW.total_amount),
            CURRENT_USER()
        );
    END IF;
END //

CREATE TRIGGER tr_reviews_after_insert
AFTER INSERT ON reviews
FOR EACH ROW
BEGIN
    UPDATE products 
    SET rating_avg = (SELECT AVG(rating) FROM reviews WHERE product_id = NEW.product_id AND is_approved = TRUE),
        rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = NEW.product_id AND is_approved = TRUE)
    WHERE id = NEW.product_id;
END //

DELIMITER ;

SET FOREIGN_KEY_CHECKS = 1;
