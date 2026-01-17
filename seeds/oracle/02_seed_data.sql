-- Oracle Seed Data (E-commerce) - Matches PostgreSQL/MySQL/SQL Server

-- Customers
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('alice.johnson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Alice', 'Johnson', '+1-555-0101', DATE '1985-03-15', 'F', 1, 1, 2500, '{"theme": "dark", "newsletter": true}', '{"tier": "gold", "source": "organic"}', SYSTIMESTAMP - INTERVAL '2' HOUR);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('bob.smith@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Bob', 'Smith', '+1-555-0102', DATE '1990-07-22', 'M', 1, 1, 1200, '{"theme": "light", "newsletter": false}', '{"tier": "silver", "source": "referral"}', SYSTIMESTAMP - INTERVAL '1' DAY);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('carol.williams@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Carol', 'Williams', '+1-555-0103', DATE '1978-11-08', 'F', 1, 0, 500, '{"theme": "auto", "newsletter": true}', '{"tier": "bronze", "source": "ads"}', SYSTIMESTAMP - INTERVAL '5' DAY);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('david.brown@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'David', 'Brown', '+1-555-0104', DATE '1995-01-30', 'M', 1, 1, 8500, '{"theme": "dark", "newsletter": true}', '{"tier": "platinum", "source": "organic"}', SYSTIMESTAMP - INTERVAL '30' MINUTE);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('emma.davis@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Emma', 'Davis', '+1-555-0105', DATE '1988-09-12', 'F', 1, 1, 3200, '{"theme": "light", "newsletter": false}', '{"tier": "gold", "source": "social"}', SYSTIMESTAMP - INTERVAL '3' HOUR);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('frank.miller@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Frank', 'Miller', '+1-555-0106', DATE '1982-04-25', 'M', 0, 1, 150, '{"theme": "dark", "newsletter": false}', '{"tier": "bronze", "source": "organic"}', SYSTIMESTAMP - INTERVAL '60' DAY);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('grace.wilson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Grace', 'Wilson', '+1-555-0107', DATE '1992-12-03', 'F', 1, 1, 4100, '{"theme": "auto", "newsletter": true}', '{"tier": "gold", "source": "referral"}', SYSTIMESTAMP - INTERVAL '6' HOUR);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('henry.moore@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Henry', 'Moore', '+1-555-0108', DATE '1975-06-18', 'M', 1, 0, 750, '{"theme": "light", "newsletter": true}', '{"tier": "silver", "source": "ads"}', SYSTIMESTAMP - INTERVAL '2' DAY);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('ivy.taylor@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Ivy', 'Taylor', '+1-555-0109', DATE '1998-02-14', 'F', 1, 1, 1800, '{"theme": "dark", "newsletter": true}', '{"tier": "silver", "source": "organic"}', SYSTIMESTAMP - INTERVAL '12' HOUR);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('jack.anderson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Jack', 'Anderson', '+1-555-0110', DATE '1987-08-07', 'M', 1, 1, 950, '{"theme": "auto", "newsletter": false}', '{"tier": "bronze", "source": "social"}', SYSTIMESTAMP - INTERVAL '4' DAY);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('karen.thomas@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Karen', 'Thomas', '+1-555-0111', DATE '1993-05-21', 'F', 1, 1, 6200, '{"theme": "dark", "newsletter": true}', '{"tier": "platinum", "source": "organic"}', SYSTIMESTAMP - INTERVAL '1' HOUR);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('leo.jackson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Leo', 'Jackson', '+1-555-0112', DATE '1980-10-09', 'M', 1, 1, 2100, '{"theme": "light", "newsletter": true}', '{"tier": "gold", "source": "referral"}', SYSTIMESTAMP - INTERVAL '18' HOUR);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('mia.white@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Mia', 'White', '+1-555-0113', DATE '1996-07-28', 'F', 1, 0, 320, '{"theme": "dark", "newsletter": false}', '{"tier": "bronze", "source": "ads"}', SYSTIMESTAMP - INTERVAL '7' DAY);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('noah.harris@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Noah', 'Harris', '+1-555-0114', DATE '1984-03-16', 'M', 1, 1, 4800, '{"theme": "auto", "newsletter": true}', '{"tier": "gold", "source": "organic"}', SYSTIMESTAMP - INTERVAL '5' HOUR);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('olivia.martin@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Olivia', 'Martin', '+1-555-0115', DATE '1991-11-24', 'F', 1, 1, 1500, '{"theme": "light", "newsletter": true}', '{"tier": "silver", "source": "social"}', SYSTIMESTAMP - INTERVAL '2' DAY);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('peter.garcia@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Peter', 'Garcia', '+1-555-0116', DATE '1977-09-05', 'M', 0, 1, 50, '{"theme": "dark", "newsletter": false}', '{"tier": "bronze", "source": "organic"}', NULL);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('quinn.martinez@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Quinn', 'Martinez', '+1-555-0117', DATE '1999-01-11', 'O', 1, 1, 2800, '{"theme": "auto", "newsletter": true}', '{"tier": "gold", "source": "referral"}', SYSTIMESTAMP - INTERVAL '45' MINUTE);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('rachel.robinson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Rachel', 'Robinson', '+1-555-0118', DATE '1986-06-30', 'F', 1, 1, 5500, '{"theme": "dark", "newsletter": true}', '{"tier": "platinum", "source": "organic"}', SYSTIMESTAMP - INTERVAL '3' HOUR);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('sam.clark@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Sam', 'Clark', '+1-555-0119', DATE '1994-04-17', 'M', 1, 0, 680, '{"theme": "light", "newsletter": false}', '{"tier": "bronze", "source": "ads"}', SYSTIMESTAMP - INTERVAL '10' DAY);
INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('tina.rodriguez@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Tina', 'Rodriguez', '+1-555-0120', DATE '1983-12-22', 'F', 1, 1, 3900, '{"theme": "dark", "newsletter": true}', '{"tier": "gold", "source": "social"}', SYSTIMESTAMP - INTERVAL '8' HOUR);

-- Addresses
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (1, 'both', '123 Main Street', 'Apt 4B', 'New York', 'NY', '10001', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (2, 'both', '789 Oak Avenue', NULL, 'Los Angeles', 'CA', '90001', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (3, 'billing', '321 Pine Road', NULL, 'Chicago', 'IL', '60601', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (4, 'both', '987 Cedar Lane', NULL, 'Houston', 'TX', '77001', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (5, 'both', '147 Maple Drive', 'Floor 2', 'Phoenix', 'AZ', '85001', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (6, 'both', '258 Birch Court', NULL, 'Philadelphia', 'PA', '19101', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (7, 'both', '369 Walnut Way', 'Apt 12', 'San Antonio', 'TX', '78201', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (8, 'both', '741 Cherry Boulevard', NULL, 'San Diego', 'CA', '92101', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (9, 'both', '852 Spruce Street', 'Suite 300', 'Dallas', 'TX', '75201', 'US', 1);
INSERT INTO addresses (customer_id, address_type, street_line1, street_line2, city, state, postal_code, country, is_default) VALUES (10, 'both', '963 Ash Avenue', NULL, 'San Jose', 'CA', '95101', 'US', 1);

-- Categories
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (NULL, 'Electronics', 'electronics', 'Electronic devices and accessories', 1, 1);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (NULL, 'Clothing', 'clothing', 'Apparel and fashion items', 1, 2);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (NULL, 'Home and Garden', 'home-garden', 'Home improvement and garden supplies', 1, 3);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (NULL, 'Sports and Outdoors', 'sports-outdoors', 'Sports equipment and outdoor gear', 1, 4);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (NULL, 'Books and Media', 'books-media', 'Books, music, and movies', 1, 5);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (1, 'Smartphones', 'smartphones', 'Mobile phones and accessories', 1, 1);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (1, 'Laptops', 'laptops', 'Laptop computers and accessories', 1, 2);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (1, 'Audio', 'audio', 'Headphones, speakers, and audio equipment', 1, 3);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (1, 'Cameras', 'cameras', 'Digital cameras and photography equipment', 1, 4);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (1, 'Gaming', 'gaming', 'Video games and gaming accessories', 1, 5);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (2, 'Mens Clothing', 'mens-clothing', 'Clothing for men', 1, 1);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (2, 'Womens Clothing', 'womens-clothing', 'Clothing for women', 1, 2);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (2, 'Shoes', 'shoes', 'Footwear for all', 1, 4);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (3, 'Furniture', 'furniture', 'Home furniture', 1, 1);
INSERT INTO categories (parent_id, name, slug, description, is_active, sort_order) VALUES (3, 'Kitchen', 'kitchen', 'Kitchen appliances and tools', 1, 2);

-- Suppliers
INSERT INTO suppliers (company_name, contact_name, contact_email, contact_phone, address, country, is_active, rating) VALUES ('TechWorld Inc.', 'John Tech', 'john@techworld.com', '+1-800-TECH-001', '100 Silicon Valley Blvd, San Jose, CA 95110', 'US', 1, 4.75);
INSERT INTO suppliers (company_name, contact_name, contact_email, contact_phone, address, country, is_active, rating) VALUES ('Fashion Forward Ltd.', 'Maria Style', 'maria@fashionforward.com', '+1-800-FASH-002', '200 Fashion Ave, New York, NY 10018', 'US', 1, 4.50);
INSERT INTO suppliers (company_name, contact_name, contact_email, contact_phone, address, country, is_active, rating) VALUES ('HomeGoods Global', 'Robert Home', 'robert@homegoods.com', '+1-800-HOME-003', '300 Comfort Lane, Chicago, IL 60601', 'US', 1, 4.25);
INSERT INTO suppliers (company_name, contact_name, contact_email, contact_phone, address, country, is_active, rating) VALUES ('Sports Elite', 'Sarah Sport', 'sarah@sportselite.com', '+1-800-SPRT-004', '400 Athletic Way, Denver, CO 80201', 'US', 1, 4.80);
INSERT INTO suppliers (company_name, contact_name, contact_email, contact_phone, address, country, is_active, rating) VALUES ('BookMart International', 'David Book', 'david@bookmart.com', '+1-800-BOOK-005', '500 Literary Road, Boston, MA 02101', 'US', 1, 4.60);

-- Products
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('PHONE-001', 'ProMax Smartphone X', 'promax-smartphone-x', 'The latest flagship smartphone with advanced AI capabilities.', 'Flagship 5G smartphone with AI features', 6, 1, 999.99, 650.00, 1199.99, 0.195, 1, 1, 8.25, '{"length": 16.5, "width": 7.8, "height": 0.8}', '["smartphone", "5G", "flagship"]', '{"color": "Midnight Black", "storage": "256GB"}', '[{"url": "https://cdn.example.com/phone-001-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('PHONE-002', 'BudgetPhone SE', 'budgetphone-se', 'Affordable smartphone with essential features.', 'Affordable everyday smartphone', 6, 1, 299.99, 180.00, 349.99, 0.175, 1, 0, 8.25, '{"length": 15.0, "width": 7.2, "height": 0.9}', '["smartphone", "budget"]', '{"color": "White", "storage": "64GB"}', '[{"url": "https://cdn.example.com/phone-002-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('LAPTOP-001', 'UltraBook Pro 15', 'ultrabook-pro-15', 'Premium ultrabook with Intel Core i9, 32GB RAM, 1TB SSD.', 'Premium 15 inch ultrabook for professionals', 7, 1, 1899.99, 1200.00, 2199.99, 1.85, 1, 1, 8.25, '{"length": 35.5, "width": 24.0, "height": 1.6}', '["laptop", "ultrabook", "professional"]', '{"processor": "Intel Core i9", "ram": "32GB"}', '[{"url": "https://cdn.example.com/laptop-001-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('AUDIO-001', 'NoiseCancel Pro Headphones', 'noisecancel-pro-headphones', 'Premium wireless headphones with active noise cancellation.', 'Premium ANC wireless headphones', 8, 1, 349.99, 180.00, 399.99, 0.255, 1, 1, 8.25, '{"length": 18.0, "width": 16.0, "height": 8.0}', '["headphones", "wireless", "ANC"]', '{"type": "Over-ear", "battery_life": "40 hours"}', '[{"url": "https://cdn.example.com/audio-001-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('GAME-001', 'GameStation 6', 'gamestation-6', 'Next-generation gaming console with 4K 120fps gaming.', 'Next-gen gaming console', 10, 1, 499.99, 380.00, 549.99, 4.5, 1, 1, 8.25, '{"length": 39.0, "width": 26.0, "height": 10.4}', '["gaming", "console", "4K"]', '{"storage": "1TB SSD", "resolution": "4K 120fps"}', '[{"url": "https://cdn.example.com/game-001-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('SHIRT-001', 'Classic Oxford Shirt', 'classic-oxford-shirt', 'Timeless Oxford button-down shirt made from 100 percent premium cotton.', 'Premium cotton Oxford shirt', 11, 2, 59.99, 22.00, 79.99, 0.28, 1, 0, 0.00, '{"length": 76, "width": 58, "height": 2}', '["shirt", "oxford", "cotton"]', '{"material": "100% Cotton", "fit": "Regular"}', '[{"url": "https://cdn.example.com/shirt-001-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('SHOE-001', 'RunMax Athletic Shoes', 'runmax-athletic-shoes', 'High-performance running shoes with responsive cushioning.', 'High-performance running shoes', 13, 2, 129.99, 55.00, 159.99, 0.62, 1, 1, 0.00, '{"length": 30, "width": 12, "height": 10}', '["shoes", "running", "athletic"]', '{"material": "Mesh upper", "cushioning": "Responsive foam"}', '[{"url": "https://cdn.example.com/shoe-001-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('SOFA-001', 'ComfortPlus Sectional Sofa', 'comfortplus-sectional-sofa', 'Spacious L-shaped sectional sofa with memory foam cushions.', 'L-shaped sectional with memory foam', 14, 3, 1499.99, 750.00, 1899.99, 95.0, 1, 1, 8.25, '{"length": 290, "width": 180, "height": 85}', '["sofa", "sectional", "furniture"]', '{"material": "Premium fabric", "frame": "Hardwood"}', '[{"url": "https://cdn.example.com/sofa-001-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('KNIFE-001', 'ChefMaster Knife Set', 'chefmaster-knife-set', 'Professional 15-piece knife set with high-carbon stainless steel blades.', 'Professional 15-piece knife set', 15, 3, 199.99, 85.00, 249.99, 3.2, 1, 0, 8.25, '{"length": 40, "width": 25, "height": 35}', '["kitchen", "knives", "chef"]', '{"pieces": 15, "material": "Stainless steel"}', '[{"url": "https://cdn.example.com/knife-001-1.jpg"}]');
INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, weight_kg, is_active, is_featured, tax_rate, dimensions, tags, attributes, images) VALUES
('BOOK-001', 'The Art of Programming', 'the-art-of-programming', 'Comprehensive guide to software development best practices.', 'Programming best practices guide', 5, 5, 49.99, 15.00, 59.99, 0.95, 1, 0, 0.00, '{"length": 24, "width": 17, "height": 4}', '["book", "programming", "technology"]', '{"author": "Dr. Jane Developer", "pages": 650}', '[{"url": "https://cdn.example.com/book-001-1.jpg"}]');

-- Inventory
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (1, 'MAIN', 150, 12, 20, 100, SYSTIMESTAMP - INTERVAL '5' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (2, 'MAIN', 500, 25, 50, 200, SYSTIMESTAMP - INTERVAL '7' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (3, 'MAIN', 45, 3, 10, 30, SYSTIMESTAMP - INTERVAL '10' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (4, 'MAIN', 120, 15, 20, 80, SYSTIMESTAMP - INTERVAL '6' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (5, 'MAIN', 80, 10, 15, 50, SYSTIMESTAMP - INTERVAL '9' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (6, 'MAIN', 300, 20, 40, 120, SYSTIMESTAMP - INTERVAL '5' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (7, 'MAIN', 180, 12, 25, 80, SYSTIMESTAMP - INTERVAL '3' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (8, 'MAIN', 15, 1, 3, 10, SYSTIMESTAMP - INTERVAL '20' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (9, 'MAIN', 250, 18, 35, 100, SYSTIMESTAMP - INTERVAL '6' DAY);
INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES (10, 'MAIN', 400, 30, 50, 150, SYSTIMESTAMP - INTERVAL '4' DAY);

-- Generate Orders with PL/SQL
DECLARE
    v_customer_id NUMBER;
    v_order_date TIMESTAMP;
    v_status VARCHAR2(20);
    v_payment VARCHAR2(20);
    v_total NUMBER(12,2);
    v_order_id NUMBER;
BEGIN
    FOR i IN 1..100 LOOP
        v_customer_id := MOD(i, 20) + 1;
        v_order_date := SYSTIMESTAMP - NUMTODSINTERVAL(DBMS_RANDOM.VALUE(1, 365), 'DAY');
        
        CASE MOD(i, 7)
            WHEN 0 THEN v_status := 'pending';
            WHEN 1 THEN v_status := 'confirmed';
            WHEN 2 THEN v_status := 'processing';
            WHEN 3 THEN v_status := 'shipped';
            WHEN 4 THEN v_status := 'delivered';
            WHEN 5 THEN v_status := 'cancelled';
            ELSE v_status := 'refunded';
        END CASE;
        
        CASE MOD(i, 4)
            WHEN 0 THEN v_payment := 'credit_card';
            WHEN 1 THEN v_payment := 'debit_card';
            WHEN 2 THEN v_payment := 'paypal';
            ELSE v_payment := 'bank_transfer';
        END CASE;
        
        v_total := ROUND(DBMS_RANDOM.VALUE(50, 2000), 2);
        
        INSERT INTO orders (order_number, customer_id, status, payment_method, payment_status, subtotal, tax_amount, total_amount, created_at)
        VALUES ('ORD-' || LPAD(TO_CHAR(i), 6, '0'), v_customer_id, v_status, v_payment, 
                CASE WHEN MOD(i, 3) = 0 THEN 'pending' ELSE 'paid' END,
                v_total * 0.9, v_total * 0.1, v_total, v_order_date)
        RETURNING id INTO v_order_id;
        
        FOR j IN 1..MOD(i, 3) + 1 LOOP
            INSERT INTO order_items (order_id, order_created_at, product_id, product_name, product_sku, quantity, unit_price, total_price)
            SELECT v_order_id, v_order_date, id, name, sku, MOD(j, 3) + 1, price, price * (MOD(j, 3) + 1)
            FROM products WHERE id = MOD(j + i, 10) + 1;
        END LOOP;
    END LOOP;
    COMMIT;
END;
/

-- Unicode Samples
INSERT INTO unicode_samples (description, sample_text, category, char_count, byte_count) VALUES ('Japanese Text', N'日本語テキスト', 'CJK', 7, 21);
INSERT INTO unicode_samples (description, sample_text, category, char_count, byte_count) VALUES ('Chinese Text', N'中文文本测试', 'CJK', 6, 18);
INSERT INTO unicode_samples (description, sample_text, category, char_count, byte_count) VALUES ('Korean Text', N'한국어 텍스트', 'CJK', 7, 21);
INSERT INTO unicode_samples (description, sample_text, category, char_count, byte_count) VALUES ('Russian Text', N'Русский текст', 'Cyrillic', 13, 26);

-- Numeric Extremes
INSERT INTO numeric_extremes (description, tiny_val, small_val, int_val, big_val, decimal_val, float_val, double_val) VALUES ('Maximum Values', 127, 32767, 2147483647, 9223372036854775807, 99999999999999999999.999999999999999999, 3.4028235E+38, 1.7976931348623157E+308);
INSERT INTO numeric_extremes (description, tiny_val, small_val, int_val, big_val, decimal_val, float_val, double_val) VALUES ('Zero Values', 0, 0, 0, 0, 0, 0, 0);

-- JSON Documents
INSERT INTO json_documents (description, doc_json) VALUES ('Simple Object', '{"name": "Test", "value": 123}');
INSERT INTO json_documents (description, doc_json) VALUES ('Nested Object', '{"user": {"name": "John", "address": {"city": "NYC", "zip": "10001"}}}');
INSERT INTO json_documents (description, doc_json) VALUES ('Array', '[1, 2, 3, "four", {"five": 5}]');

-- Null Patterns
INSERT INTO null_patterns (description, all_null_row, nullable_int, nullable_text, nullable_bool, nullable_date, nullable_json) VALUES ('All Nulls', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO null_patterns (description, all_null_row, nullable_int, nullable_text, nullable_bool, nullable_date, nullable_json) VALUES ('All Values', 'Has Value', 42, 'Some text', 1, SYSDATE, '{"key": "value"}');

-- Large Table (1000 rows)
BEGIN
    FOR i IN 1..1000 LOOP
        INSERT INTO large_table (random_int, random_text, random_date, random_bool, category, amount)
        VALUES (
            ROUND(DBMS_RANDOM.VALUE(1, 10000)),
            'Item_' || LPAD(TO_CHAR(i), 5, '0'),
            SYSDATE - DBMS_RANDOM.VALUE(1, 365),
            MOD(i, 2),
            CASE MOD(i, 5) WHEN 0 THEN 'Electronics' WHEN 1 THEN 'Clothing' WHEN 2 THEN 'Home' WHEN 3 THEN 'Sports' ELSE 'Books' END,
            ROUND(DBMS_RANDOM.VALUE(10, 1000), 2)
        );
    END LOOP;
    COMMIT;
END;
/

-- Single Row Table
INSERT INTO single_row_table (name, description) VALUES ('Configuration', 'This is the single configuration row for testing single-row scenarios');

COMMIT;
