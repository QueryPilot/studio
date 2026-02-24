-- ============================================================================
-- Query Pilot - MySQL Seed Data
-- ============================================================================
-- SECURITY NOTE: All credentials in this file are for DEVELOPMENT ONLY.
-- The password hash '$2b$12$LQv3c1yqBwEHbNkZxK7Uru' is a bcrypt placeholder.
-- NEVER use these values in production environments.
-- ============================================================================

USE todoapp;
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('alice.johnson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Alice', 'Johnson', '+1-555-0101', '1985-03-15', 'F', true, true, 2500, '{"theme": "dark", "newsletter": true, "language": "en"}', '{"tier": "gold", "source": "organic"}', DATE_SUB(NOW(), INTERVAL 2 HOUR)),
('bob.smith@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Bob', 'Smith', '+1-555-0102', '1990-07-22', 'M', true, true, 1200, '{"theme": "light", "newsletter": false, "language": "en"}', '{"tier": "silver", "source": "referral"}', DATE_SUB(NOW(), INTERVAL 1 DAY)),
('carol.williams@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Carol', 'Williams', '+1-555-0103', '1978-11-08', 'F', true, false, 500, '{"theme": "auto", "newsletter": true, "language": "es"}', '{"tier": "bronze", "source": "ads"}', DATE_SUB(NOW(), INTERVAL 5 DAY)),
('david.brown@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'David', 'Brown', '+1-555-0104', '1995-01-30', 'M', true, true, 8500, '{"theme": "dark", "newsletter": true, "language": "en"}', '{"tier": "platinum", "source": "organic"}', DATE_SUB(NOW(), INTERVAL 30 MINUTE)),
('emma.davis@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Emma', 'Davis', '+1-555-0105', '1988-09-12', 'F', true, true, 3200, '{"theme": "light", "newsletter": false, "language": "fr"}', '{"tier": "gold", "source": "social"}', DATE_SUB(NOW(), INTERVAL 3 HOUR)),
('frank.miller@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Frank', 'Miller', '+1-555-0106', '1982-04-25', 'M', false, true, 150, '{"theme": "dark", "newsletter": false, "language": "en"}', '{"tier": "bronze", "source": "organic"}', DATE_SUB(NOW(), INTERVAL 60 DAY)),
('grace.wilson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Grace', 'Wilson', '+1-555-0107', '1992-12-03', 'F', true, true, 4100, '{"theme": "auto", "newsletter": true, "language": "de"}', '{"tier": "gold", "source": "referral"}', DATE_SUB(NOW(), INTERVAL 6 HOUR)),
('henry.moore@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Henry', 'Moore', '+1-555-0108', '1975-06-18', 'M', true, false, 750, '{"theme": "light", "newsletter": true, "language": "en"}', '{"tier": "silver", "source": "ads"}', DATE_SUB(NOW(), INTERVAL 2 DAY)),
('ivy.taylor@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Ivy', 'Taylor', '+1-555-0109', '1998-02-14', 'F', true, true, 1800, '{"theme": "dark", "newsletter": true, "language": "en"}', '{"tier": "silver", "source": "organic"}', DATE_SUB(NOW(), INTERVAL 12 HOUR)),
('jack.anderson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Jack', 'Anderson', '+1-555-0110', '1987-08-07', 'M', true, true, 950, '{"theme": "auto", "newsletter": false, "language": "ja"}', '{"tier": "bronze", "source": "social"}', DATE_SUB(NOW(), INTERVAL 4 DAY)),
('karen.thomas@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Karen', 'Thomas', '+1-555-0111', '1993-05-21', 'F', true, true, 6200, '{"theme": "dark", "newsletter": true, "language": "en"}', '{"tier": "platinum", "source": "organic"}', DATE_SUB(NOW(), INTERVAL 1 HOUR)),
('leo.jackson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Leo', 'Jackson', '+1-555-0112', '1980-10-09', 'M', true, true, 2100, '{"theme": "light", "newsletter": true, "language": "en"}', '{"tier": "gold", "source": "referral"}', DATE_SUB(NOW(), INTERVAL 18 HOUR)),
('mia.white@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Mia', 'White', '+1-555-0113', '1996-07-28', 'F', true, false, 320, '{"theme": "dark", "newsletter": false, "language": "pt"}', '{"tier": "bronze", "source": "ads"}', DATE_SUB(NOW(), INTERVAL 7 DAY)),
('noah.harris@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Noah', 'Harris', '+1-555-0114', '1984-03-16', 'M', true, true, 4800, '{"theme": "auto", "newsletter": true, "language": "en"}', '{"tier": "gold", "source": "organic"}', DATE_SUB(NOW(), INTERVAL 5 HOUR)),
('olivia.martin@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Olivia', 'Martin', '+1-555-0115', '1991-11-24', 'F', true, true, 1500, '{"theme": "light", "newsletter": true, "language": "it"}', '{"tier": "silver", "source": "social"}', DATE_SUB(NOW(), INTERVAL 2 DAY)),
('peter.garcia@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Peter', 'Garcia', '+1-555-0116', '1977-09-05', 'M', false, true, 50, '{"theme": "dark", "newsletter": false, "language": "en"}', '{"tier": "bronze", "source": "organic"}', NULL),
('quinn.martinez@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Quinn', 'Martinez', '+1-555-0117', '1999-01-11', 'O', true, true, 2800, '{"theme": "auto", "newsletter": true, "language": "en"}', '{"tier": "gold", "source": "referral"}', DATE_SUB(NOW(), INTERVAL 45 MINUTE)),
('rachel.robinson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Rachel', 'Robinson', '+1-555-0118', '1986-06-30', 'F', true, true, 5500, '{"theme": "dark", "newsletter": true, "language": "en"}', '{"tier": "platinum", "source": "organic"}', DATE_SUB(NOW(), INTERVAL 3 HOUR)),
('sam.clark@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Sam', 'Clark', '+1-555-0119', '1994-04-17', 'M', true, false, 680, '{"theme": "light", "newsletter": false, "language": "ko"}', '{"tier": "bronze", "source": "ads"}', DATE_SUB(NOW(), INTERVAL 10 DAY)),
('tina.rodriguez@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Tina', 'Rodriguez', '+1-555-0120', '1983-12-22', 'F', true, true, 3900, '{"theme": "dark", "newsletter": true, "language": "en"}', '{"tier": "gold", "source": "social"}', DATE_SUB(NOW(), INTERVAL 8 HOUR));

INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES
(1, 'both', '123 Main Street', 'Apt 4B', 'New York', 'NY', '10001', 'US', true),
(1, 'shipping', '456 Office Park', 'Suite 100', 'New York', 'NY', '10002', 'US', false),
(2, 'both', '789 Oak Avenue', NULL, 'Los Angeles', 'CA', '90001', 'US', true),
(3, 'billing', '321 Pine Road', NULL, 'Chicago', 'IL', '60601', 'US', true),
(3, 'shipping', '654 Elm Street', 'Unit 5', 'Chicago', 'IL', '60602', 'US', false),
(4, 'both', '987 Cedar Lane', NULL, 'Houston', 'TX', '77001', 'US', true),
(5, 'both', '147 Maple Drive', 'Floor 2', 'Phoenix', 'AZ', '85001', 'US', true),
(6, 'both', '258 Birch Court', NULL, 'Philadelphia', 'PA', '19101', 'US', true),
(7, 'both', '369 Walnut Way', 'Apt 12', 'San Antonio', 'TX', '78201', 'US', true),
(8, 'both', '741 Cherry Boulevard', NULL, 'San Diego', 'CA', '92101', 'US', true),
(9, 'both', '852 Spruce Street', 'Suite 300', 'Dallas', 'TX', '75201', 'US', true),
(10, 'both', '963 Ash Avenue', NULL, 'San Jose', 'CA', '95101', 'US', true);

INSERT INTO categories (parent_id, name, slug, description, image_url, is_active, sort_order) VALUES
(NULL, 'Electronics', 'electronics', 'Electronic devices and accessories', 'https://cdn.example.com/categories/electronics.jpg', true, 1),
(NULL, 'Clothing', 'clothing', 'Apparel and fashion items', 'https://cdn.example.com/categories/clothing.jpg', true, 2),
(NULL, 'Home & Garden', 'home-garden', 'Home improvement and garden supplies', 'https://cdn.example.com/categories/home-garden.jpg', true, 3),
(NULL, 'Sports & Outdoors', 'sports-outdoors', 'Sports equipment and outdoor gear', 'https://cdn.example.com/categories/sports.jpg', true, 4),
(NULL, 'Books & Media', 'books-media', 'Books, music, and movies', 'https://cdn.example.com/categories/books.jpg', true, 5),
(1, 'Smartphones', 'smartphones', 'Mobile phones and accessories', 'https://cdn.example.com/categories/smartphones.jpg', true, 1),
(1, 'Laptops', 'laptops', 'Laptop computers and accessories', 'https://cdn.example.com/categories/laptops.jpg', true, 2),
(1, 'Audio', 'audio', 'Headphones, speakers, and audio equipment', 'https://cdn.example.com/categories/audio.jpg', true, 3),
(1, 'Cameras', 'cameras', 'Digital cameras and photography equipment', 'https://cdn.example.com/categories/cameras.jpg', true, 4),
(1, 'Gaming', 'gaming', 'Video games and gaming accessories', 'https://cdn.example.com/categories/gaming.jpg', true, 5),
(2, 'Men\'s Clothing', 'mens-clothing', 'Clothing for men', 'https://cdn.example.com/categories/mens.jpg', true, 1),
(2, 'Women\'s Clothing', 'womens-clothing', 'Clothing for women', 'https://cdn.example.com/categories/womens.jpg', true, 2),
(2, 'Shoes', 'shoes', 'Footwear for all', 'https://cdn.example.com/categories/shoes.jpg', true, 4),
(3, 'Furniture', 'furniture', 'Home furniture', 'https://cdn.example.com/categories/furniture.jpg', true, 1),
(3, 'Kitchen', 'kitchen', 'Kitchen appliances and tools', 'https://cdn.example.com/categories/kitchen.jpg', true, 2);

INSERT INTO suppliers (company_name, contact_name, contact_email, contact_phone, address, country, is_active, rating) VALUES
('TechWorld Inc.', 'John Tech', 'john@techworld.com', '+1-800-TECH-001', '100 Silicon Valley Blvd, San Jose, CA 95110', 'US', true, 4.75),
('Fashion Forward Ltd.', 'Maria Style', 'maria@fashionforward.com', '+1-800-FASH-002', '200 Fashion Ave, New York, NY 10018', 'US', true, 4.50),
('HomeGoods Global', 'Robert Home', 'robert@homegoods.com', '+1-800-HOME-003', '300 Comfort Lane, Chicago, IL 60601', 'US', true, 4.25),
('Sports Elite', 'Sarah Sport', 'sarah@sportselite.com', '+1-800-SPRT-004', '400 Athletic Way, Denver, CO 80201', 'US', true, 4.80),
('BookMart International', 'David Book', 'david@bookmart.com', '+1-800-BOOK-005', '500 Literary Road, Boston, MA 02101', 'US', true, 4.60);

INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, currency, weight_kg, dimensions, is_active, is_featured, is_digital, tax_rate, tags, attributes, images) VALUES
('PHONE-001', 'ProMax Smartphone X', 'promax-smartphone-x', 'The latest flagship smartphone with advanced AI capabilities, 6.7" OLED display, and 5G connectivity.', 'Flagship 5G smartphone with AI features', 6, 1, 999.99, 650.00, 1199.99, 'USD', 0.195, '{"length": 16.5, "width": 7.8, "height": 0.8, "unit": "cm"}', true, true, false, 8.25, '["smartphone", "5G", "flagship", "AI"]', '{"color": "Midnight Black", "storage": "256GB", "ram": "12GB"}', '[{"url": "https://cdn.example.com/products/phone-001-1.jpg", "alt": "Front view"}]'),
('PHONE-002', 'BudgetPhone SE', 'budgetphone-se', 'Affordable smartphone with essential features. 6.1" LCD display, dual camera system.', 'Affordable everyday smartphone', 6, 1, 299.99, 180.00, 349.99, 'USD', 0.175, '{"length": 15.0, "width": 7.2, "height": 0.9, "unit": "cm"}', true, false, false, 8.25, '["smartphone", "budget", "affordable"]', '{"color": "White", "storage": "64GB", "ram": "4GB"}', '[{"url": "https://cdn.example.com/products/phone-002-1.jpg", "alt": "Front view"}]'),
('LAPTOP-001', 'UltraBook Pro 15', 'ultrabook-pro-15', 'Premium ultrabook with Intel Core i9, 32GB RAM, 1TB SSD, and stunning 4K OLED display.', 'Premium 15" ultrabook for professionals', 7, 1, 1899.99, 1200.00, 2199.99, 'USD', 1.85, '{"length": 35.5, "width": 24.0, "height": 1.6, "unit": "cm"}', true, true, false, 8.25, '["laptop", "ultrabook", "professional", "4K"]', '{"processor": "Intel Core i9", "ram": "32GB", "storage": "1TB SSD"}', '[{"url": "https://cdn.example.com/products/laptop-001-1.jpg", "alt": "Open laptop"}]'),
('AUDIO-001', 'NoiseCancel Pro Headphones', 'noisecancel-pro-headphones', 'Premium wireless headphones with active noise cancellation, 40-hour battery life.', 'Premium ANC wireless headphones', 8, 1, 349.99, 180.00, 399.99, 'USD', 0.255, '{"length": 18.0, "width": 16.0, "height": 8.0, "unit": "cm"}', true, true, false, 8.25, '["headphones", "wireless", "ANC", "premium"]', '{"type": "Over-ear", "connectivity": "Bluetooth 5.2", "battery_life": "40 hours"}', '[{"url": "https://cdn.example.com/products/audio-001-1.jpg", "alt": "Headphones front"}]'),
('GAME-001', 'GameStation 6', 'gamestation-6', 'Next-generation gaming console with 4K 120fps gaming, 1TB SSD, ray tracing.', 'Next-gen gaming console', 10, 1, 499.99, 380.00, 549.99, 'USD', 4.5, '{"length": 39.0, "width": 26.0, "height": 10.4, "unit": "cm"}', true, true, false, 8.25, '["gaming", "console", "4K", "next-gen"]', '{"storage": "1TB SSD", "resolution": "4K 120fps"}', '[{"url": "https://cdn.example.com/products/game-001-1.jpg", "alt": "Console front"}]'),
('SHIRT-001', 'Classic Oxford Shirt', 'classic-oxford-shirt', 'Timeless Oxford button-down shirt made from 100% premium cotton.', 'Premium cotton Oxford shirt', 11, 2, 59.99, 22.00, 79.99, 'USD', 0.28, '{"length": 76, "width": 58, "height": 2, "unit": "cm"}', true, false, false, 0.00, '["shirt", "oxford", "cotton", "business"]', '{"material": "100% Cotton", "fit": "Regular"}', '[{"url": "https://cdn.example.com/products/shirt-001-1.jpg", "alt": "Shirt front"}]'),
('SHOE-001', 'RunMax Athletic Shoes', 'runmax-athletic-shoes', 'High-performance running shoes with responsive cushioning, breathable mesh upper.', 'High-performance running shoes', 13, 2, 129.99, 55.00, 159.99, 'USD', 0.62, '{"length": 30, "width": 12, "height": 10, "unit": "cm"}', true, true, false, 0.00, '["shoes", "running", "athletic", "performance"]', '{"material": "Mesh upper, rubber sole", "cushioning": "Responsive foam"}', '[{"url": "https://cdn.example.com/products/shoe-001-1.jpg", "alt": "Shoe side view"}]'),
('SOFA-001', 'ComfortPlus Sectional Sofa', 'comfortplus-sectional-sofa', 'Spacious L-shaped sectional sofa with premium upholstery, memory foam cushions.', 'L-shaped sectional with memory foam', 14, 3, 1499.99, 750.00, 1899.99, 'USD', 95.0, '{"length": 290, "width": 180, "height": 85, "unit": "cm"}', true, true, false, 8.25, '["sofa", "sectional", "furniture", "comfort"]', '{"material": "Premium fabric upholstery", "frame": "Hardwood"}', '[{"url": "https://cdn.example.com/products/sofa-001-1.jpg", "alt": "Sofa full view"}]'),
('KNIFE-001', 'ChefMaster Knife Set', 'chefmaster-knife-set', 'Professional 15-piece knife set with high-carbon stainless steel blades.', 'Professional 15-piece knife set', 15, 3, 199.99, 85.00, 249.99, 'USD', 3.2, '{"length": 40, "width": 25, "height": 35, "unit": "cm"}', true, false, false, 8.25, '["kitchen", "knives", "chef", "professional"]', '{"pieces": 15, "material": "High-carbon stainless steel"}', '[{"url": "https://cdn.example.com/products/knife-001-1.jpg", "alt": "Knife set in block"}]'),
('BOOK-001', 'The Art of Programming', 'the-art-of-programming', 'Comprehensive guide to software development best practices.', 'Programming best practices guide', 5, 5, 49.99, 15.00, 59.99, 'USD', 0.95, '{"length": 24, "width": 17, "height": 4, "unit": "cm"}', true, false, false, 0.00, '["book", "programming", "technology", "education"]', '{"author": "Dr. Jane Developer", "pages": 650, "isbn": "978-1234567890"}', '[{"url": "https://cdn.example.com/products/book-001-1.jpg", "alt": "Book cover"}]');

INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES
(1, 'MAIN', 150, 12, 20, 100, DATE_SUB(NOW(), INTERVAL 5 DAY)),
(2, 'MAIN', 500, 25, 50, 200, DATE_SUB(NOW(), INTERVAL 7 DAY)),
(3, 'MAIN', 45, 3, 10, 30, DATE_SUB(NOW(), INTERVAL 10 DAY)),
(4, 'MAIN', 120, 15, 20, 80, DATE_SUB(NOW(), INTERVAL 6 DAY)),
(5, 'MAIN', 80, 10, 15, 50, DATE_SUB(NOW(), INTERVAL 9 DAY)),
(6, 'MAIN', 300, 20, 40, 120, DATE_SUB(NOW(), INTERVAL 5 DAY)),
(7, 'MAIN', 180, 12, 25, 80, DATE_SUB(NOW(), INTERVAL 3 DAY)),
(8, 'MAIN', 15, 1, 3, 10, DATE_SUB(NOW(), INTERVAL 20 DAY)),
(9, 'MAIN', 250, 18, 35, 100, DATE_SUB(NOW(), INTERVAL 6 DAY)),
(10, 'MAIN', 400, 30, 50, 150, DATE_SUB(NOW(), INTERVAL 4 DAY));

DROP PROCEDURE IF EXISTS seed_orders;
DELIMITER //
CREATE PROCEDURE seed_orders()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE j INT;
    DECLARE v_customer_id INT;
    DECLARE v_order_id INT;
    DECLARE v_product_id INT;
    DECLARE v_qty INT;
    DECLARE v_unit_price DECIMAL(12,2);
    DECLARE v_order_date DATETIME;
    DECLARE v_status VARCHAR(20);
    DECLARE v_payment VARCHAR(20);
    
    WHILE i <= 300 DO
        SET v_customer_id = (i MOD 20) + 1;
        SET v_order_date = DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY);
        SET v_status = ELT(FLOOR(RAND() * 7) + 1, 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
        SET v_payment = ELT(FLOOR(RAND() * 4) + 1, 'credit_card', 'debit_card', 'paypal', 'bank_transfer');
        
        INSERT INTO orders (order_number, customer_id, status, payment_method, payment_status,
                          shipping_address_id, subtotal, tax_amount, shipping_amount, discount_amount, total_amount, created_at)
        VALUES (
            CONCAT('ORD-', LPAD(i, 6, '0')),
            v_customer_id, v_status, v_payment,
            IF(RAND() > 0.2, 'paid', 'pending'),
            v_customer_id,
            0, 0, ROUND(RAND() * 15 + 5, 2), IF(RAND() > 0.7, ROUND(RAND() * 50, 2), 0), 0,
            v_order_date
        );
        SET v_order_id = LAST_INSERT_ID();
        
        SET j = 1;
        WHILE j <= FLOOR(RAND() * 4) + 1 DO
            SET v_product_id = FLOOR(RAND() * 10) + 1;
            SET v_qty = FLOOR(RAND() * 3) + 1;
            SELECT price INTO v_unit_price FROM products WHERE id = v_product_id;
            IF v_unit_price IS NULL THEN SET v_unit_price = 29.99; END IF;
            
            INSERT INTO order_items (order_id, order_created_at, product_id, product_name, product_sku, quantity, unit_price, total_price)
            SELECT v_order_id, v_order_date, v_product_id, p.name, p.sku, v_qty, v_unit_price, (v_qty * v_unit_price)
            FROM products p WHERE p.id = v_product_id;
            
            SET j = j + 1;
        END WHILE;
        
        UPDATE orders SET 
            subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM order_items WHERE order_id = v_order_id),
            tax_amount = subtotal * 0.0825,
            total_amount = subtotal + tax_amount + shipping_amount - discount_amount
        WHERE id = v_order_id;
        
        SET i = i + 1;
    END WHILE;
END //
DELIMITER ;

CALL seed_orders();
DROP PROCEDURE seed_orders;

INSERT INTO reviews (product_id, customer_id, rating, title, content, pros, cons, is_verified_purchase, is_approved, helpful_count) VALUES
(1, 1, 5, 'Best phone ever!', 'Amazing camera quality and battery life.', '["Great camera", "Long battery"]', '["Expensive"]', true, true, 45),
(1, 4, 4, 'Great but pricey', 'Excellent phone with minor drawbacks.', '["Beautiful display", "Smooth UI"]', '["Price", "Heavy"]', true, true, 23),
(2, 2, 4, 'Good value for money', 'Does everything I need without breaking the bank.', '["Affordable", "Reliable"]', '["Basic camera"]', true, true, 12),
(3, 1, 5, 'Perfect for work', 'The best laptop I''ve ever owned.', '["4K display", "Performance"]', '["Heavy"]', true, true, 67),
(4, 3, 5, 'Silence is golden', 'The noise cancellation is incredible.', '["ANC quality", "Comfort"]', NULL, true, true, 89),
(5, 4, 5, 'Gaming perfection', 'Load times are insane. Graphics are next level.', '["Fast loading", "Great games"]', '["Game prices"]', true, true, 156),
(7, 6, 5, 'Changed my running', 'Best running shoes I''ve owned.', '["Comfort", "Support"]', NULL, true, true, 28),
(8, 1, 5, 'Couch potato approved', 'Most comfortable sofa ever.', '["Comfort", "Size", "Quality"]', '["Delivery time"]', true, true, 95);

INSERT INTO all_data_types (
    col_tinyint, col_tinyint_unsigned, col_smallint, col_mediumint, col_int, col_bigint,
    col_decimal, col_float, col_double, col_bit,
    col_char, col_varchar, col_tinytext, col_text, col_mediumtext, col_longtext,
    col_binary, col_varbinary, col_tinyblob, col_blob,
    col_date, col_time, col_datetime, col_timestamp, col_year,
    col_json, col_enum, col_set, col_point, col_uuid
) VALUES
(127, 255, 32767, 8388607, 2147483647, 9223372036854775807,
 12345678901234567890.123456789012345678, 3.14159, 3.141592653589793, b'1010101010101010',
 'CHAR255', 'Variable length string up to 16383 chars', 'Tiny text content', 'Regular text content', 'Medium text for larger content', 'Long text for very large content',
 0xDEADBEEF, 0xCAFEBABE, 0x48454C4C4F, 0x576F726C64,
 '2024-06-15', '14:30:45.123456', '2024-06-15 14:30:45.123456', '2024-06-15 14:30:45.123456', 2024,
 '{"key": "value", "nested": {"a": 1}}', 'value1', 'a,b,c', ST_GeomFromText('POINT(1 1)'), UUID()),
(-128, 0, -32768, -8388608, -2147483648, -9223372036854775808,
 -12345678901234567890.123456789012345678, -3.14159, -3.141592653589793, b'0000000000000000',
 'MIN', 'Minimum values test', 'Min tiny', 'Min text', 'Min medium', 'Min long',
 0x00, 0x00, 0x00, 0x00,
 '1970-01-01', '00:00:00', '1970-01-01 00:00:00', '1970-01-01 00:00:01', 1901,
 '{}', 'other', '', NULL, UUID());

INSERT INTO null_patterns (description, all_null_row, nullable_int, nullable_text, nullable_bool, nullable_date, nullable_json) VALUES
('All nulls except id and description', NULL, NULL, NULL, NULL, NULL, NULL),
('Only text set', NULL, NULL, 'Some text here', NULL, NULL, NULL),
('Only int set', NULL, 42, NULL, NULL, NULL, NULL),
('Only bool set (true)', NULL, NULL, NULL, true, NULL, NULL),
('Only bool set (false)', NULL, NULL, NULL, false, NULL, NULL),
('Only date set', NULL, NULL, NULL, NULL, '2024-06-15', NULL),
('Only json set', NULL, NULL, NULL, NULL, NULL, '{"key": "value"}'),
('All values set', 'not null', 100, 'Full row', true, '2024-01-01', '{"complete": true}'),
('Empty string vs null', '', 0, '', NULL, NULL, 'null');

INSERT INTO unicode_samples (description, sample_text, category, char_count, byte_count) VALUES
('Basic ASCII', 'Hello, World!', 'ASCII', 13, 13),
('Emojis', '🚀🎉✨💾🔧🎨🌈⚡🔥💡', 'Emoji', 10, 40),
('Chinese (Simplified)', '你好世界！这是中文测试。', 'CJK', 12, 36),
('Japanese', 'こんにちは世界！日本語テスト', 'Japanese', 14, 42),
('Korean', '안녕하세요 세계!', 'Korean', 9, 25),
('Arabic', 'مرحبا بالعالم!', 'RTL', 14, 27),
('Russian', 'Привет мир!', 'Cyrillic', 11, 21),
('Mixed Scripts', 'Hello こんにちは 你好 مرحبا 👋', 'Mixed', 24, 46),
('SQL Injection Attempt', '\'; DROP TABLE users; --', 'Security', 25, 25);

INSERT INTO numeric_extremes (description, tiny_val, small_val, int_val, big_val, decimal_val, float_val, double_val) VALUES
('Maximum positive', 127, 32767, 2147483647, 9223372036854775807, 99999999999999999999.999999999999999999, 3.4e+37, 1.7e+308),
('Minimum negative', -128, -32768, -2147483648, -9223372036854775808, -99999999999999999999.999999999999999999, -3.4e+37, -1.7e+308),
('Zero values', 0, 0, 0, 0, 0.0, 0, 0),
('Pi approximations', NULL, NULL, 3, 3, 3.141592653589793238, 3.1415927, 3.141592653589793);

INSERT INTO json_documents (description, doc_json) VALUES
('Empty object', '{}'),
('Empty array', '[]'),
('Simple object', '{"name": "John", "age": 30}'),
('Nested object', '{"user": {"name": "Jane", "address": {"city": "NYC", "zip": "10001"}}}'),
('Array of objects', '[{"id": 1, "name": "A"}, {"id": 2, "name": "B"}]'),
('All JSON types', '{"string": "hello", "number": 42, "float": 3.14, "bool_t": true, "bool_f": false, "null_v": null, "array": [1, 2], "object": {"nested": true}}');

INSERT INTO temporal_data (description, date_val, time_val, datetime_val, timestamp_val, year_val) VALUES
('Current moment', CURDATE(), CURTIME(6), NOW(6), NOW(6), YEAR(NOW())),
('Unix epoch', '1970-01-01', '00:00:00', '1970-01-01 00:00:00', '1970-01-01 00:00:01', 1970),
('Y2K', '2000-01-01', '00:00:00', '2000-01-01 00:00:00', '2000-01-01 00:00:00', 2000),
('Leap day 2024', '2024-02-29', '12:00:00', '2024-02-29 12:00:00', '2024-02-29 12:00:00', 2024),
('End of day', '2024-12-31', '23:59:59.999999', '2024-12-31 23:59:59.999999', '2024-12-31 23:59:59.999999', 2024);

INSERT INTO spatial_data (description, point_val, linestring_val, polygon_val) VALUES
('Origin', ST_GeomFromText('POINT(0 0)', 4326), ST_GeomFromText('LINESTRING(0 0, 1 1, 2 0)'), ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')),
('San Francisco', ST_GeomFromText('POINT(37.7749 -122.4194)', 4326), NULL, NULL),
('New York', ST_GeomFromText('POINT(40.7128 -74.0060)', 4326), NULL, NULL);

INSERT INTO single_row_table (name, description) VALUES ('Configuration', 'This table intentionally contains only one row for edge case testing.');

DROP PROCEDURE IF EXISTS seed_large_table;
DELIMITER //
CREATE PROCEDURE seed_large_table()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 1000;
    
    WHILE i <= 100000 DO
        INSERT INTO large_table (random_int, random_text, random_date, random_bool, category, amount)
        VALUES (
            FLOOR(RAND() * 1000000),
            CONCAT('Text_', i, '_', MD5(i)),
            DATE_SUB(CURDATE(), INTERVAL FLOOR(RAND() * 1000) DAY),
            RAND() > 0.5,
            ELT((i MOD 5) + 1, 'A', 'B', 'C', 'D', 'E'),
            ROUND(RAND() * 10000, 2)
        );
        SET i = i + 1;
    END WHILE;
END //
DELIMITER ;

CALL seed_large_table();
DROP PROCEDURE IF EXISTS seed_large_table;

DROP PROCEDURE IF EXISTS seed_wide_table;
DELIMITER //
CREATE PROCEDURE seed_wide_table()
BEGIN
    DECLARE i INT DEFAULT 1;
    WHILE i <= 100 DO
        INSERT INTO wide_table (
            col_001, col_002, col_003, col_004, col_005, col_006, col_007, col_008, col_009, col_010,
            col_011, col_012, col_013, col_014, col_015, col_016, col_017, col_018, col_019, col_020,
            col_021, col_022, col_023, col_024, col_025, col_026, col_027, col_028, col_029, col_030,
            col_031, col_032, col_033, col_034, col_035, col_036, col_037, col_038, col_039, col_040,
            col_041, col_042, col_043, col_044, col_045, col_046, col_047, col_048, col_049, col_050
        ) VALUES (
            CONCAT('A', i), CONCAT('B', i), CONCAT('C', i), CONCAT('D', i), CONCAT('E', i),
            CONCAT('F', i), CONCAT('G', i), CONCAT('H', i), CONCAT('I', i), CONCAT('J', i),
            i, i*2, i*3, i*4, i*5, i*6, i*7, i*8, i*9, i*10,
            i/100, i/200, i/300, i/400, i/500,
            i MOD 2 = 0, i MOD 3 = 0, i MOD 4 = 0, i MOD 5 = 0, i MOD 6 = 0,
            DATE_SUB(CURDATE(), INTERVAL i DAY), DATE_SUB(CURDATE(), INTERVAL i*2 DAY), DATE_SUB(CURDATE(), INTERVAL i*3 DAY), DATE_SUB(CURDATE(), INTERVAL i*4 DAY), DATE_SUB(CURDATE(), INTERVAL i*5 DAY),
            DATE_SUB(NOW(), INTERVAL i HOUR), DATE_SUB(NOW(), INTERVAL i*2 HOUR), DATE_SUB(NOW(), INTERVAL i*3 HOUR), DATE_SUB(NOW(), INTERVAL i*4 HOUR), DATE_SUB(NOW(), INTERVAL i*5 HOUR),
            CONCAT('Text block ', i), CONCAT('Description ', i), CONCAT('Notes ', i), CONCAT('Comment ', i), CONCAT('Detail ', i),
            JSON_OBJECT('index', i), JSON_OBJECT('value', i*10), JSON_OBJECT('count', i*100), JSON_OBJECT('id', CONCAT('row_', i)), JSON_OBJECT('meta', JSON_OBJECT('row', i))
        );
        SET i = i + 1;
    END WHILE;
END //
DELIMITER ;

CALL seed_wide_table();
DROP PROCEDURE IF EXISTS seed_wide_table;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'MySQL Seed completed!' AS message;
SELECT COUNT(*) AS customer_count FROM customers;
SELECT COUNT(*) AS product_count FROM products;
SELECT COUNT(*) AS order_count FROM orders;
SELECT COUNT(*) AS large_table_count FROM large_table;
