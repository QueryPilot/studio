USE todoapp;
GO

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
GO

DELETE FROM dbo.order_audit_log;
DELETE FROM dbo.order_items;
DELETE FROM dbo.orders;
DELETE FROM dbo.reviews;
DELETE FROM dbo.inventory;
DELETE FROM dbo.products;
DELETE FROM dbo.categories;
DELETE FROM dbo.addresses;
DELETE FROM dbo.customers;
DELETE FROM dbo.suppliers;
DELETE FROM dbo.all_data_types;
DELETE FROM dbo.null_patterns;
DELETE FROM dbo.unicode_samples;
DELETE FROM dbo.numeric_extremes;
DELETE FROM dbo.json_documents;
DELETE FROM dbo.temporal_data;
DELETE FROM dbo.spatial_data;
DELETE FROM dbo.large_table;
DELETE FROM dbo.wide_table;
DELETE FROM dbo.single_row_table;
GO

GO

INSERT INTO dbo.customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
(N'alice.johnson@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Alice', N'Johnson', N'+1-555-0101', '1985-03-15', 'F', 1, 1, 2500, N'{"theme": "dark", "newsletter": true}', N'{"tier": "gold", "source": "organic"}', DATEADD(HOUR, -2, GETDATE())),
(N'bob.smith@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Bob', N'Smith', N'+1-555-0102', '1990-07-22', 'M', 1, 1, 1200, N'{"theme": "light", "newsletter": false}', N'{"tier": "silver", "source": "referral"}', DATEADD(DAY, -1, GETDATE())),
(N'carol.williams@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Carol', N'Williams', N'+1-555-0103', '1978-11-08', 'F', 1, 0, 500, N'{"theme": "auto", "newsletter": true}', N'{"tier": "bronze", "source": "ads"}', DATEADD(DAY, -5, GETDATE())),
(N'david.brown@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'David', N'Brown', N'+1-555-0104', '1995-01-30', 'M', 1, 1, 8500, N'{"theme": "dark", "newsletter": true}', N'{"tier": "platinum", "source": "organic"}', DATEADD(MINUTE, -30, GETDATE())),
(N'emma.davis@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Emma', N'Davis', N'+1-555-0105', '1988-09-12', 'F', 1, 1, 3200, N'{"theme": "light", "newsletter": false}', N'{"tier": "gold", "source": "social"}', DATEADD(HOUR, -3, GETDATE())),
(N'frank.miller@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Frank', N'Miller', N'+1-555-0106', '1982-04-25', 'M', 0, 1, 150, N'{"theme": "dark", "newsletter": false}', N'{"tier": "bronze", "source": "organic"}', DATEADD(DAY, -60, GETDATE())),
(N'grace.wilson@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Grace', N'Wilson', N'+1-555-0107', '1992-12-03', 'F', 1, 1, 4100, N'{"theme": "auto", "newsletter": true}', N'{"tier": "gold", "source": "referral"}', DATEADD(HOUR, -6, GETDATE())),
(N'henry.moore@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Henry', N'Moore', N'+1-555-0108', '1975-06-18', 'M', 1, 0, 750, N'{"theme": "light", "newsletter": true}', N'{"tier": "silver", "source": "ads"}', DATEADD(DAY, -2, GETDATE())),
(N'ivy.taylor@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Ivy', N'Taylor', N'+1-555-0109', '1998-02-14', 'F', 1, 1, 1800, N'{"theme": "dark", "newsletter": true}', N'{"tier": "silver", "source": "organic"}', DATEADD(HOUR, -12, GETDATE())),
(N'jack.anderson@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Jack', N'Anderson', N'+1-555-0110', '1987-08-07', 'M', 1, 1, 950, N'{"theme": "auto", "newsletter": false}', N'{"tier": "bronze", "source": "social"}', DATEADD(DAY, -4, GETDATE())),
(N'karen.thomas@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Karen', N'Thomas', N'+1-555-0111', '1993-05-21', 'F', 1, 1, 6200, N'{"theme": "dark", "newsletter": true}', N'{"tier": "platinum", "source": "organic"}', DATEADD(HOUR, -1, GETDATE())),
(N'leo.jackson@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Leo', N'Jackson', N'+1-555-0112', '1980-10-09', 'M', 1, 1, 2100, N'{"theme": "light", "newsletter": true}', N'{"tier": "gold", "source": "referral"}', DATEADD(HOUR, -18, GETDATE())),
(N'mia.white@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Mia', N'White', N'+1-555-0113', '1996-07-28', 'F', 1, 0, 320, N'{"theme": "dark", "newsletter": false}', N'{"tier": "bronze", "source": "ads"}', DATEADD(DAY, -7, GETDATE())),
(N'noah.harris@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Noah', N'Harris', N'+1-555-0114', '1984-03-16', 'M', 1, 1, 4800, N'{"theme": "auto", "newsletter": true}', N'{"tier": "gold", "source": "organic"}', DATEADD(HOUR, -5, GETDATE())),
(N'olivia.martin@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Olivia', N'Martin', N'+1-555-0115', '1991-11-24', 'F', 1, 1, 1500, N'{"theme": "light", "newsletter": true}', N'{"tier": "silver", "source": "social"}', DATEADD(DAY, -2, GETDATE())),
(N'peter.garcia@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Peter', N'Garcia', N'+1-555-0116', '1977-09-05', 'M', 0, 1, 50, N'{"theme": "dark", "newsletter": false}', N'{"tier": "bronze", "source": "organic"}', NULL),
(N'quinn.martinez@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Quinn', N'Martinez', N'+1-555-0117', '1999-01-11', 'O', 1, 1, 2800, N'{"theme": "auto", "newsletter": true}', N'{"tier": "gold", "source": "referral"}', DATEADD(MINUTE, -45, GETDATE())),
(N'rachel.robinson@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Rachel', N'Robinson', N'+1-555-0118', '1986-06-30', 'F', 1, 1, 5500, N'{"theme": "dark", "newsletter": true}', N'{"tier": "platinum", "source": "organic"}', DATEADD(HOUR, -3, GETDATE())),
(N'sam.clark@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Sam', N'Clark', N'+1-555-0119', '1994-04-17', 'M', 1, 0, 680, N'{"theme": "light", "newsletter": false}', N'{"tier": "bronze", "source": "ads"}', DATEADD(DAY, -10, GETDATE())),
(N'tina.rodriguez@email.com', N'$2b$12$LQv3c1yqBwEHbNkZxK7Uru', N'Tina', N'Rodriguez', N'+1-555-0120', '1983-12-22', 'F', 1, 1, 3900, N'{"theme": "dark", "newsletter": true}', N'{"tier": "gold", "source": "social"}', DATEADD(HOUR, -8, GETDATE()));
GO

INSERT INTO dbo.addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES
(1, 'both', N'123 Main Street', N'Apt 4B', N'New York', N'NY', N'10001', 'US', 1),
(2, 'both', N'789 Oak Avenue', NULL, N'Los Angeles', N'CA', N'90001', 'US', 1),
(3, 'billing', N'321 Pine Road', NULL, N'Chicago', N'IL', N'60601', 'US', 1),
(4, 'both', N'987 Cedar Lane', NULL, N'Houston', N'TX', N'77001', 'US', 1),
(5, 'both', N'147 Maple Drive', N'Floor 2', N'Phoenix', N'AZ', N'85001', 'US', 1),
(6, 'both', N'258 Birch Court', NULL, N'Philadelphia', N'PA', N'19101', 'US', 1),
(7, 'both', N'369 Walnut Way', N'Apt 12', N'San Antonio', N'TX', N'78201', 'US', 1),
(8, 'both', N'741 Cherry Boulevard', NULL, N'San Diego', N'CA', N'92101', 'US', 1),
(9, 'both', N'852 Spruce Street', N'Suite 300', N'Dallas', N'TX', N'75201', 'US', 1),
(10, 'both', N'963 Ash Avenue', NULL, N'San Jose', N'CA', N'95101', 'US', 1);
GO

INSERT INTO dbo.categories (parent_id, name, slug, description, is_active, sort_order) VALUES
(NULL, N'Electronics', N'electronics', N'Electronic devices and accessories', 1, 1),
(NULL, N'Clothing', N'clothing', N'Apparel and fashion items', 1, 2),
(NULL, N'Home & Garden', N'home-garden', N'Home improvement and garden supplies', 1, 3),
(NULL, N'Sports & Outdoors', N'sports-outdoors', N'Sports equipment and outdoor gear', 1, 4),
(NULL, N'Books & Media', N'books-media', N'Books, music, and movies', 1, 5),
(1, N'Smartphones', N'smartphones', N'Mobile phones and accessories', 1, 1),
(1, N'Laptops', N'laptops', N'Laptop computers and accessories', 1, 2),
(1, N'Audio', N'audio', N'Headphones, speakers, and audio equipment', 1, 3),
(1, N'Cameras', N'cameras', N'Digital cameras and photography equipment', 1, 4),
(1, N'Gaming', N'gaming', N'Video games and gaming accessories', 1, 5),
(2, N'Men''s Clothing', N'mens-clothing', N'Clothing for men', 1, 1),
(2, N'Women''s Clothing', N'womens-clothing', N'Clothing for women', 1, 2),
(2, N'Shoes', N'shoes', N'Footwear for all', 1, 4),
(3, N'Furniture', N'furniture', N'Home furniture', 1, 1),
(3, N'Kitchen', N'kitchen', N'Kitchen appliances and tools', 1, 2);
GO

INSERT INTO dbo.suppliers (company_name, contact_name, contact_email, contact_phone, address, country, is_active, rating) VALUES
(N'TechWorld Inc.', N'John Tech', N'john@techworld.com', N'+1-800-TECH-001', N'100 Silicon Valley Blvd, San Jose, CA 95110', 'US', 1, 4.75),
(N'Fashion Forward Ltd.', N'Maria Style', N'maria@fashionforward.com', N'+1-800-FASH-002', N'200 Fashion Ave, New York, NY 10018', 'US', 1, 4.50),
(N'HomeGoods Global', N'Robert Home', N'robert@homegoods.com', N'+1-800-HOME-003', N'300 Comfort Lane, Chicago, IL 60601', 'US', 1, 4.25),
(N'Sports Elite', N'Sarah Sport', N'sarah@sportselite.com', N'+1-800-SPRT-004', N'400 Athletic Way, Denver, CO 80201', 'US', 1, 4.80),
(N'BookMart International', N'David Book', N'david@bookmart.com', N'+1-800-BOOK-005', N'500 Literary Road, Boston, MA 02101', 'US', 1, 4.60);
GO

INSERT INTO dbo.products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, dimensions, is_active, is_featured, tax_rate, tags, attributes, images) VALUES
(N'PHONE-001', N'ProMax Smartphone X', N'promax-smartphone-x', N'The latest flagship smartphone with advanced AI capabilities, 6.7" OLED display, and 5G connectivity.', N'Flagship 5G smartphone with AI features', 6, 1, 999.99, 650.00, 1199.99, 0.195, N'{"length": 16.5, "width": 7.8, "height": 0.8}', 1, 1, 8.25, N'["smartphone", "5G", "flagship"]', N'{"color": "Midnight Black", "storage": "256GB"}', N'[{"url": "https://cdn.example.com/phone-001-1.jpg"}]'),
(N'PHONE-002', N'BudgetPhone SE', N'budgetphone-se', N'Affordable smartphone with essential features.', N'Affordable everyday smartphone', 6, 1, 299.99, 180.00, 349.99, 0.175, N'{"length": 15.0, "width": 7.2, "height": 0.9}', 1, 0, 8.25, N'["smartphone", "budget"]', N'{"color": "White", "storage": "64GB"}', N'[{"url": "https://cdn.example.com/phone-002-1.jpg"}]'),
(N'LAPTOP-001', N'UltraBook Pro 15', N'ultrabook-pro-15', N'Premium ultrabook with Intel Core i9, 32GB RAM, 1TB SSD.', N'Premium 15" ultrabook for professionals', 7, 1, 1899.99, 1200.00, 2199.99, 1.85, N'{"length": 35.5, "width": 24.0, "height": 1.6}', 1, 1, 8.25, N'["laptop", "ultrabook", "professional"]', N'{"processor": "Intel Core i9", "ram": "32GB"}', N'[{"url": "https://cdn.example.com/laptop-001-1.jpg"}]'),
(N'AUDIO-001', N'NoiseCancel Pro Headphones', N'noisecancel-pro-headphones', N'Premium wireless headphones with active noise cancellation.', N'Premium ANC wireless headphones', 8, 1, 349.99, 180.00, 399.99, 0.255, N'{"length": 18.0, "width": 16.0, "height": 8.0}', 1, 1, 8.25, N'["headphones", "wireless", "ANC"]', N'{"type": "Over-ear", "battery_life": "40 hours"}', N'[{"url": "https://cdn.example.com/audio-001-1.jpg"}]'),
(N'GAME-001', N'GameStation 6', N'gamestation-6', N'Next-generation gaming console with 4K 120fps gaming.', N'Next-gen gaming console', 10, 1, 499.99, 380.00, 549.99, 4.5, N'{"length": 39.0, "width": 26.0, "height": 10.4}', 1, 1, 8.25, N'["gaming", "console", "4K"]', N'{"storage": "1TB SSD", "resolution": "4K 120fps"}', N'[{"url": "https://cdn.example.com/game-001-1.jpg"}]'),
(N'SHIRT-001', N'Classic Oxford Shirt', N'classic-oxford-shirt', N'Timeless Oxford button-down shirt made from 100% premium cotton.', N'Premium cotton Oxford shirt', 11, 2, 59.99, 22.00, 79.99, 0.28, N'{"length": 76, "width": 58, "height": 2}', 1, 0, 0.00, N'["shirt", "oxford", "cotton"]', N'{"material": "100% Cotton", "fit": "Regular"}', N'[{"url": "https://cdn.example.com/shirt-001-1.jpg"}]'),
(N'SHOE-001', N'RunMax Athletic Shoes', N'runmax-athletic-shoes', N'High-performance running shoes with responsive cushioning.', N'High-performance running shoes', 13, 2, 129.99, 55.00, 159.99, 0.62, N'{"length": 30, "width": 12, "height": 10}', 1, 1, 0.00, N'["shoes", "running", "athletic"]', N'{"material": "Mesh upper", "cushioning": "Responsive foam"}', N'[{"url": "https://cdn.example.com/shoe-001-1.jpg"}]'),
(N'SOFA-001', N'ComfortPlus Sectional Sofa', N'comfortplus-sectional-sofa', N'Spacious L-shaped sectional sofa with memory foam cushions.', N'L-shaped sectional with memory foam', 14, 3, 1499.99, 750.00, 1899.99, 95.0, N'{"length": 290, "width": 180, "height": 85}', 1, 1, 8.25, N'["sofa", "sectional", "furniture"]', N'{"material": "Premium fabric", "frame": "Hardwood"}', N'[{"url": "https://cdn.example.com/sofa-001-1.jpg"}]'),
(N'KNIFE-001', N'ChefMaster Knife Set', N'chefmaster-knife-set', N'Professional 15-piece knife set with high-carbon stainless steel blades.', N'Professional 15-piece knife set', 15, 3, 199.99, 85.00, 249.99, 3.2, N'{"length": 40, "width": 25, "height": 35}', 1, 0, 8.25, N'["kitchen", "knives", "chef"]', N'{"pieces": 15, "material": "Stainless steel"}', N'[{"url": "https://cdn.example.com/knife-001-1.jpg"}]'),
(N'BOOK-001', N'The Art of Programming', N'the-art-of-programming', N'Comprehensive guide to software development best practices.', N'Programming best practices guide', 5, 5, 49.99, 15.00, 59.99, 0.95, N'{"length": 24, "width": 17, "height": 4}', 1, 0, 0.00, N'["book", "programming", "technology"]', N'{"author": "Dr. Jane Developer", "pages": 650}', N'[{"url": "https://cdn.example.com/book-001-1.jpg"}]');
GO

INSERT INTO dbo.inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES
(1, 'MAIN', 150, 12, 20, 100, DATEADD(DAY, -5, GETDATE())),
(2, 'MAIN', 500, 25, 50, 200, DATEADD(DAY, -7, GETDATE())),
(3, 'MAIN', 45, 3, 10, 30, DATEADD(DAY, -10, GETDATE())),
(4, 'MAIN', 120, 15, 20, 80, DATEADD(DAY, -6, GETDATE())),
(5, 'MAIN', 80, 10, 15, 50, DATEADD(DAY, -9, GETDATE())),
(6, 'MAIN', 300, 20, 40, 120, DATEADD(DAY, -5, GETDATE())),
(7, 'MAIN', 180, 12, 25, 80, DATEADD(DAY, -3, GETDATE())),
(8, 'MAIN', 15, 1, 3, 10, DATEADD(DAY, -20, GETDATE())),
(9, 'MAIN', 250, 18, 35, 100, DATEADD(DAY, -6, GETDATE())),
(10, 'MAIN', 400, 30, 50, 150, DATEADD(DAY, -4, GETDATE()));
GO

DECLARE @i INT = 1;
DECLARE @customer_id INT;
DECLARE @order_date DATETIME2;
DECLARE @status NVARCHAR(20);
DECLARE @payment NVARCHAR(20);
DECLARE @order_id INT;
DECLARE @j INT;
DECLARE @product_id INT;
DECLARE @qty INT;
DECLARE @unit_price DECIMAL(12,2);

WHILE @i <= 200
BEGIN
    SET @customer_id = (@i % 20) + 1;
    SET @order_date = DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE());
    SET @status = CHOOSE(ABS(CHECKSUM(NEWID()) % 7) + 1, 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
    SET @payment = CHOOSE(ABS(CHECKSUM(NEWID()) % 4) + 1, 'credit_card', 'debit_card', 'paypal', 'bank_transfer');
    
    INSERT INTO dbo.orders (order_number, customer_id, status, payment_method, payment_status, shipping_address_id, subtotal, tax_amount, shipping_amount, discount_amount, total_amount, created_at)
    VALUES (
        CONCAT('ORD-', RIGHT('000000' + CAST(@i AS NVARCHAR(6)), 6)),
        @customer_id,
        @status,
        @payment,
        CASE WHEN ABS(CHECKSUM(NEWID()) % 10) > 2 THEN 'paid' ELSE 'pending' END,
        @customer_id,
        0, 0, ROUND(ABS(CHECKSUM(NEWID()) % 1500) / 100.0 + 5, 2), 
        CASE WHEN ABS(CHECKSUM(NEWID()) % 10) > 7 THEN ROUND(ABS(CHECKSUM(NEWID()) % 5000) / 100.0, 2) ELSE 0 END,
        0,
        @order_date
    );
    SET @order_id = SCOPE_IDENTITY();
    
    SET @j = 1;
    WHILE @j <= ABS(CHECKSUM(NEWID()) % 4) + 1
    BEGIN
        SET @product_id = ABS(CHECKSUM(NEWID()) % 10) + 1;
        SET @qty = ABS(CHECKSUM(NEWID()) % 3) + 1;
        SELECT @unit_price = price FROM dbo.products WHERE id = @product_id;
        IF @unit_price IS NULL SET @unit_price = 29.99;
        
        INSERT INTO dbo.order_items (order_id, order_created_at, product_id, product_name, product_sku, quantity, unit_price, total_price)
        SELECT @order_id, @order_date, @product_id, p.name, p.sku, @qty, @unit_price, (@qty * @unit_price)
        FROM dbo.products p WHERE p.id = @product_id;
        
        SET @j = @j + 1;
    END;
    
    UPDATE o SET 
        subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM dbo.order_items WHERE order_id = o.id),
        tax_amount = (SELECT COALESCE(SUM(total_price * 0.0825), 0) FROM dbo.order_items WHERE order_id = o.id),
        total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM dbo.order_items WHERE order_id = o.id) + o.shipping_amount - o.discount_amount
    FROM dbo.orders o WHERE o.id = @order_id;
    
    SET @i = @i + 1;
END;
GO

INSERT INTO dbo.reviews (product_id, customer_id, rating, title, content, pros, cons, is_verified_purchase, is_approved, helpful_count) VALUES
(1, 1, 5, N'Best phone ever!', N'Amazing camera quality and battery life.', N'["Great camera", "Long battery"]', N'["Expensive"]', 1, 1, 45),
(1, 4, 4, N'Great but pricey', N'Excellent phone with minor drawbacks.', N'["Beautiful display", "Smooth UI"]', N'["Price", "Heavy"]', 1, 1, 23),
(2, 2, 4, N'Good value for money', N'Does everything I need.', N'["Affordable", "Reliable"]', N'["Basic camera"]', 1, 1, 12),
(3, 1, 5, N'Perfect for work', N'The best laptop I''ve ever owned.', N'["4K display", "Performance"]', N'["Heavy"]', 1, 1, 67),
(4, 3, 5, N'Silence is golden', N'The noise cancellation is incredible.', N'["ANC quality", "Comfort"]', NULL, 1, 1, 89),
(5, 4, 5, N'Gaming perfection', N'Load times are insane.', N'["Fast loading", "Great games"]', N'["Game prices"]', 1, 1, 156),
(7, 6, 5, N'Changed my running', N'Best running shoes I''ve owned.', N'["Comfort", "Support"]', NULL, 1, 1, 28),
(8, 1, 5, N'Couch potato approved', N'Most comfortable sofa ever.', N'["Comfort", "Size", "Quality"]', N'["Delivery time"]', 1, 1, 95);
GO

INSERT INTO dbo.all_data_types (
    col_bit, col_tinyint, col_smallint, col_int, col_bigint, col_decimal, col_numeric, col_float, col_real, col_money, col_smallmoney,
    col_char, col_varchar, col_nchar, col_nvarchar,
    col_binary, col_varbinary,
    col_date, col_time, col_datetime, col_datetime2, col_datetimeoffset, col_smalldatetime,
    col_uniqueidentifier, col_xml, col_hierarchyid, col_geography, col_geometry, col_sql_variant
) VALUES
(1, 255, 32767, 2147483647, 9223372036854775807, 12345678901234567890.123456789012345678, 9999999999999999999.999999999999999999, 3.141592653589793, 3.14159, $922337203685477.5807, $214748.3647,
 'CHAR100', 'Variable length string up to MAX', N'NCHAR100', N'Variable length Unicode string 你好世界 🚀',
 0xDEADBEEF, 0xCAFEBABE,
 '2024-06-15', '14:30:45.1234567', '2024-06-15 14:30:45', '2024-06-15 14:30:45.1234567', '2024-06-15 14:30:45.1234567 +05:30', '2024-06-15 14:30:00',
 NEWID(), N'<root><item id="1">XML content</item></root>', hierarchyid::Parse('/1/2/3/'), geography::Point(37.7749, -122.4194, 4326), geometry::STGeomFromText('POINT(1 1)', 0), 'SQL Variant Value'),
(0, 0, -32768, -2147483648, -9223372036854775808, -12345678901234567890.123456789012345678, -9999999999999999999.999999999999999999, -3.141592653589793, -3.14159, -$922337203685477.5808, -$214748.3648,
 'MIN', 'Minimum values test', N'MIN', N'Минимальные значения',
 0x00, 0x00,
 '1753-01-01', '00:00:00', '1753-01-01 00:00:00', '0001-01-01 00:00:00', '0001-01-01 00:00:00 +00:00', '1900-01-01 00:00:00',
 '00000000-0000-0000-0000-000000000000', N'<empty/>', hierarchyid::Parse('/'), NULL, NULL, 0);
GO

INSERT INTO dbo.null_patterns (description, all_null_row, nullable_int, nullable_text, nullable_bool, nullable_date, nullable_json) VALUES
(N'All nulls except id and description', NULL, NULL, NULL, NULL, NULL, NULL),
(N'Only text set', NULL, NULL, N'Some text here', NULL, NULL, NULL),
(N'Only int set', NULL, 42, NULL, NULL, NULL, NULL),
(N'Only bool set (true)', NULL, NULL, NULL, 1, NULL, NULL),
(N'Only bool set (false)', NULL, NULL, NULL, 0, NULL, NULL),
(N'Only date set', NULL, NULL, NULL, NULL, '2024-06-15', NULL),
(N'Only json set', NULL, NULL, NULL, NULL, NULL, N'{"key": "value"}'),
(N'All values set', N'not null', 100, N'Full row', 1, '2024-01-01', N'{"complete": true}'),
(N'Empty string vs null', N'', 0, N'', NULL, NULL, N'null');
GO

INSERT INTO dbo.unicode_samples (description, sample_text, category, char_count, byte_count) VALUES
(N'Basic ASCII', N'Hello, World!', N'ASCII', 13, 13),
(N'Emojis', N'🚀🎉✨💾🔧🎨🌈⚡🔥💡', N'Emoji', 10, 40),
(N'Chinese (Simplified)', N'你好世界！这是中文测试。', N'CJK', 12, 36),
(N'Japanese', N'こんにちは世界！日本語テスト', N'Japanese', 14, 42),
(N'Korean', N'안녕하세요 세계!', N'Korean', 9, 25),
(N'Arabic', N'مرحبا بالعالم!', N'RTL', 14, 27),
(N'Russian', N'Привет мир!', N'Cyrillic', 11, 21),
(N'Mixed Scripts', N'Hello こんにちは 你好 مرحبا 👋', N'Mixed', 24, 46),
(N'SQL Injection Attempt', N'''; DROP TABLE users; --', N'Security', 25, 25);
GO

INSERT INTO dbo.numeric_extremes (description, tiny_val, small_val, int_val, big_val, decimal_val, float_val, real_val, money_val) VALUES
(N'Maximum positive', 255, 32767, 2147483647, 9223372036854775807, 99999999999999999999.999999999999999999, 1.7976931348623157e+308, 3.4028235e+38, $922337203685477.5807),
(N'Minimum negative', 0, -32768, -2147483648, -9223372036854775808, -99999999999999999999.999999999999999999, -1.7976931348623157e+308, -3.4028235e+38, -$922337203685477.5808),
(N'Zero values', 0, 0, 0, 0, 0.0, 0, 0, $0.00),
(N'Pi approximations', NULL, NULL, 3, 3, 3.141592653589793238, 3.141592653589793, 3.1415927, $3.14);
GO

INSERT INTO dbo.json_documents (description, doc_json) VALUES
(N'Empty object', N'{}'),
(N'Empty array', N'[]'),
(N'Simple object', N'{"name": "John", "age": 30}'),
(N'Nested object', N'{"user": {"name": "Jane", "address": {"city": "NYC", "zip": "10001"}}}'),
(N'Array of objects', N'[{"id": 1, "name": "A"}, {"id": 2, "name": "B"}]'),
(N'All JSON types', N'{"string": "hello", "number": 42, "float": 3.14, "bool_t": true, "bool_f": false, "null_v": null, "array": [1, 2], "object": {"nested": true}}');
GO

INSERT INTO dbo.temporal_data (description, date_val, time_val, datetime_val, datetime2_val, datetimeoffset_val, smalldatetime_val) VALUES
(N'Current moment', CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME(7)), GETDATE(), SYSDATETIME(), SYSDATETIMEOFFSET(), CAST(GETDATE() AS SMALLDATETIME)),
(N'Unix epoch', '1970-01-01', '00:00:00', '1970-01-01 00:00:00', '1970-01-01 00:00:00', '1970-01-01 00:00:00 +00:00', '1970-01-01 00:00:00'),
(N'Y2K', '2000-01-01', '00:00:00', '2000-01-01 00:00:00', '2000-01-01 00:00:00', '2000-01-01 00:00:00 +00:00', '2000-01-01 00:00:00'),
(N'Leap day 2024', '2024-02-29', '12:00:00', '2024-02-29 12:00:00', '2024-02-29 12:00:00', '2024-02-29 12:00:00 +00:00', '2024-02-29 12:00:00'),
(N'End of day', '2024-12-31', '23:59:59.9999999', '2024-12-31 23:59:59', '2024-12-31 23:59:59.9999999', '2024-12-31 23:59:59.9999999 +00:00', '2024-12-31 23:59:00');
GO

INSERT INTO dbo.spatial_data (description, geography_point, geometry_point) VALUES
(N'Origin', geography::Point(0, 0, 4326), geometry::STGeomFromText('POINT(0 0)', 0)),
(N'San Francisco', geography::Point(37.7749, -122.4194, 4326), geometry::STGeomFromText('POINT(-122.4194 37.7749)', 0)),
(N'New York', geography::Point(40.7128, -74.0060, 4326), geometry::STGeomFromText('POINT(-74.0060 40.7128)', 0)),
(N'Tokyo', geography::Point(35.6762, 139.6503, 4326), geometry::STGeomFromText('POINT(139.6503 35.6762)', 0));
GO

INSERT INTO dbo.single_row_table (name, description) VALUES (N'Configuration', N'This table intentionally contains only one row for edge case testing.');
GO

DECLARE @batch INT = 1;
WHILE @batch <= 100
BEGIN
    INSERT INTO dbo.large_table (random_int, random_text, random_date, random_bool, category, amount)
    SELECT 
        ABS(CHECKSUM(NEWID()) % 1000000),
        CONCAT(N'Text_', n, N'_', SUBSTRING(CONVERT(NVARCHAR(36), NEWID()), 1, 8)),
        DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 1000), GETDATE()),
        CASE WHEN ABS(CHECKSUM(NEWID()) % 2) = 0 THEN 1 ELSE 0 END,
        CHOOSE((n % 5) + 1, 'A', 'B', 'C', 'D', 'E'),
        ROUND(ABS(CHECKSUM(NEWID()) % 1000000) / 100.0, 2)
    FROM (SELECT TOP 1000 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) + ((@batch - 1) * 1000) AS n FROM sys.objects a CROSS JOIN sys.objects b) nums;
    SET @batch = @batch + 1;
END;
GO

DECLARE @i INT = 1;
WHILE @i <= 100
BEGIN
    INSERT INTO dbo.wide_table (
        col_001, col_002, col_003, col_004, col_005, col_006, col_007, col_008, col_009, col_010,
        col_011, col_012, col_013, col_014, col_015, col_016, col_017, col_018, col_019, col_020,
        col_021, col_022, col_023, col_024, col_025, col_026, col_027, col_028, col_029, col_030,
        col_031, col_032, col_033, col_034, col_035, col_036, col_037, col_038, col_039, col_040,
        col_041, col_042, col_043, col_044, col_045, col_046, col_047, col_048, col_049, col_050
    ) VALUES (
        CONCAT(N'A', @i), CONCAT(N'B', @i), CONCAT(N'C', @i), CONCAT(N'D', @i), CONCAT(N'E', @i),
        CONCAT(N'F', @i), CONCAT(N'G', @i), CONCAT(N'H', @i), CONCAT(N'I', @i), CONCAT(N'J', @i),
        @i, @i*2, @i*3, @i*4, @i*5, @i*6, @i*7, @i*8, @i*9, @i*10,
        @i/100.0, @i/200.0, @i/300.0, @i/400.0, @i/500.0,
        CASE WHEN @i%2=0 THEN 1 ELSE 0 END, CASE WHEN @i%3=0 THEN 1 ELSE 0 END, CASE WHEN @i%4=0 THEN 1 ELSE 0 END, CASE WHEN @i%5=0 THEN 1 ELSE 0 END, CASE WHEN @i%6=0 THEN 1 ELSE 0 END,
        DATEADD(DAY, -@i, GETDATE()), DATEADD(DAY, -@i*2, GETDATE()), DATEADD(DAY, -@i*3, GETDATE()), DATEADD(DAY, -@i*4, GETDATE()), DATEADD(DAY, -@i*5, GETDATE()),
        DATEADD(HOUR, -@i, GETDATE()), DATEADD(HOUR, -@i*2, GETDATE()), DATEADD(HOUR, -@i*3, GETDATE()), DATEADD(HOUR, -@i*4, GETDATE()), DATEADD(HOUR, -@i*5, GETDATE()),
        CONCAT(N'Text block ', @i), CONCAT(N'Description ', @i), CONCAT(N'Notes ', @i), CONCAT(N'Comment ', @i), CONCAT(N'Detail ', @i),
        CONCAT(N'{"index": ', @i, N'}'), CONCAT(N'{"value": ', @i*10, N'}'), CONCAT(N'{"count": ', @i*100, N'}'), CONCAT(N'{"id": "row_', @i, N'"}'), CONCAT(N'{"meta": {"row": ', @i, N'}}')
    );
    SET @i = @i + 1;
END;
GO

PRINT 'SQL Server seed completed successfully!';
SELECT 'customers' AS [table], COUNT(*) AS [count] FROM dbo.customers
UNION ALL SELECT 'products', COUNT(*) FROM dbo.products
UNION ALL SELECT 'orders', COUNT(*) FROM dbo.orders
UNION ALL SELECT 'large_table', COUNT(*) FROM dbo.large_table;
GO
