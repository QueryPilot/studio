#!/usr/bin/env python3
"""
Query Pilot - SQLite Comprehensive Test Database Seeder
Domains: ecommerce (realistic), edge_cases (data types), scale_test (performance)
Features: Views, Triggers, FTS5, JSON functions, comprehensive data types
"""

import sqlite3
import random
import json
import datetime
import os
from typing import List, Tuple, Any

DB_PATH = "query_pilot_test.db"

REALISTIC_CUSTOMERS = [
    ("Emily", "Chen", "emily.chen@techcorp.io", "+1-415-555-0123", "1990-03-15", "F"),
    (
        "Marcus",
        "Rodriguez",
        "marcus.rodriguez@startup.co",
        "+1-512-555-0456",
        "1985-07-22",
        "M",
    ),
    (
        "Sarah",
        "Johnson",
        "sarah.johnson@enterprise.com",
        "+1-212-555-0789",
        "1978-11-08",
        "F",
    ),
    (
        "James",
        "Williams",
        "james.williams@consulting.net",
        "+1-617-555-0321",
        "1982-05-30",
        "M",
    ),
    ("Akira", "Tanaka", "akira.tanaka@design.jp", "+81-3-5555-0123", "1992-09-14", "M"),
    ("Priya", "Sharma", "priya.sharma@tech.in", "+91-22-5555-0456", "1988-12-03", "F"),
    (
        "Michael",
        "Brown",
        "michael.brown@finance.com",
        "+1-312-555-0654",
        "1975-04-18",
        "M",
    ),
    (
        "Olivia",
        "Martinez",
        "olivia.martinez@creative.studio",
        "+1-305-555-0321",
        "1995-08-25",
        "F",
    ),
    ("David", "Kim", "david.kim@software.dev", "+1-206-555-0987", "1987-02-11", "M"),
    (
        "Sophie",
        "Mueller",
        "sophie.mueller@agency.de",
        "+49-30-5555-0123",
        "1991-06-29",
        "F",
    ),
    (
        "Alexander",
        "Petrov",
        "alex.petrov@tech.ru",
        "+7-495-555-0456",
        "1983-10-07",
        "M",
    ),
    (
        "Isabella",
        "Costa",
        "isabella.costa@media.br",
        "+55-11-5555-0789",
        "1993-01-19",
        "F",
    ),
    (
        "William",
        "Thompson",
        "william.t@legal.com",
        "+1-404-555-0147",
        "1970-08-12",
        "M",
    ),
    (
        "Emma",
        "Anderson",
        "emma.anderson@health.org",
        "+1-503-555-0258",
        "1989-04-05",
        "F",
    ),
    ("Lucas", "Garcia", "lucas.garcia@edu.mx", "+52-55-5555-0369", "1994-11-23", "M"),
    ("Mia", "Wilson", "mia.wilson@retail.com", "+1-702-555-0741", "1986-07-16", "F"),
    ("Benjamin", "Lee", "benjamin.lee@invest.hk", "+852-5555-0852", "1979-03-28", "M"),
    (
        "Charlotte",
        "Taylor",
        "charlotte.t@nonprofit.org",
        "+1-202-555-0963",
        "1991-12-09",
        "F",
    ),
    (
        "Daniel",
        "Martin",
        "daniel.martin@engineering.uk",
        "+44-20-5555-0174",
        "1984-06-21",
        "M",
    ),
    ("Ava", "Jackson", "ava.jackson@arts.edu", "+1-213-555-0285", "1996-02-14", "F"),
]

PRODUCTS = [
    (
        "MBP-16-M3MAX",
        "MacBook Pro 16-inch M3 Max",
        3499.00,
        2800.00,
        2,
        "laptop,apple,professional",
    ),
    ("DELL-XPS15", "Dell XPS 15 OLED", 1899.00, 1500.00, 2, "laptop,dell,windows"),
    (
        "SONY-WH1000XM5",
        "Sony WH-1000XM5 Headphones",
        349.99,
        220.00,
        3,
        "headphones,sony,wireless",
    ),
    (
        "THINKPAD-X1C",
        "Lenovo ThinkPad X1 Carbon Gen 11",
        1649.00,
        1300.00,
        2,
        "laptop,lenovo,business",
    ),
    (
        "IPAD-PRO-12",
        "iPad Pro 12.9-inch M2",
        1099.00,
        850.00,
        2,
        "tablet,apple,professional",
    ),
    (
        "APPLE-WATCH-ULTRA2",
        "Apple Watch Ultra 2",
        799.00,
        550.00,
        4,
        "smartwatch,apple,fitness",
    ),
    (
        "BOSE-QC45",
        "Bose QuietComfort 45",
        279.00,
        180.00,
        3,
        "headphones,bose,noise-cancelling",
    ),
    ("AIRPODS-MAX", "Apple AirPods Max", 549.00, 380.00, 3, "headphones,apple,premium"),
    (
        "HERMAN-AERON",
        "Herman Miller Aeron Chair",
        1395.00,
        900.00,
        5,
        "office,chair,ergonomic",
    ),
    (
        "SECRETLAB-TITAN",
        "Secretlab Titan Evo 2022",
        519.00,
        350.00,
        5,
        "gaming,chair,ergonomic",
    ),
    (
        "SAMSUNG-ODYSSEY",
        "Samsung Odyssey G9 49-inch",
        1299.99,
        950.00,
        2,
        "monitor,samsung,gaming",
    ),
    ("DYSON-V15", "Dyson V15 Detect Vacuum", 749.99, 480.00, 5, "vacuum,dyson,home"),
    (
        "KINDLE-PAPERWHITE",
        "Kindle Paperwhite 11th Gen",
        139.99,
        90.00,
        2,
        "ereader,amazon,portable",
    ),
    (
        "GALAXY-WATCH6",
        "Samsung Galaxy Watch 6 Classic",
        429.99,
        280.00,
        4,
        "smartwatch,samsung,health",
    ),
    (
        "AIRPODS-PRO2",
        "Apple AirPods Pro 2nd Gen",
        249.00,
        160.00,
        3,
        "earbuds,apple,wireless",
    ),
    (
        "LOGITECH-MX",
        "Logitech MX Master 3S",
        99.99,
        65.00,
        2,
        "mouse,logitech,ergonomic",
    ),
    (
        "KEYCHRON-K8",
        "Keychron K8 Pro Wireless Keyboard",
        174.00,
        110.00,
        2,
        "keyboard,mechanical,wireless",
    ),
]

CATEGORIES = [
    (None, "Electronics", "electronics", True),
    (1, "Computers", "computers", True),
    (1, "Audio", "audio", True),
    (1, "Wearables", "wearables", True),
    (None, "Home & Garden", "home-garden", True),
    (None, "Office", "office", True),
]

SUPPLIERS = [
    ("Apple Inc.", "Tim Cook", "supplier@apple.com", "+1-408-996-1010", "US", 4.9),
    (
        "Sony Corporation",
        "Kenichiro Yoshida",
        "partners@sony.jp",
        "+81-3-6748-2111",
        "JP",
        4.7,
    ),
    (
        "Dell Technologies",
        "Michael Dell",
        "partners@dell.com",
        "+1-800-289-3355",
        "US",
        4.5,
    ),
    (
        "Samsung Electronics",
        "Jong-Hee Han",
        "partners@samsung.kr",
        "+82-2-2255-0114",
        "KR",
        4.6,
    ),
    (
        "Herman Miller",
        "Andi Owen",
        "sales@hermanmiller.com",
        "+1-888-443-4357",
        "US",
        4.8,
    ),
    ("Dyson Ltd", "Jake Dyson", "business@dyson.com", "+44-800-298-0298", "GB", 4.4),
    (
        "Lenovo Group",
        "Yuanqing Yang",
        "partners@lenovo.com",
        "+86-10-5886-8888",
        "CN",
        4.3,
    ),
]

ORDER_STATUSES = [
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "refunded",
]
PAYMENT_METHODS = ["credit_card", "debit_card", "paypal", "bank_transfer", "apple_pay"]


def create_schema(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")

    cursor.executescript("""
        DROP TABLE IF EXISTS order_items;
        DROP TABLE IF EXISTS orders;
        DROP TABLE IF EXISTS reviews;
        DROP TABLE IF EXISTS inventory;
        DROP TABLE IF EXISTS products;
        DROP TABLE IF EXISTS categories;
        DROP TABLE IF EXISTS addresses;
        DROP TABLE IF EXISTS customers;
        DROP TABLE IF EXISTS suppliers;
        DROP TABLE IF EXISTS order_audit_log;
        
        DROP TABLE IF EXISTS all_data_types;
        DROP TABLE IF EXISTS null_patterns;
        DROP TABLE IF EXISTS unicode_samples;
        DROP TABLE IF EXISTS numeric_extremes;
        DROP TABLE IF EXISTS json_documents;
        
        DROP TABLE IF EXISTS large_table;
        DROP TABLE IF EXISTS wide_table;
        DROP TABLE IF EXISTS empty_table;
        DROP TABLE IF EXISTS single_row_table;
        
        DROP VIEW IF EXISTS v_order_details;
        DROP VIEW IF EXISTS v_product_inventory;
        DROP VIEW IF EXISTS v_customer_summary;
        DROP VIEW IF EXISTS v_top_selling_products;
        DROP VIEW IF EXISTS v_recent_orders;
        
        DROP TRIGGER IF EXISTS tr_customers_updated_at;
        DROP TRIGGER IF EXISTS tr_products_updated_at;
        DROP TRIGGER IF EXISTS tr_orders_audit;
        DROP TRIGGER IF EXISTS tr_update_product_rating;
        DROP TRIGGER IF EXISTS tr_inventory_check;
    """)

    cursor.execute("""
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL DEFAULT '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYA',
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            phone TEXT,
            date_of_birth DATE,
            gender TEXT CHECK (gender IN ('M', 'F', 'O')),
            is_active INTEGER DEFAULT 1,
            is_verified INTEGER DEFAULT 0,
            loyalty_points INTEGER DEFAULT 0,
            preferences TEXT DEFAULT '{}',
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP,
            deleted_at TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE addresses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            address_type TEXT NOT NULL DEFAULT 'both' CHECK (address_type IN ('billing', 'shipping', 'both')),
            street_line1 TEXT NOT NULL,
            street_line2 TEXT,
            city TEXT NOT NULL,
            state TEXT,
            postal_code TEXT NOT NULL,
            country TEXT NOT NULL DEFAULT 'US',
            is_default INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        )
    """)

    cursor.execute("""
        CREATE TABLE categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id INTEGER,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT,
            image_url TEXT,
            is_active INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
            CHECK (id != parent_id)
        )
    """)

    cursor.execute("""
        CREATE TABLE suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT NOT NULL,
            contact_name TEXT,
            contact_email TEXT,
            contact_phone TEXT,
            address TEXT,
            country TEXT,
            is_active INTEGER DEFAULT 1,
            rating REAL CHECK (rating >= 0 AND rating <= 5),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
            sku TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT,
            short_description TEXT,
            category_id INTEGER,
            supplier_id INTEGER,
            price REAL NOT NULL CHECK (price >= 0),
            cost_price REAL CHECK (cost_price >= 0),
            compare_at_price REAL,
            currency TEXT DEFAULT 'USD',
            weight_kg REAL,
            dimensions TEXT,
            is_active INTEGER DEFAULT 1,
            is_featured INTEGER DEFAULT 0,
            is_digital INTEGER DEFAULT 0,
            tax_rate REAL DEFAULT 0,
            rating_avg REAL DEFAULT 0,
            rating_count INTEGER DEFAULT 0,
            tags TEXT,
            attributes TEXT DEFAULT '{}',
            images TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            warehouse_code TEXT NOT NULL DEFAULT 'MAIN',
            quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
            reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
            reorder_level INTEGER DEFAULT 10,
            reorder_quantity INTEGER DEFAULT 50,
            last_restocked_at TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            UNIQUE (product_id, warehouse_code),
            CHECK (reserved_quantity <= quantity)
        )
    """)

    cursor.execute("""
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
            customer_id INTEGER NOT NULL,
            order_number TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
            subtotal REAL NOT NULL DEFAULT 0,
            tax_amount REAL NOT NULL DEFAULT 0,
            shipping_amount REAL NOT NULL DEFAULT 0,
            discount_amount REAL NOT NULL DEFAULT 0,
            total_amount REAL NOT NULL DEFAULT 0,
            currency TEXT DEFAULT 'USD',
            payment_method TEXT CHECK (payment_method IN ('credit_card', 'debit_card', 'paypal', 'bank_transfer', 'apple_pay', 'crypto')),
            payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
            shipping_address TEXT,
            billing_address TEXT,
            notes TEXT,
            shipped_at TIMESTAMP,
            delivered_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        )
    """)

    cursor.execute("""
        CREATE TABLE order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
            unit_price REAL NOT NULL,
            discount_percent REAL DEFAULT 0,
            total_price REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
        )
    """)

    cursor.execute("""
        CREATE TABLE reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            title TEXT,
            content TEXT,
            is_verified_purchase INTEGER DEFAULT 0,
            is_featured INTEGER DEFAULT 0,
            helpful_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        )
    """)

    cursor.execute("""
        CREATE TABLE order_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            old_status TEXT,
            new_status TEXT,
            changed_by TEXT,
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            notes TEXT,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )
    """)

    cursor.execute("""
        CREATE TABLE all_data_types (
            id INTEGER PRIMARY KEY,
            int_col INTEGER,
            real_col REAL,
            text_col TEXT,
            blob_col BLOB,
            numeric_col NUMERIC,
            boolean_col INTEGER,
            date_col DATE,
            datetime_col DATETIME,
            timestamp_col TIMESTAMP,
            json_col TEXT,
            null_col TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE null_patterns (
            id INTEGER PRIMARY KEY,
            all_null_text TEXT,
            all_null_int INTEGER,
            all_null_real REAL,
            sparse_text TEXT,
            sparse_int INTEGER,
            never_null_text TEXT NOT NULL DEFAULT 'default',
            never_null_int INTEGER NOT NULL DEFAULT 0
        )
    """)

    cursor.execute("""
        CREATE TABLE unicode_samples (
            id INTEGER PRIMARY KEY,
            language_name TEXT,
            sample_text TEXT,
            description TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE numeric_extremes (
            id INTEGER PRIMARY KEY,
            description TEXT,
            int_value INTEGER,
            real_value REAL,
            text_value TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE json_documents (
            id INTEGER PRIMARY KEY,
            doc_type TEXT,
            document TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE large_table (
            id INTEGER PRIMARY KEY,
            uuid TEXT,
            random_int INTEGER,
            random_real REAL,
            random_text TEXT,
            category TEXT,
            is_active INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE wide_table (
            id INTEGER PRIMARY KEY,
            col_01 TEXT, col_02 TEXT, col_03 TEXT, col_04 TEXT, col_05 TEXT,
            col_06 TEXT, col_07 TEXT, col_08 TEXT, col_09 TEXT, col_10 TEXT,
            col_11 INTEGER, col_12 INTEGER, col_13 INTEGER, col_14 INTEGER, col_15 INTEGER,
            col_16 INTEGER, col_17 INTEGER, col_18 INTEGER, col_19 INTEGER, col_20 INTEGER,
            col_21 REAL, col_22 REAL, col_23 REAL, col_24 REAL, col_25 REAL,
            col_26 REAL, col_27 REAL, col_28 REAL, col_29 REAL, col_30 REAL,
            col_31 DATE, col_32 DATE, col_33 DATE, col_34 DATE, col_35 DATE,
            col_36 TIMESTAMP, col_37 TIMESTAMP, col_38 TIMESTAMP, col_39 TIMESTAMP, col_40 TIMESTAMP,
            col_41 TEXT, col_42 TEXT, col_43 TEXT, col_44 TEXT, col_45 TEXT,
            col_46 INTEGER, col_47 INTEGER, col_48 INTEGER, col_49 INTEGER, col_50 INTEGER
        )
    """)

    cursor.execute(
        "CREATE TABLE empty_table (id INTEGER PRIMARY KEY, name TEXT, value REAL)"
    )

    cursor.execute(
        "CREATE TABLE single_row_table (id INTEGER PRIMARY KEY, name TEXT, value REAL)"
    )

    cursor.execute("CREATE INDEX idx_customers_email ON customers(email)")
    cursor.execute(
        "CREATE INDEX idx_customers_name ON customers(last_name, first_name)"
    )
    cursor.execute("CREATE INDEX idx_products_sku ON products(sku)")
    cursor.execute("CREATE INDEX idx_products_category ON products(category_id)")
    cursor.execute("CREATE INDEX idx_products_price ON products(price)")
    cursor.execute("CREATE INDEX idx_orders_customer ON orders(customer_id)")
    cursor.execute("CREATE INDEX idx_orders_status ON orders(status)")
    cursor.execute("CREATE INDEX idx_orders_created ON orders(created_at)")
    cursor.execute("CREATE INDEX idx_order_items_order ON order_items(order_id)")
    cursor.execute("CREATE INDEX idx_order_items_product ON order_items(product_id)")
    cursor.execute("CREATE INDEX idx_reviews_product ON reviews(product_id)")
    cursor.execute("CREATE INDEX idx_reviews_customer ON reviews(customer_id)")
    cursor.execute("CREATE INDEX idx_large_table_category ON large_table(category)")
    cursor.execute("CREATE INDEX idx_large_table_created ON large_table(created_at)")

    cursor.execute("""
        CREATE VIEW v_order_details AS
        SELECT 
            o.id AS order_id,
            o.order_number,
            o.status,
            o.total_amount,
            o.payment_method,
            o.created_at AS order_date,
            c.first_name || ' ' || c.last_name AS customer_name,
            c.email AS customer_email,
            COUNT(oi.id) AS item_count,
            SUM(oi.quantity) AS total_quantity
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        GROUP BY o.id, o.order_number, o.status, o.total_amount, o.payment_method, o.created_at,
                 c.first_name, c.last_name, c.email
    """)

    cursor.execute("""
        CREATE VIEW v_product_inventory AS
        SELECT 
            p.id AS product_id,
            p.sku,
            p.name,
            p.price,
            p.rating_avg,
            i.warehouse_code,
            i.quantity AS stock_quantity,
            i.reserved_quantity,
            i.quantity - i.reserved_quantity AS available_quantity,
            CASE 
                WHEN i.quantity <= i.reorder_level THEN 'LOW'
                WHEN i.quantity <= i.reorder_level * 2 THEN 'MEDIUM'
                ELSE 'HIGH'
            END AS stock_status,
            c.name AS category_name
        FROM products p
        JOIN inventory i ON p.id = i.product_id
        LEFT JOIN categories c ON p.category_id = c.id
    """)

    cursor.execute("""
        CREATE VIEW v_customer_summary AS
        SELECT 
            c.id AS customer_id,
            c.first_name || ' ' || c.last_name AS full_name,
            c.email,
            c.loyalty_points,
            COUNT(DISTINCT o.id) AS total_orders,
            COALESCE(SUM(o.total_amount), 0) AS lifetime_value,
            MAX(o.created_at) AS last_order_date,
            CASE 
                WHEN SUM(o.total_amount) >= 10000 THEN 'Platinum'
                WHEN SUM(o.total_amount) >= 5000 THEN 'Gold'
                WHEN SUM(o.total_amount) >= 1000 THEN 'Silver'
                ELSE 'Bronze'
            END AS customer_tier
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id AND o.status != 'cancelled'
        GROUP BY c.id, c.first_name, c.last_name, c.email, c.loyalty_points
    """)

    cursor.execute("""
        CREATE VIEW v_top_selling_products AS
        SELECT 
            p.id AS product_id,
            p.sku,
            p.name,
            p.price,
            p.rating_avg,
            COUNT(DISTINCT oi.order_id) AS order_count,
            SUM(oi.quantity) AS total_sold,
            SUM(oi.total_price) AS total_revenue
        FROM products p
        JOIN order_items oi ON p.id = oi.product_id
        JOIN orders o ON oi.order_id = o.id AND o.status NOT IN ('cancelled', 'refunded')
        GROUP BY p.id, p.sku, p.name, p.price, p.rating_avg
        ORDER BY total_revenue DESC
    """)

    cursor.execute("""
        CREATE VIEW v_recent_orders AS
        SELECT 
            o.id,
            o.order_number,
            o.status,
            o.total_amount,
            o.payment_method,
            o.created_at,
            c.first_name || ' ' || c.last_name AS customer_name,
            c.email,
            julianday('now') - julianday(o.created_at) AS days_ago
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE o.created_at >= datetime('now', '-30 days')
        ORDER BY o.created_at DESC
    """)

    cursor.execute("""
        CREATE TRIGGER tr_customers_updated_at
        AFTER UPDATE ON customers
        FOR EACH ROW
        BEGIN
            UPDATE customers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
    """)

    cursor.execute("""
        CREATE TRIGGER tr_products_updated_at
        AFTER UPDATE ON products
        FOR EACH ROW
        BEGIN
            UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
    """)

    cursor.execute("""
        CREATE TRIGGER tr_orders_audit
        AFTER UPDATE OF status ON orders
        FOR EACH ROW
        WHEN OLD.status != NEW.status
        BEGIN
            INSERT INTO order_audit_log (order_id, old_status, new_status, changed_by, notes)
            VALUES (NEW.id, OLD.status, NEW.status, 'system', 'Status changed via trigger');
        END
    """)

    cursor.execute("""
        CREATE TRIGGER tr_update_product_rating
        AFTER INSERT ON reviews
        FOR EACH ROW
        BEGIN
            UPDATE products SET 
                rating_avg = (SELECT AVG(rating) FROM reviews WHERE product_id = NEW.product_id),
                rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = NEW.product_id)
            WHERE id = NEW.product_id;
        END
    """)

    cursor.execute("""
        CREATE TRIGGER tr_inventory_check
        BEFORE INSERT ON order_items
        FOR EACH ROW
        BEGIN
            SELECT CASE
                WHEN (SELECT quantity - reserved_quantity FROM inventory WHERE product_id = NEW.product_id AND warehouse_code = 'MAIN') < NEW.quantity
                THEN RAISE(ABORT, 'Insufficient inventory for product')
            END;
        END
    """)

    cursor.executescript("""
        DROP TABLE IF EXISTS products_fts;
        CREATE VIRTUAL TABLE products_fts USING fts5(
            name,
            description,
            tags,
            content=products,
            content_rowid=id
        );
    """)

    cursor.execute("""
        CREATE TRIGGER tr_products_fts_insert
        AFTER INSERT ON products
        BEGIN
            INSERT INTO products_fts(rowid, name, description, tags)
            VALUES (NEW.id, NEW.name, NEW.description, NEW.tags);
        END
    """)

    cursor.execute("""
        CREATE TRIGGER tr_products_fts_delete
        AFTER DELETE ON products
        BEGIN
            DELETE FROM products_fts WHERE rowid = OLD.id;
        END
    """)

    cursor.execute("""
        CREATE TRIGGER tr_products_fts_update
        AFTER UPDATE ON products
        BEGIN
            UPDATE products_fts 
            SET name = NEW.name, description = NEW.description, tags = NEW.tags
            WHERE rowid = NEW.id;
        END
    """)

    conn.commit()


def seed_data(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()

    for supplier in SUPPLIERS:
        cursor.execute(
            """
            INSERT INTO suppliers (company_name, contact_name, contact_email, contact_phone, country, rating)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            supplier,
        )

    for parent_id, name, slug, is_active in CATEGORIES:
        cursor.execute(
            """
            INSERT INTO categories (parent_id, name, slug, is_active)
            VALUES (?, ?, ?, ?)
        """,
            (parent_id, name, slug, is_active),
        )

    for i, (first, last, email, phone, dob, gender) in enumerate(
        REALISTIC_CUSTOMERS, 1
    ):
        loyalty = random.randint(0, 5000)
        is_verified = 1 if random.random() > 0.2 else 0
        prefs = json.dumps(
            {
                "theme": random.choice(["light", "dark"]),
                "notifications": random.choice([True, False]),
            }
        )
        last_login = (
            datetime.datetime.now() - datetime.timedelta(days=random.randint(0, 30))
        ).isoformat()

        cursor.execute(
            """
            INSERT INTO customers (email, first_name, last_name, phone, date_of_birth, gender, 
                                   is_verified, loyalty_points, preferences, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                email,
                first,
                last,
                phone,
                dob,
                gender,
                is_verified,
                loyalty,
                prefs,
                last_login,
            ),
        )

    for i, (sku, name, price, cost, cat_id, tags) in enumerate(PRODUCTS, 1):
        slug = name.lower().replace(" ", "-").replace(".", "")[:50]
        desc = f"Premium {name}. High-quality product with excellent features and modern design."
        short_desc = f"Premium {name} with advanced features."
        supplier_id = random.randint(1, len(SUPPLIERS))
        is_featured = 1 if random.random() > 0.7 else 0
        weight = round(random.uniform(0.1, 20.0), 2)
        dimensions = json.dumps(
            {
                "length": random.randint(5, 50),
                "width": random.randint(5, 40),
                "height": random.randint(2, 30),
            }
        )

        cursor.execute(
            """
            INSERT INTO products (sku, name, slug, description, short_description, category_id, 
                                  supplier_id, price, cost_price, is_featured, weight_kg, dimensions, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                sku,
                name,
                slug,
                desc,
                short_desc,
                cat_id,
                supplier_id,
                price,
                cost,
                is_featured,
                weight,
                dimensions,
                tags,
            ),
        )

    for prod_id in range(1, len(PRODUCTS) + 1):
        qty = random.randint(20, 200)
        reserved = random.randint(0, min(10, qty))
        cursor.execute(
            """
            INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level)
            VALUES (?, 'MAIN', ?, ?, ?)
        """,
            (prod_id, qty, reserved, random.randint(5, 20)),
        )

    order_id = 0
    for i in range(500):
        customer_id = random.randint(1, len(REALISTIC_CUSTOMERS))
        status = random.choice(ORDER_STATUSES)
        payment = random.choice(PAYMENT_METHODS)
        order_num = f"ORD-{datetime.datetime.now().year}-{10000 + i}"

        days_ago = random.randint(0, 365)
        created = datetime.datetime.now() - datetime.timedelta(days=days_ago)

        shipped = (
            created + datetime.timedelta(days=random.randint(1, 3))
            if status in ["shipped", "delivered"]
            else None
        )
        delivered = (
            shipped + datetime.timedelta(days=random.randint(1, 5))
            if status == "delivered" and shipped is not None
            else None
        )

        cursor.execute(
            """
            INSERT INTO orders (customer_id, order_number, status, payment_method, 
                               shipped_at, delivered_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (
                customer_id,
                order_num,
                status,
                payment,
                shipped.isoformat() if shipped else None,
                delivered.isoformat() if delivered else None,
                created.isoformat(),
            ),
        )
        order_id = cursor.lastrowid

        item_count = random.randint(1, 4)
        subtotal = 0.0
        for _ in range(item_count):
            prod_id = random.randint(1, len(PRODUCTS))
            qty = random.randint(1, 3)
            price = PRODUCTS[prod_id - 1][2]
            discount = random.choice([0, 5, 10, 15]) if random.random() > 0.7 else 0
            item_total = price * qty * (1 - discount / 100)
            subtotal += item_total

            cursor.execute(
                """
                INSERT INTO order_items (order_id, product_id, quantity, unit_price, discount_percent, total_price)
                VALUES (?, ?, ?, ?, ?, ?)
            """,
                (order_id, prod_id, qty, price, discount, item_total),
            )

        tax = round(subtotal * 0.09, 2)
        shipping = 0 if subtotal >= 50 else 9.99
        total = round(subtotal + tax + shipping, 2)

        cursor.execute(
            """
            UPDATE orders SET subtotal = ?, tax_amount = ?, shipping_amount = ?, total_amount = ?
            WHERE id = ?
        """,
            (round(subtotal, 2), tax, shipping, total, order_id),
        )

    review_comments = [
        "Excellent product! Exceeded my expectations.",
        "Great value for money. Highly recommended.",
        "Good quality but shipping took longer than expected.",
        "Perfect for my needs. Would buy again.",
        "Solid product, works as described.",
        "Amazing quality and fast delivery!",
        "Not quite what I expected, but still decent.",
        "Best purchase I've made this year!",
        "Works great, very happy with it.",
        "Good product, minor issues with packaging.",
    ]

    for _ in range(200):
        prod_id = random.randint(1, len(PRODUCTS))
        cust_id = random.randint(1, len(REALISTIC_CUSTOMERS))
        rating = random.choices([1, 2, 3, 4, 5], weights=[5, 5, 15, 35, 40])[0]
        comment = random.choice(review_comments)
        is_verified = 1 if random.random() > 0.3 else 0

        cursor.execute(
            """
            INSERT INTO reviews (product_id, customer_id, rating, title, content, is_verified_purchase)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            (prod_id, cust_id, rating, f"{rating}-star review", comment, is_verified),
        )

    cursor.executemany(
        """
        INSERT INTO all_data_types (id, int_col, real_col, text_col, blob_col, numeric_col, 
                                    boolean_col, date_col, datetime_col, timestamp_col, json_col, null_col)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        [
            (
                1,
                42,
                3.14159,
                "Hello World",
                b"\x00\x01\x02\xff",
                99.99,
                1,
                "2025-01-15",
                "2025-01-15 10:30:00",
                "2025-01-15T10:30:00Z",
                '{"key": "value"}',
                None,
            ),
            (
                2,
                -2147483648,
                -999999.999999,
                "Unicode: café ☕",
                b"binary\x00data",
                0.001,
                0,
                "1970-01-01",
                "1970-01-01 00:00:00",
                "1970-01-01T00:00:00Z",
                "[]",
                None,
            ),
            (
                3,
                2147483647,
                1e308,
                "",
                None,
                -0.001,
                1,
                "2099-12-31",
                "2099-12-31 23:59:59",
                "2099-12-31T23:59:59Z",
                "{}",
                None,
            ),
            (
                4,
                0,
                0.0,
                "Tab\there\nNewline",
                b"",
                0,
                0,
                None,
                None,
                None,
                "null",
                None,
            ),
            (5, None, None, None, None, None, None, None, None, None, None, None),
        ],
    )

    for i in range(1, 21):
        cursor.execute(
            """
            INSERT INTO null_patterns (id, sparse_text, sparse_int, never_null_text, never_null_int)
            VALUES (?, ?, ?, ?, ?)
        """,
            (
                i,
                f"text_{i}" if i % 3 == 0 else None,
                i * 10 if i % 2 == 0 else None,
                f"required_{i}",
                i,
            ),
        )

    unicode_samples = [
        ("English", "Hello, World!", "Basic ASCII"),
        ("Japanese", "こんにちは世界", "Hiragana/Kanji"),
        ("Chinese", "你好世界", "Simplified Chinese"),
        ("Korean", "안녕하세요 세계", "Hangul"),
        ("Arabic", "مرحبا بالعالم", "Right-to-left"),
        ("Russian", "Привет мир", "Cyrillic"),
        ("Greek", "Γειά σου Κόσμε", "Greek alphabet"),
        ("Hebrew", "שלום עולם", "Right-to-left"),
        ("Thai", "สวัสดีโลก", "Thai script"),
        ("Emoji", "Hello World! 🌍🚀✨", "Mixed emoji"),
        ("Math", "∑∏∫∂∇ε∈∉∞", "Mathematical symbols"),
        ("Special", "Line1\nLine2\tTabbed", "Control characters"),
    ]
    for i, (lang, text, desc) in enumerate(unicode_samples, 1):
        cursor.execute(
            "INSERT INTO unicode_samples (id, language_name, sample_text, description) VALUES (?, ?, ?, ?)",
            (i, lang, text, desc),
        )

    numeric_data = [
        ("Max int64", 9223372036854775807, None, "9223372036854775807"),
        ("Min int64", -9223372036854775808, None, "-9223372036854775808"),
        ("Pi", None, 3.141592653589793, "3.141592653589793"),
        ("Zero", 0, 0.0, "0"),
        ("Negative zero", 0, -0.0, "-0.0"),
        ("Very small", None, 1e-308, "1e-308"),
        ("Very large", None, 1e308, "1e308"),
        ("Infinity text", None, None, "Infinity"),
        ("NaN text", None, None, "NaN"),
    ]
    for i, (desc, int_val, real_val, text_val) in enumerate(numeric_data, 1):
        cursor.execute(
            "INSERT INTO numeric_extremes (id, description, int_value, real_value, text_value) VALUES (?, ?, ?, ?, ?)",
            (i, desc, int_val, real_val, text_val),
        )

    json_docs = [
        ("simple", '{"name": "John", "age": 30}'),
        (
            "nested",
            '{"user": {"profile": {"name": "Jane", "settings": {"theme": "dark"}}}}',
        ),
        ("array", '[1, 2, 3, "four", 5.0, null, true, false]'),
        (
            "complex",
            '{"items": [{"id": 1, "tags": ["a", "b"]}, {"id": 2, "tags": ["c"]}], "meta": {"total": 2}}',
        ),
        ("empty_object", "{}"),
        ("empty_array", "[]"),
        ("null", "null"),
        ("special_chars", '{"message": "Hello\\nWorld\\t!"}'),
    ]
    cursor.executemany(
        "INSERT INTO json_documents (doc_type, document) VALUES (?, ?)", json_docs
    )

    print("  Inserting 100,000 rows into large_table...")
    categories = ["A", "B", "C", "D", "E"]
    batch_size = 10000
    for batch in range(10):
        rows = []
        for i in range(batch * batch_size + 1, (batch + 1) * batch_size + 1):
            uuid_val = f"{i:08x}-{random.randint(0, 0xFFFF):04x}-4{random.randint(0, 0xFFF):03x}-{random.choice(['8', '9', 'a', 'b'])}{random.randint(0, 0xFFF):03x}-{random.randint(0, 0xFFFFFFFFFFFF):012x}"
            rows.append(
                (
                    i,
                    uuid_val,
                    random.randint(-1000000, 1000000),
                    random.uniform(-1000000, 1000000),
                    f"Row {i} - " + "x" * random.randint(10, 100),
                    random.choice(categories),
                    random.randint(0, 1),
                )
            )
        cursor.executemany(
            """
            INSERT INTO large_table (id, uuid, random_int, random_real, random_text, category, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            rows,
        )
        print(f"    Batch {batch + 1}/10 complete ({(batch + 1) * batch_size} rows)")

    print("  Inserting 100 rows into wide_table...")
    for i in range(1, 101):
        cols: List[Any] = [i]
        for j in range(10):
            cols.append(f"text_{i}_{j}")
        for j in range(10):
            cols.append(random.randint(0, 10000))
        for j in range(10):
            cols.append(round(random.uniform(0, 1000), 4))
        for j in range(5):
            cols.append(
                (
                    datetime.date.today()
                    - datetime.timedelta(days=random.randint(0, 365))
                ).isoformat()
            )
        for j in range(5):
            cols.append(
                (
                    datetime.datetime.now()
                    - datetime.timedelta(days=random.randint(0, 365))
                ).isoformat()
            )
        for j in range(5):
            cols.append(json.dumps({"row": i, "col": j}))
        for j in range(5):
            cols.append(random.randint(0, 1))

        placeholders = ", ".join(["?"] * 51)
        cursor.execute(f"INSERT INTO wide_table VALUES ({placeholders})", cols)

    cursor.execute(
        "INSERT INTO single_row_table (id, name, value) VALUES (1, 'Only Row', 42.0)"
    )

    conn.commit()


def main():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Removed existing database: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    print(f"Creating SQLite database: {DB_PATH}")

    try:
        create_schema(conn)
        print("Schema created successfully")

        seed_data(conn)

        cursor = conn.cursor()
        stats = {}
        for table in [
            "customers",
            "products",
            "orders",
            "order_items",
            "reviews",
            "inventory",
            "categories",
            "suppliers",
            "large_table",
            "wide_table",
            "unicode_samples",
        ]:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            stats[table] = cursor.fetchone()[0]

        print("\nDatabase Statistics:")
        print("=" * 40)
        for table, count in stats.items():
            print(f"  {table}: {count:,} rows")

        print("\nDatabase Objects Created:")
        print(
            "  - 5 Views (v_order_details, v_product_inventory, v_customer_summary, v_top_selling_products, v_recent_orders)"
        )
        print(
            "  - 8 Triggers (timestamp updates, audit log, rating updates, inventory check, FTS sync)"
        )
        print("  - 1 FTS5 Virtual Table (products_fts)")
        print("  - 14 Indexes")
        print(f"\nReady for Query Pilot testing!")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
