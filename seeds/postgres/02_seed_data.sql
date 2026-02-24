-- ============================================================================
-- Query Pilot - PostgreSQL Seed Data
-- ============================================================================
-- SECURITY NOTE: All credentials in this file are for DEVELOPMENT ONLY.
-- The password hash '$2b$12$LQv3c1yqBwEHbNkZxK7Uru' is a bcrypt placeholder.
-- NEVER use these values in production environments.
-- ============================================================================

-- ============================================================================
-- ECOMMERCE DOMAIN DATA
-- ============================================================================

INSERT INTO customers (email, password_hash, first_name, last_name, phone, date_of_birth, gender, is_active, is_verified, loyalty_points, preferences, metadata, last_login_at) VALUES
('alice.johnson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Alice', 'Johnson', '+1-555-0101', '1985-03-15', 'F', true, true, 2500, '{"theme": "dark", "newsletter": true, "language": "en"}', '"tier"=>"gold", "source"=>"organic"', NOW() - INTERVAL '2 hours'),
('bob.smith@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Bob', 'Smith', '+1-555-0102', '1990-07-22', 'M', true, true, 1200, '{"theme": "light", "newsletter": false, "language": "en"}', '"tier"=>"silver", "source"=>"referral"', NOW() - INTERVAL '1 day'),
('carol.williams@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Carol', 'Williams', '+1-555-0103', '1978-11-08', 'F', true, false, 500, '{"theme": "auto", "newsletter": true, "language": "es"}', '"tier"=>"bronze", "source"=>"ads"', NOW() - INTERVAL '5 days'),
('david.brown@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'David', 'Brown', '+1-555-0104', '1995-01-30', 'M', true, true, 8500, '{"theme": "dark", "newsletter": true, "language": "en"}', '"tier"=>"platinum", "source"=>"organic"', NOW() - INTERVAL '30 minutes'),
('emma.davis@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Emma', 'Davis', '+1-555-0105', '1988-09-12', 'F', true, true, 3200, '{"theme": "light", "newsletter": false, "language": "fr"}', '"tier"=>"gold", "source"=>"social"', NOW() - INTERVAL '3 hours'),
('frank.miller@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Frank', 'Miller', '+1-555-0106', '1982-04-25', 'M', false, true, 150, '{"theme": "dark", "newsletter": false, "language": "en"}', '"tier"=>"bronze", "source"=>"organic"', NOW() - INTERVAL '60 days'),
('grace.wilson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Grace', 'Wilson', '+1-555-0107', '1992-12-03', 'F', true, true, 4100, '{"theme": "auto", "newsletter": true, "language": "de"}', '"tier"=>"gold", "source"=>"referral"', NOW() - INTERVAL '6 hours'),
('henry.moore@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Henry', 'Moore', '+1-555-0108', '1975-06-18', 'M', true, false, 750, '{"theme": "light", "newsletter": true, "language": "en"}', '"tier"=>"silver", "source"=>"ads"', NOW() - INTERVAL '2 days'),
('ivy.taylor@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Ivy', 'Taylor', '+1-555-0109', '1998-02-14', 'F', true, true, 1800, '{"theme": "dark", "newsletter": true, "language": "en"}', '"tier"=>"silver", "source"=>"organic"', NOW() - INTERVAL '12 hours'),
('jack.anderson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Jack', 'Anderson', '+1-555-0110', '1987-08-07', 'M', true, true, 950, '{"theme": "auto", "newsletter": false, "language": "ja"}', '"tier"=>"bronze", "source"=>"social"', NOW() - INTERVAL '4 days'),
('karen.thomas@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Karen', 'Thomas', '+1-555-0111', '1993-05-21', 'F', true, true, 6200, '{"theme": "dark", "newsletter": true, "language": "en"}', '"tier"=>"platinum", "source"=>"organic"', NOW() - INTERVAL '1 hour'),
('leo.jackson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Leo', 'Jackson', '+1-555-0112', '1980-10-09', 'M', true, true, 2100, '{"theme": "light", "newsletter": true, "language": "en"}', '"tier"=>"gold", "source"=>"referral"', NOW() - INTERVAL '18 hours'),
('mia.white@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Mia', 'White', '+1-555-0113', '1996-07-28', 'F', true, false, 320, '{"theme": "dark", "newsletter": false, "language": "pt"}', '"tier"=>"bronze", "source"=>"ads"', NOW() - INTERVAL '7 days'),
('noah.harris@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Noah', 'Harris', '+1-555-0114', '1984-03-16', 'M', true, true, 4800, '{"theme": "auto", "newsletter": true, "language": "en"}', '"tier"=>"gold", "source"=>"organic"', NOW() - INTERVAL '5 hours'),
('olivia.martin@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Olivia', 'Martin', '+1-555-0115', '1991-11-24', 'F', true, true, 1500, '{"theme": "light", "newsletter": true, "language": "it"}', '"tier"=>"silver", "source"=>"social"', NOW() - INTERVAL '2 days'),
('peter.garcia@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Peter', 'Garcia', '+1-555-0116', '1977-09-05', 'M', false, true, 50, '{"theme": "dark", "newsletter": false, "language": "en"}', '"tier"=>"bronze", "source"=>"organic"', NULL),
('quinn.martinez@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Quinn', 'Martinez', '+1-555-0117', '1999-01-11', 'O', true, true, 2800, '{"theme": "auto", "newsletter": true, "language": "en"}', '"tier"=>"gold", "source"=>"referral"', NOW() - INTERVAL '45 minutes'),
('rachel.robinson@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Rachel', 'Robinson', '+1-555-0118', '1986-06-30', 'F', true, true, 5500, '{"theme": "dark", "newsletter": true, "language": "en"}', '"tier"=>"platinum", "source"=>"organic"', NOW() - INTERVAL '3 hours'),
('sam.clark@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Sam', 'Clark', '+1-555-0119', '1994-04-17', 'M', true, false, 680, '{"theme": "light", "newsletter": false, "language": "ko"}', '"tier"=>"bronze", "source"=>"ads"', NOW() - INTERVAL '10 days'),
('tina.rodriguez@email.com', '$2b$12$LQv3c1yqBwEHbNkZxK7Uru', 'Tina', 'Rodriguez', '+1-555-0120', '1983-12-22', 'F', true, true, 3900, '{"theme": "dark", "newsletter": true, "language": "en"}', '"tier"=>"gold", "source"=>"social"', NOW() - INTERVAL '8 hours');

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
(10, 'both', '963 Ash Avenue', NULL, 'San Jose', 'CA', '95101', 'US', true),
(11, 'both', '159 Hickory Lane', 'Apt 7C', 'Austin', 'TX', '78701', 'US', true),
(12, 'both', '357 Willow Road', NULL, 'Jacksonville', 'FL', '32099', 'US', true),
(13, 'both', '486 Poplar Street', 'Unit 8', 'Fort Worth', 'TX', '76101', 'US', true),
(14, 'both', '624 Sycamore Drive', NULL, 'Columbus', 'OH', '43085', 'US', true),
(15, 'both', '753 Magnolia Court', 'Floor 4', 'Charlotte', 'NC', '28201', 'US', true),
(16, 'both', '891 Redwood Way', NULL, 'Indianapolis', 'IN', '46201', 'US', true),
(17, 'both', '234 Sequoia Boulevard', 'Apt 22', 'Seattle', 'WA', '98101', 'US', true),
(18, 'both', '567 Palm Avenue', NULL, 'Denver', 'CO', '80201', 'US', true),
(19, 'both', '890 Cypress Lane', 'Suite 50', 'Boston', 'MA', '02101', 'US', true),
(20, 'both', '112 Juniper Road', NULL, 'Nashville', 'TN', '37201', 'US', true);

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
(2, 'Men''s Clothing', 'mens-clothing', 'Clothing for men', 'https://cdn.example.com/categories/mens.jpg', true, 1),
(2, 'Women''s Clothing', 'womens-clothing', 'Clothing for women', 'https://cdn.example.com/categories/womens.jpg', true, 2),
(2, 'Kids'' Clothing', 'kids-clothing', 'Clothing for children', 'https://cdn.example.com/categories/kids.jpg', true, 3),
(2, 'Shoes', 'shoes', 'Footwear for all', 'https://cdn.example.com/categories/shoes.jpg', true, 4),
(2, 'Accessories', 'accessories', 'Fashion accessories', 'https://cdn.example.com/categories/accessories.jpg', false, 5),
(3, 'Furniture', 'furniture', 'Home furniture', 'https://cdn.example.com/categories/furniture.jpg', true, 1),
(3, 'Kitchen', 'kitchen', 'Kitchen appliances and tools', 'https://cdn.example.com/categories/kitchen.jpg', true, 2),
(3, 'Garden Tools', 'garden-tools', 'Gardening equipment', 'https://cdn.example.com/categories/garden-tools.jpg', true, 3);

INSERT INTO suppliers (company_name, contact_name, contact_email, contact_phone, address, country, is_active, rating) VALUES
('TechWorld Inc.', 'John Tech', 'john@techworld.com', '+1-800-TECH-001', '100 Silicon Valley Blvd, San Jose, CA 95110', 'US', true, 4.75),
('Fashion Forward Ltd.', 'Maria Style', 'maria@fashionforward.com', '+1-800-FASH-002', '200 Fashion Ave, New York, NY 10018', 'US', true, 4.50),
('HomeGoods Global', 'Robert Home', 'robert@homegoods.com', '+1-800-HOME-003', '300 Comfort Lane, Chicago, IL 60601', 'US', true, 4.25),
('Sports Elite', 'Sarah Sport', 'sarah@sportselite.com', '+1-800-SPRT-004', '400 Athletic Way, Denver, CO 80201', 'US', true, 4.80),
('BookMart International', 'David Book', 'david@bookmart.com', '+1-800-BOOK-005', '500 Literary Road, Boston, MA 02101', 'US', true, 4.60),
('Asian Electronics Co.', 'Wei Chen', 'wei@asianelec.com', '+86-21-5555-0001', '600 Tech Park, Shenzhen, Guangdong', 'CN', true, 4.30),
('European Imports', 'Hans Mueller', 'hans@euroimports.com', '+49-30-5555-0002', '700 Europa Strasse, Berlin', 'DE', true, 4.45),
('Inactive Supplier Corp.', 'Ghost Contact', 'ghost@inactive.com', '+1-800-NONE-000', '000 Nowhere St', 'US', false, 2.00);

INSERT INTO products (sku, name, slug, description, short_description, category_id, supplier_id, price, cost_price, compare_at_price, currency, weight_kg, dimensions, is_active, is_featured, is_digital, tax_rate, tags, attributes, images, search_vector) VALUES
('PHONE-001', 'ProMax Smartphone X', 'promax-smartphone-x', 'The latest flagship smartphone with advanced AI capabilities, 6.7" OLED display, and 5G connectivity. Features include a 108MP camera system, 12GB RAM, and 256GB storage.', 'Flagship 5G smartphone with AI features', 6, 1, 999.99, 650.00, 1199.99, 'USD', 0.195, '{"length": 16.5, "width": 7.8, "height": 0.8, "unit": "cm"}', true, true, false, 8.25, ARRAY['smartphone', '5G', 'flagship', 'AI'], '{"color": "Midnight Black", "storage": "256GB", "ram": "12GB", "screen_size": "6.7 inches"}', '[{"url": "https://cdn.example.com/products/phone-001-1.jpg", "alt": "Front view"}, {"url": "https://cdn.example.com/products/phone-001-2.jpg", "alt": "Back view"}]', to_tsvector('english', 'ProMax Smartphone X flagship 5G AI camera OLED')),
('PHONE-002', 'BudgetPhone SE', 'budgetphone-se', 'Affordable smartphone with essential features. 6.1" LCD display, dual camera system, and reliable performance for everyday use.', 'Affordable everyday smartphone', 6, 1, 299.99, 180.00, 349.99, 'USD', 0.175, '{"length": 15.0, "width": 7.2, "height": 0.9, "unit": "cm"}', true, false, false, 8.25, ARRAY['smartphone', 'budget', 'affordable'], '{"color": "White", "storage": "64GB", "ram": "4GB", "screen_size": "6.1 inches"}', '[{"url": "https://cdn.example.com/products/phone-002-1.jpg", "alt": "Front view"}]', to_tsvector('english', 'BudgetPhone SE affordable budget everyday LCD')),
('LAPTOP-001', 'UltraBook Pro 15', 'ultrabook-pro-15', 'Premium ultrabook with Intel Core i9, 32GB RAM, 1TB SSD, and stunning 4K OLED display. Perfect for professionals and creators.', 'Premium 15" ultrabook for professionals', 7, 1, 1899.99, 1200.00, 2199.99, 'USD', 1.85, '{"length": 35.5, "width": 24.0, "height": 1.6, "unit": "cm"}', true, true, false, 8.25, ARRAY['laptop', 'ultrabook', 'professional', '4K'], '{"processor": "Intel Core i9", "ram": "32GB", "storage": "1TB SSD", "display": "15.6 inch 4K OLED"}', '[{"url": "https://cdn.example.com/products/laptop-001-1.jpg", "alt": "Open laptop"}, {"url": "https://cdn.example.com/products/laptop-001-2.jpg", "alt": "Side view"}]', to_tsvector('english', 'UltraBook Pro 15 premium ultrabook Intel i9 4K OLED professional')),
('LAPTOP-002', 'ChromeBook Lite', 'chromebook-lite', 'Lightweight ChromeBook for students and basic computing needs. 14" FHD display, 8GB RAM, and all-day battery life.', 'Lightweight ChromeBook for students', 7, 1, 349.99, 220.00, 399.99, 'USD', 1.25, '{"length": 32.0, "width": 22.0, "height": 1.8, "unit": "cm"}', true, false, false, 8.25, ARRAY['laptop', 'chromebook', 'student', 'lightweight'], '{"processor": "MediaTek", "ram": "8GB", "storage": "64GB eMMC", "display": "14 inch FHD"}', '[{"url": "https://cdn.example.com/products/laptop-002-1.jpg", "alt": "ChromeBook open"}]', to_tsvector('english', 'ChromeBook Lite lightweight student FHD')),
('AUDIO-001', 'NoiseCancel Pro Headphones', 'noisecancel-pro-headphones', 'Premium wireless headphones with active noise cancellation, 40-hour battery life, and Hi-Res audio certification.', 'Premium ANC wireless headphones', 8, 1, 349.99, 180.00, 399.99, 'USD', 0.255, '{"length": 18.0, "width": 16.0, "height": 8.0, "unit": "cm"}', true, true, false, 8.25, ARRAY['headphones', 'wireless', 'ANC', 'premium'], '{"type": "Over-ear", "connectivity": "Bluetooth 5.2", "battery_life": "40 hours", "driver_size": "40mm"}', '[{"url": "https://cdn.example.com/products/audio-001-1.jpg", "alt": "Headphones front"}]', to_tsvector('english', 'NoiseCancel Pro Headphones wireless ANC noise cancellation premium')),
('AUDIO-002', 'EarBuds Mini', 'earbuds-mini', 'Compact true wireless earbuds with IPX5 water resistance and 24-hour total battery life with charging case.', 'Compact true wireless earbuds', 8, 1, 79.99, 35.00, 99.99, 'USD', 0.052, '{"length": 6.0, "width": 4.5, "height": 2.8, "unit": "cm"}', true, false, false, 8.25, ARRAY['earbuds', 'wireless', 'compact', 'waterproof'], '{"type": "In-ear", "connectivity": "Bluetooth 5.0", "battery_life": "6 hours (24 with case)", "water_resistance": "IPX5"}', '[{"url": "https://cdn.example.com/products/audio-002-1.jpg", "alt": "Earbuds with case"}]', to_tsvector('english', 'EarBuds Mini compact wireless true IPX5 waterproof')),
('CAM-001', 'MirrorPro Camera', 'mirrorpro-camera', 'Professional mirrorless camera with 45MP full-frame sensor, 8K video recording, and advanced autofocus system with eye-tracking.', 'Professional 45MP mirrorless camera', 9, 1, 2499.99, 1600.00, 2799.99, 'USD', 0.657, '{"length": 13.6, "width": 9.8, "height": 8.0, "unit": "cm"}', true, true, false, 8.25, ARRAY['camera', 'mirrorless', 'professional', '8K'], '{"sensor": "45MP Full-Frame", "video": "8K 30fps", "autofocus": "Eye-tracking AF", "stabilization": "In-body 5-axis"}', '[{"url": "https://cdn.example.com/products/cam-001-1.jpg", "alt": "Camera front"}, {"url": "https://cdn.example.com/products/cam-001-2.jpg", "alt": "Camera with lens"}]', to_tsvector('english', 'MirrorPro Camera professional mirrorless 45MP 8K full-frame')),
('GAME-001', 'GameStation 6', 'gamestation-6', 'Next-generation gaming console with 4K 120fps gaming, 1TB SSD, ray tracing, and backward compatibility.', 'Next-gen gaming console', 10, 1, 499.99, 380.00, 549.99, 'USD', 4.5, '{"length": 39.0, "width": 26.0, "height": 10.4, "unit": "cm"}', true, true, false, 8.25, ARRAY['gaming', 'console', '4K', 'next-gen'], '{"storage": "1TB SSD", "resolution": "4K 120fps", "features": "Ray Tracing, Backward Compatible"}', '[{"url": "https://cdn.example.com/products/game-001-1.jpg", "alt": "Console front"}]', to_tsvector('english', 'GameStation 6 next-generation gaming console 4K 120fps ray tracing')),
('SHIRT-001', 'Classic Oxford Shirt', 'classic-oxford-shirt', 'Timeless Oxford button-down shirt made from 100% premium cotton. Perfect for business casual or smart occasions.', 'Premium cotton Oxford shirt', 11, 2, 59.99, 22.00, 79.99, 'USD', 0.28, '{"length": 76, "width": 58, "height": 2, "unit": "cm"}', true, false, false, 0.00, ARRAY['shirt', 'oxford', 'cotton', 'business'], '{"material": "100% Cotton", "fit": "Regular", "care": "Machine washable", "sizes": ["S", "M", "L", "XL", "XXL"]}', '[{"url": "https://cdn.example.com/products/shirt-001-1.jpg", "alt": "Shirt front"}]', to_tsvector('english', 'Classic Oxford Shirt cotton button-down business casual')),
('DRESS-001', 'Elegant Evening Dress', 'elegant-evening-dress', 'Stunning floor-length evening dress with intricate beading and flattering silhouette. Perfect for formal events.', 'Floor-length beaded evening dress', 12, 2, 299.99, 120.00, 399.99, 'USD', 0.85, '{"length": 150, "width": 45, "height": 3, "unit": "cm"}', true, true, false, 0.00, ARRAY['dress', 'evening', 'formal', 'beaded'], '{"material": "Polyester blend with beading", "fit": "Fitted", "occasion": "Formal/Evening", "sizes": ["XS", "S", "M", "L"]}', '[{"url": "https://cdn.example.com/products/dress-001-1.jpg", "alt": "Dress full view"}]', to_tsvector('english', 'Elegant Evening Dress floor-length beaded formal stunning')),
('SHOE-001', 'RunMax Athletic Shoes', 'runmax-athletic-shoes', 'High-performance running shoes with responsive cushioning, breathable mesh upper, and durable rubber outsole.', 'High-performance running shoes', 14, 2, 129.99, 55.00, 159.99, 'USD', 0.62, '{"length": 30, "width": 12, "height": 10, "unit": "cm"}', true, true, false, 0.00, ARRAY['shoes', 'running', 'athletic', 'performance'], '{"material": "Mesh upper, rubber sole", "cushioning": "Responsive foam", "sizes": [7, 8, 9, 10, 11, 12]}', '[{"url": "https://cdn.example.com/products/shoe-001-1.jpg", "alt": "Shoe side view"}]', to_tsvector('english', 'RunMax Athletic Shoes running high-performance cushioning breathable')),
('SOFA-001', 'ComfortPlus Sectional Sofa', 'comfortplus-sectional-sofa', 'Spacious L-shaped sectional sofa with premium upholstery, memory foam cushions, and sturdy hardwood frame.', 'L-shaped sectional with memory foam', 16, 3, 1499.99, 750.00, 1899.99, 'USD', 95.0, '{"length": 290, "width": 180, "height": 85, "unit": "cm"}', true, true, false, 8.25, ARRAY['sofa', 'sectional', 'furniture', 'comfort'], '{"material": "Premium fabric upholstery", "frame": "Hardwood", "cushions": "Memory foam", "seating": "5-6 persons"}', '[{"url": "https://cdn.example.com/products/sofa-001-1.jpg", "alt": "Sofa full view"}]', to_tsvector('english', 'ComfortPlus Sectional Sofa L-shaped memory foam premium furniture')),
('KNIFE-001', 'ChefMaster Knife Set', 'chefmaster-knife-set', 'Professional 15-piece knife set with high-carbon stainless steel blades and ergonomic handles. Includes knife block.', 'Professional 15-piece knife set', 17, 3, 199.99, 85.00, 249.99, 'USD', 3.2, '{"length": 40, "width": 25, "height": 35, "unit": "cm"}', true, false, false, 8.25, ARRAY['kitchen', 'knives', 'chef', 'professional'], '{"pieces": 15, "material": "High-carbon stainless steel", "includes": "Chef, Santoku, Bread, Paring, Steak knives + block"}', '[{"url": "https://cdn.example.com/products/knife-001-1.jpg", "alt": "Knife set in block"}]', to_tsvector('english', 'ChefMaster Knife Set professional 15-piece stainless steel kitchen')),
('BIKE-001', 'MountainTrail Pro Bike', 'mountaintrail-pro-bike', 'Professional-grade mountain bike with carbon fiber frame, 29" wheels, hydraulic disc brakes, and 12-speed drivetrain.', 'Carbon fiber mountain bike', 4, 4, 2299.99, 1400.00, 2699.99, 'USD', 12.5, '{"length": 180, "width": 65, "height": 110, "unit": "cm"}', true, true, false, 8.25, ARRAY['bike', 'mountain', 'carbon', 'professional'], '{"frame": "Carbon fiber", "wheels": "29 inch", "brakes": "Hydraulic disc", "gears": "12-speed"}', '[{"url": "https://cdn.example.com/products/bike-001-1.jpg", "alt": "Bike side view"}]', to_tsvector('english', 'MountainTrail Pro Bike mountain carbon fiber professional hydraulic')),
('BOOK-001', 'The Art of Programming', 'the-art-of-programming', 'Comprehensive guide to software development best practices, covering algorithms, design patterns, and clean code principles.', 'Programming best practices guide', 5, 5, 49.99, 15.00, 59.99, 'USD', 0.95, '{"length": 24, "width": 17, "height": 4, "unit": "cm"}', true, false, false, 0.00, ARRAY['book', 'programming', 'technology', 'education'], '{"author": "Dr. Jane Developer", "pages": 650, "isbn": "978-1234567890", "format": "Hardcover"}', '[{"url": "https://cdn.example.com/products/book-001-1.jpg", "alt": "Book cover"}]', to_tsvector('english', 'The Art of Programming software development algorithms design patterns clean code')),
('DIGITAL-001', 'Premium Music Subscription', 'premium-music-subscription', 'Annual subscription to unlimited ad-free music streaming with offline downloads and Hi-Fi audio quality.', 'Annual music streaming subscription', 5, 5, 99.99, 0.00, 119.99, 'USD', NULL, NULL, true, false, true, 0.00, ARRAY['digital', 'music', 'subscription', 'streaming'], '{"duration": "12 months", "features": "Ad-free, Offline, Hi-Fi"}', '[]', to_tsvector('english', 'Premium Music Subscription streaming ad-free offline Hi-Fi annual')),
('INACTIVE-001', 'Discontinued Product', 'discontinued-product', 'This product has been discontinued and is no longer available.', 'Discontinued item', 1, 8, 9.99, 5.00, NULL, 'USD', 0.1, NULL, false, false, false, 0.00, ARRAY['discontinued'], '{}', '[]', to_tsvector('english', 'Discontinued Product'));

INSERT INTO inventory (product_id, warehouse_code, quantity, reserved_quantity, reorder_level, reorder_quantity, last_restocked_at) VALUES
(1, 'MAIN', 150, 12, 20, 100, NOW() - INTERVAL '5 days'),
(1, 'WEST', 75, 5, 15, 50, NOW() - INTERVAL '3 days'),
(2, 'MAIN', 500, 25, 50, 200, NOW() - INTERVAL '7 days'),
(3, 'MAIN', 45, 3, 10, 30, NOW() - INTERVAL '10 days'),
(4, 'MAIN', 200, 8, 30, 100, NOW() - INTERVAL '4 days'),
(5, 'MAIN', 120, 15, 20, 80, NOW() - INTERVAL '6 days'),
(5, 'EAST', 60, 2, 10, 40, NOW() - INTERVAL '8 days'),
(6, 'MAIN', 350, 45, 50, 150, NOW() - INTERVAL '2 days'),
(7, 'MAIN', 25, 2, 5, 15, NOW() - INTERVAL '14 days'),
(8, 'MAIN', 80, 10, 15, 50, NOW() - INTERVAL '9 days'),
(9, 'MAIN', 300, 20, 40, 120, NOW() - INTERVAL '5 days'),
(10, 'MAIN', 45, 5, 10, 30, NOW() - INTERVAL '11 days'),
(11, 'MAIN', 180, 12, 25, 80, NOW() - INTERVAL '3 days'),
(12, 'MAIN', 15, 1, 3, 10, NOW() - INTERVAL '20 days'),
(13, 'MAIN', 250, 18, 35, 100, NOW() - INTERVAL '6 days'),
(14, 'MAIN', 8, 0, 3, 5, NOW() - INTERVAL '30 days'),
(15, 'MAIN', 400, 30, 50, 150, NOW() - INTERVAL '4 days'),
(16, 'MAIN', 1000, 0, 100, 500, NOW() - INTERVAL '1 day'),
(17, 'MAIN', 0, 0, 10, 50, NOW() - INTERVAL '60 days');

DO $$
DECLARE
    i INTEGER;
    customer_id INTEGER;
    order_date TIMESTAMP WITH TIME ZONE;
    new_order_id INTEGER;
    product_id INTEGER;
    qty INTEGER;
    unit_price NUMERIC;
    statuses order_status[] := ARRAY['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
    payment_methods payment_method[] := ARRAY['credit_card', 'debit_card', 'paypal', 'bank_transfer'];
BEGIN
    FOR i IN 1..500 LOOP
        customer_id := (i % 20) + 1;
        order_date := NOW() - (INTERVAL '1 day' * (random() * 365 + 1)::int);
        
        INSERT INTO orders (order_number, customer_id, status, payment_method, payment_status, 
                          shipping_address_id, billing_address_id, subtotal, tax_amount, 
                          shipping_amount, discount_amount, total_amount, notes, ip_address, created_at)
        VALUES (
            'ORD-' || LPAD(i::text, 6, '0'),
            customer_id,
            statuses[(random() * 6 + 1)::int],
            payment_methods[(random() * 3 + 1)::int],
            CASE WHEN random() > 0.2 THEN 'paid' ELSE 'pending' END,
            customer_id,
            customer_id,
            0, 0, (random() * 15 + 5)::numeric(12,2), 
            CASE WHEN random() > 0.7 THEN (random() * 50)::numeric(12,2) ELSE 0 END,
            0,
            CASE WHEN random() > 0.8 THEN 'Please leave at door' ELSE NULL END,
            ('192.168.' || (random()*255)::int || '.' || (random()*255)::int)::inet,
            order_date
        ) RETURNING id INTO new_order_id;
        
        FOR j IN 1..(random() * 4 + 1)::int LOOP
            product_id := (random() * 15 + 1)::int;
            qty := (random() * 3 + 1)::int;
            
            SELECT price INTO unit_price FROM products WHERE id = product_id;
            IF unit_price IS NULL THEN unit_price := 29.99; END IF;
            
            INSERT INTO order_items (order_id, order_created_at, product_id, product_name, product_sku,
                                    quantity, unit_price, discount_percent, tax_rate, total_price)
            SELECT 
                new_order_id,
                order_date,
                product_id,
                p.name,
                p.sku,
                qty,
                unit_price,
                CASE WHEN random() > 0.8 THEN (random() * 20)::numeric(5,2) ELSE 0 END,
                COALESCE(p.tax_rate, 0),
                (qty * unit_price)::numeric(12,2)
            FROM products p WHERE p.id = product_id;
        END LOOP;
        
        UPDATE orders o SET 
            subtotal = (SELECT COALESCE(SUM(total_price), 0) FROM order_items oi WHERE oi.order_id = o.id),
            tax_amount = (SELECT COALESCE(SUM(total_price * tax_rate / 100), 0) FROM order_items oi WHERE oi.order_id = o.id),
            total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM order_items oi WHERE oi.order_id = o.id) + o.shipping_amount - o.discount_amount
        WHERE o.id = new_order_id;
    END LOOP;
END $$;

INSERT INTO reviews (product_id, customer_id, rating, title, content, pros, cons, is_verified_purchase, is_approved, helpful_count) VALUES
(1, 1, 5, 'Best phone ever!', 'Amazing camera quality and battery life. The AI features are incredibly useful.', ARRAY['Great camera', 'Long battery', 'Fast performance'], ARRAY['Expensive'], true, true, 45),
(1, 4, 4, 'Great but pricey', 'Excellent phone with minor drawbacks. Screen is gorgeous.', ARRAY['Beautiful display', 'Smooth UI'], ARRAY['Price', 'Heavy'], true, true, 23),
(1, 7, 5, 'Worth every penny', 'Upgraded from previous model and the difference is noticeable.', ARRAY['Camera upgrade', '5G speed'], NULL, true, true, 18),
(2, 2, 4, 'Good value for money', 'Does everything I need without breaking the bank.', ARRAY['Affordable', 'Reliable'], ARRAY['Basic camera'], true, true, 12),
(2, 5, 3, 'Decent budget option', 'Works fine for basic tasks but struggles with heavy apps.', ARRAY['Price point', 'Build quality'], ARRAY['Slow at times', 'Average display'], true, true, 8),
(3, 1, 5, 'Perfect for work', 'The best laptop I''ve ever owned. 4K screen is stunning.', ARRAY['4K display', 'Performance', 'Build quality'], ARRAY['Heavy'], true, true, 67),
(3, 11, 5, 'Developer''s dream', 'Handles everything I throw at it. Compiles are lightning fast.', ARRAY['Fast SSD', 'Great keyboard'], ARRAY['Fan noise under load'], true, true, 34),
(5, 3, 5, 'Silence is golden', 'The noise cancellation is incredible. Best ANC I''ve tested.', ARRAY['ANC quality', 'Comfort', 'Battery life'], NULL, true, true, 89),
(5, 9, 4, 'Almost perfect', 'Great headphones but the app could be better.', ARRAY['Sound quality', 'Build'], ARRAY['App issues'], true, true, 15),
(8, 4, 5, 'Gaming perfection', 'Load times are insane. Graphics are next level.', ARRAY['Fast loading', 'Great games', 'Quiet'], ARRAY['Game prices'], true, true, 156),
(8, 12, 4, 'Solid console', 'Great upgrade from last gen. Controller feels premium.', ARRAY['Controller', 'Performance'], ARRAY['Size'], true, true, 42),
(11, 6, 5, 'Changed my running', 'Best running shoes I''ve owned. Cushioning is perfect.', ARRAY['Comfort', 'Support'], NULL, true, true, 28),
(12, 1, 5, 'Couch potato approved', 'Most comfortable sofa ever. Memory foam is amazing.', ARRAY['Comfort', 'Size', 'Quality'], ARRAY['Delivery time'], true, true, 95),
(14, 8, 5, 'Trail beast', 'Handles any terrain with ease. Worth the investment.', ARRAY['Performance', 'Build quality'], ARRAY['Price'], true, true, 37),
(15, 2, 5, 'Must-read for developers', 'Changed how I think about code. Highly recommend.', ARRAY['Clear explanations', 'Practical examples'], NULL, true, true, 112),
(1, 15, 2, 'Disappointed', 'Battery drains faster than advertised. Expected better.', ARRAY['Camera is good'], ARRAY['Battery', 'Heating'], true, false, 5),
(3, 18, 1, 'DOA', 'Arrived broken. Returning for refund.', NULL, ARRAY['Defective unit'], true, false, 2);

-- ============================================================================
-- EDGE CASES DOMAIN DATA
-- ============================================================================

INSERT INTO all_data_types (
    col_smallint, col_integer, col_bigint, col_decimal, col_numeric, col_real, col_double, col_money,
    col_char, col_varchar, col_text, col_bytea, col_date, col_time, col_time_tz, col_timestamp, 
    col_timestamp_tz, col_interval, col_boolean, col_uuid, col_inet, col_cidr, col_macaddr, col_macaddr8,
    col_point, col_line, col_lseg, col_box, col_path, col_polygon, col_circle, col_json, col_jsonb,
    col_int_array, col_text_array, col_int4range, col_int8range, col_numrange, col_tsrange, col_tstzrange,
    col_daterange, col_xml, col_hstore, col_tsvector, col_tsquery, col_bit, col_varbit, col_order_status
) VALUES
(32767, 2147483647, 9223372036854775807, 1234567890.1234567890, 9999999999.9999999999, 3.14159, 3.141592653589793, 99999.99,
 'CHAR10    ', 'Variable length string', 'This is a long text field that can contain multiple paragraphs and extensive content.',
 E'\\xDEADBEEF', '2024-06-15', '14:30:45', '14:30:45+05:30', '2024-06-15 14:30:45', 
 '2024-06-15 14:30:45+00', '1 year 2 months 3 days 4 hours', true, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
 '192.168.1.1', '192.168.1.0/24', '08:00:2b:01:02:03', '08:00:2b:01:02:03:04:05',
 '(1.5, 2.5)', '{1, 2, 3}', '[(0,0),(1,1)]', '((0,0),(1,1))', '[(0,0),(1,1),(2,0)]', '((0,0),(1,0),(1,1),(0,1))', '<(0,0),5>',
 '{"key": "value", "nested": {"a": 1}}', '{"key": "value", "array": [1, 2, 3]}',
 ARRAY[1, 2, 3, 4, 5], ARRAY['one', 'two', 'three'],
 '[1,10]', '[1,100]', '[1.5,10.5]', '[2024-01-01 00:00, 2024-12-31 23:59]', 
 '[2024-01-01 00:00+00, 2024-12-31 23:59+00]', '[2024-01-01, 2024-12-31]',
 '<root><item>XML content</item></root>', '"key1"=>"value1", "key2"=>"value2"',
 'quick brown fox', 'quick & brown', B'10101010', B'1111000011110000', 'delivered'),
(-32768, -2147483648, -9223372036854775808, -1234567890.1234567890, -9999999999.9999999999, -3.14159, -3.141592653589793, -99999.99,
 'MIN       ', 'Minimum values test', 'Testing negative and minimum values across all numeric types.',
 E'\\x00', '1970-01-01', '00:00:00', '00:00:00+00', '1970-01-01 00:00:00',
 '1970-01-01 00:00:00+00', '-1 years', false, '00000000-0000-0000-0000-000000000000',
 '0.0.0.0', '0.0.0.0/0', '00:00:00:00:00:00', '00:00:00:00:00:00:00:00',
 '(-999,-999)', '{-1,-1,-1}', '[(-10,-10),(10,10)]', '((-100,-100),(100,100))', NULL, NULL, '<(-50,-50),100>',
 '{}', '{}', ARRAY[]::integer[], ARRAY[]::text[],
 'empty', 'empty', 'empty', 'empty', 'empty', 'empty', NULL, NULL, NULL, NULL, B'00000000', B'0', 'pending');

INSERT INTO null_patterns (description, all_null_row, nullable_int, nullable_text, nullable_bool, nullable_date, nullable_json, nullable_array) VALUES
('All nulls except id and description', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('Only text set', NULL, NULL, 'Some text here', NULL, NULL, NULL, NULL),
('Only int set', NULL, 42, NULL, NULL, NULL, NULL, NULL),
('Only bool set (true)', NULL, NULL, NULL, true, NULL, NULL, NULL),
('Only bool set (false)', NULL, NULL, NULL, false, NULL, NULL, NULL),
('Only date set', NULL, NULL, NULL, NULL, '2024-06-15', NULL, NULL),
('Only json set', NULL, NULL, NULL, NULL, NULL, '{"key": "value"}', NULL),
('Only array set (empty)', NULL, NULL, NULL, NULL, NULL, NULL, ARRAY[]::text[]),
('Only array set (with values)', NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['a', 'b', 'c']),
('All values set', 'not null', 100, 'Full row', true, '2024-01-01', '{"complete": true}', ARRAY['x', 'y', 'z']),
('Mix of nulls 1', NULL, 50, NULL, true, NULL, '{}', NULL),
('Mix of nulls 2', 'partial', NULL, 'text only', NULL, '2023-12-25', NULL, ARRAY['single']),
('Empty string vs null', '', 0, '', NULL, NULL, 'null', ARRAY[]::text[]);

INSERT INTO unicode_samples (description, sample_text, category, char_count, byte_count) VALUES
('Basic ASCII', 'Hello, World!', 'ASCII', 13, 13),
('Extended Latin', 'Héllo, Wörld! Çafé résumé naïve', 'Latin Extended', 30, 36),
('Emojis', '🚀🎉✨💾🔧🎨🌈⚡🔥💡', 'Emoji', 10, 40),
('Mixed Emojis and Text', 'Hello 👋 World 🌍! How are you? 🤔', 'Mixed', 33, 45),
('Chinese (Simplified)', '你好世界！这是中文测试。', 'CJK', 12, 36),
('Chinese (Traditional)', '你好世界！這是繁體中文測試。', 'CJK', 14, 42),
('Japanese Hiragana', 'こんにちは世界！', 'Japanese', 8, 24),
('Japanese Katakana', 'コンニチハセカイ！', 'Japanese', 9, 27),
('Japanese Kanji', '日本語のテスト文字列', 'Japanese', 10, 30),
('Korean', '안녕하세요 세계!', 'Korean', 9, 25),
('Arabic', 'مرحبا بالعالم!', 'RTL', 14, 27),
('Hebrew', 'שלום עולם!', 'RTL', 10, 19),
('Russian', 'Привет мир!', 'Cyrillic', 11, 21),
('Greek', 'Γειά σου κόσμε!', 'Greek', 15, 28),
('Thai', 'สวัสดีโลก!', 'Thai', 10, 28),
('Mixed Scripts', 'Hello こんにちは 你好 مرحبا Привет 👋', 'Mixed', 30, 58),
('Special Symbols', '© ® ™ § ¶ † ‡ • ° ± × ÷ ≠ ≤ ≥', 'Symbols', 31, 47),
('Math Symbols', '∑ ∏ ∫ ∂ ∇ √ ∞ ∈ ∉ ⊂ ⊃ ∩ ∪', 'Math', 27, 39),
('Currency Symbols', '$ € £ ¥ ₹ ₽ ₿ ¢ ₩ ₪', 'Currency', 19, 28),
('Zalgo Text', 'H̷̢̧̛̳̣̻̤̫̜̞̜̗̣̲̙̹̏̇̉́̄̆͊̎̕͝ë̷̢̨̩̗̫̲́l̷̨̧̛̫̱̟̣̱̝͖̣̰̦̮̀̀̓͊̀̃̕͝l̷̨̰̦̹̳̠̝̳̤̞͖̞̈́̊̈́̿͆̾͜͝ͅo̴̧̨̞̣͓̥̗̗̪̹̼̥͈̊̈́͌̊̔̒̃̂̓̅͘͝', 'Combining', 5, 200),
('Control Characters', E'Line1\nLine2\tTabbed\rCarriage', 'Control', 27, 27),
('Zero-Width Characters', 'Invi​sible​Join​ers', 'Special', 19, 28),
('SQL Injection Attempt', '''; DROP TABLE users; --', 'Security', 25, 25),
('HTML/XSS Attempt', '<script>alert("XSS")</script>', 'Security', 31, 31),
('Very Long String', REPEAT('A', 10000), 'Long', 10000, 10000),
('Empty String', '', 'Edge', 0, 0);

INSERT INTO numeric_extremes (description, small_val, int_val, big_val, decimal_val, real_val, double_val, money_val) VALUES
('Maximum positive values', 32767, 2147483647, 9223372036854775807, 99999999999999999999.9999999999, 3.4028235e+38, 1.7976931348623157e+308, 92233720368547758.07),
('Minimum negative values', -32768, -2147483648, -9223372036854775808, -99999999999999999999.9999999999, -3.4028235e+38, -1.7976931348623157e+308, -92233720368547758.08),
('Zero values', 0, 0, 0, 0.0000000000, 0, 0, 0.00),
('Small positive values', 1, 1, 1, 0.0000000001, 1.4e-45, 4.9e-324, 0.01),
('Small negative values', -1, -1, -1, -0.0000000001, -1.4e-45, -4.9e-324, -0.01),
('Pi approximations', NULL, 3, 3, 3.1415926536, 3.1415927, 3.141592653589793, 3.14),
('Common currency values', NULL, 100, 10000, 99.99, 99.99, 99.99, 99.99),
('Precision test', NULL, 123456789, 123456789012345, 12345.6789012345, 123.456, 12345.678901234567, 12345.67);

INSERT INTO json_documents (description, doc_json, doc_jsonb) VALUES
('Empty object', '{}', '{}'),
('Empty array', '[]', '[]'),
('Simple object', '{"name": "John", "age": 30}', '{"name": "John", "age": 30}'),
('Nested object', '{"user": {"name": "Jane", "address": {"city": "NYC", "zip": "10001"}}}', '{"user": {"name": "Jane", "address": {"city": "NYC", "zip": "10001"}}}'),
('Array of primitives', '[1, 2, 3, "four", true, null]', '[1, 2, 3, "four", true, null]'),
('Array of objects', '[{"id": 1, "name": "A"}, {"id": 2, "name": "B"}]', '[{"id": 1, "name": "A"}, {"id": 2, "name": "B"}]'),
('Complex nested', '{"data": {"items": [{"id": 1, "tags": ["a", "b"]}, {"id": 2, "meta": {"x": 1}}]}}', '{"data": {"items": [{"id": 1, "tags": ["a", "b"]}, {"id": 2, "meta": {"x": 1}}]}}'),
('All JSON types', '{"string": "hello", "number": 42, "float": 3.14, "bool_t": true, "bool_f": false, "null_v": null, "array": [1, 2], "object": {"nested": true}}', '{"string": "hello", "number": 42, "float": 3.14, "bool_t": true, "bool_f": false, "null_v": null, "array": [1, 2], "object": {"nested": true}}'),
('Unicode in JSON', '{"greeting": "Hello 你好 مرحبا 🌍"}', '{"greeting": "Hello 你好 مرحبا 🌍"}'),
('Large array', (SELECT json_agg(x) FROM generate_series(1, 1000) x), (SELECT jsonb_agg(x) FROM generate_series(1, 1000) x)),
('Deeply nested (10 levels)', '{"l1":{"l2":{"l3":{"l4":{"l5":{"l6":{"l7":{"l8":{"l9":{"l10":"deep"}}}}}}}}}}', '{"l1":{"l2":{"l3":{"l4":{"l5":{"l6":{"l7":{"l8":{"l9":{"l10":"deep"}}}}}}}}}}'),
('Special characters in keys', '{"key with spaces": 1, "key-with-dash": 2, "key.with.dots": 3}', '{"key with spaces": 1, "key-with-dash": 2, "key.with.dots": 3}');

INSERT INTO temporal_data (description, date_val, time_val, time_tz_val, ts_val, ts_tz_val, interval_val) VALUES
('Current moment', CURRENT_DATE, CURRENT_TIME, CURRENT_TIME, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, INTERVAL '0'),
('Unix epoch', '1970-01-01', '00:00:00', '00:00:00+00', '1970-01-01 00:00:00', '1970-01-01 00:00:00+00', NULL),
('Y2K', '2000-01-01', '00:00:00', '00:00:00+00', '2000-01-01 00:00:00', '2000-01-01 00:00:00+00', NULL),
('Leap day 2024', '2024-02-29', '12:00:00', '12:00:00+00', '2024-02-29 12:00:00', '2024-02-29 12:00:00+00', NULL),
('End of day', '2024-12-31', '23:59:59.999999', '23:59:59.999999+00', '2024-12-31 23:59:59.999999', '2024-12-31 23:59:59.999999+00', NULL),
('Different timezones', '2024-06-15', '12:00:00', '12:00:00+05:30', '2024-06-15 12:00:00', '2024-06-15 12:00:00+09:00', NULL),
('1 year interval', NULL, NULL, NULL, NULL, NULL, INTERVAL '1 year'),
('Complex interval', NULL, NULL, NULL, NULL, NULL, INTERVAL '1 year 2 months 3 days 4 hours 5 minutes 6 seconds'),
('Negative interval', NULL, NULL, NULL, NULL, NULL, INTERVAL '-30 days'),
('Far future', '2099-12-31', '23:59:59', '23:59:59+00', '2099-12-31 23:59:59', '2099-12-31 23:59:59+00', NULL),
('Historical date', '1776-07-04', '12:00:00', '12:00:00-05', '1776-07-04 12:00:00', '1776-07-04 12:00:00-05', NULL);

INSERT INTO geometric_data (description, point_val, line_val, lseg_val, box_val, path_val, polygon_val, circle_val) VALUES
('Origin', '(0,0)', '{0,1,0}', '[(0,0),(1,1)]', '((0,0),(1,1))', '[(0,0),(1,1),(2,0)]', '((0,0),(1,0),(0.5,1))', '<(0,0),1>'),
('Negative coordinates', '(-10,-10)', '{1,1,20}', '[(-5,-5),(-1,-1)]', '((-10,-10),(-1,-1))', '[(-5,0),(0,5),(5,0)]', '((-2,-2),(2,-2),(2,2),(-2,2))', '<(-5,-5),3>'),
('Large coordinates', '(1000000,1000000)', '{1,0,-1000000}', '[(0,0),(1000000,1000000)]', '((0,0),(1000,1000))', NULL, NULL, '<(500,500),100>'),
('Decimal precision', '(3.14159,2.71828)', '{1.5,2.5,3.5}', '[(1.1,2.2),(3.3,4.4)]', '((0.5,0.5),(1.5,1.5))', '[(0.1,0.1),(0.2,0.2),(0.3,0.3)]', '((0.0,0.0),(1.0,0.0),(0.5,0.866))', '<(1.5,2.5),0.5>'),
('Unit square', '(0.5,0.5)', '{1,0,0}', '[(0,0),(1,0)]', '((0,0),(1,1))', '[(0,0),(1,0),(1,1),(0,1),(0,0)]', '((0,0),(1,0),(1,1),(0,1))', NULL);

INSERT INTO network_data (description, inet_val, cidr_val, macaddr_val) VALUES
('Localhost IPv4', '127.0.0.1', '127.0.0.0/8', '00:00:00:00:00:00'),
('Private network A', '10.0.0.1', '10.0.0.0/8', '02:00:00:00:00:01'),
('Private network B', '172.16.0.1', '172.16.0.0/12', 'aa:bb:cc:dd:ee:ff'),
('Private network C', '192.168.1.1', '192.168.0.0/16', '08:00:2b:01:02:03'),
('Public IP example', '8.8.8.8', '8.8.8.0/24', 'dc:a6:32:00:00:01'),
('IPv6 localhost', '::1', '::1/128', NULL),
('IPv6 example', '2001:db8::1', '2001:db8::/32', NULL),
('Broadcast', '255.255.255.255', '0.0.0.0/0', 'ff:ff:ff:ff:ff:ff'),
('Subnet /30', '192.168.100.1', '192.168.100.0/30', '00:11:22:33:44:55'),
('Single host /32', '203.0.113.50', '203.0.113.50/32', 'a1:b2:c3:d4:e5:f6');

-- ============================================================================
-- SCALE TEST DOMAIN DATA
-- ============================================================================

INSERT INTO single_row_table (name, description) VALUES ('Configuration', 'This table intentionally contains only one row for edge case testing.');

DO $$
DECLARE
    categories TEXT[] := ARRAY['A', 'B', 'C', 'D', 'E'];
BEGIN
    INSERT INTO large_table (random_int, random_text, random_date, random_bool, category, amount)
    SELECT 
        (random() * 1000000)::int,
        'Text_' || gs || '_' || md5(gs::text),
        CURRENT_DATE - (random() * 1000)::int,
        random() > 0.5,
        categories[(gs % 5) + 1],
        (random() * 10000)::numeric(12,2)
    FROM generate_series(1, 100000) gs;
END $$;

INSERT INTO wide_table (
    col_001, col_002, col_003, col_004, col_005, col_006, col_007, col_008, col_009, col_010,
    col_011, col_012, col_013, col_014, col_015, col_016, col_017, col_018, col_019, col_020,
    col_021, col_022, col_023, col_024, col_025, col_026, col_027, col_028, col_029, col_030,
    col_031, col_032, col_033, col_034, col_035, col_036, col_037, col_038, col_039, col_040,
    col_041, col_042, col_043, col_044, col_045, col_046, col_047, col_048, col_049, col_050
)
SELECT 
    'A' || gs, 'B' || gs, 'C' || gs, 'D' || gs, 'E' || gs, 'F' || gs, 'G' || gs, 'H' || gs, 'I' || gs, 'J' || gs,
    gs, gs*2, gs*3, gs*4, gs*5, gs*6, gs*7, gs*8, gs*9, gs*10,
    gs::numeric/100, gs::numeric/200, gs::numeric/300, gs::numeric/400, gs::numeric/500,
    gs%2=0, gs%3=0, gs%4=0, gs%5=0, gs%6=0,
    CURRENT_DATE - gs, CURRENT_DATE - gs*2, CURRENT_DATE - gs*3, CURRENT_DATE - gs*4, CURRENT_DATE - gs*5,
    NOW() - (gs || ' hours')::interval, NOW() - (gs*2 || ' hours')::interval, NOW() - (gs*3 || ' hours')::interval, NOW() - (gs*4 || ' hours')::interval, NOW() - (gs*5 || ' hours')::interval,
    'Text block ' || gs, 'Description ' || gs, 'Notes ' || gs, 'Comment ' || gs, 'Detail ' || gs,
    ('{"index": ' || gs || '}')::jsonb, ('{"value": ' || gs*10 || '}')::jsonb, ('{"count": ' || gs*100 || '}')::jsonb, ('{"id": "row_' || gs || '"}')::jsonb, ('{"meta": {"row": ' || gs || '}}')::jsonb
FROM generate_series(1, 100) gs;

-- ============================================================================
-- REFRESH MATERIALIZED VIEWS
-- ============================================================================

REFRESH MATERIALIZED VIEW mv_product_sales_summary;
REFRESH MATERIALIZED VIEW mv_customer_lifetime_value;
REFRESH MATERIALIZED VIEW mv_daily_revenue;

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
DECLARE
    counts TEXT;
BEGIN
    RAISE NOTICE 'Seed completed successfully!';
    RAISE NOTICE 'Customers: %', (SELECT COUNT(*) FROM customers);
    RAISE NOTICE 'Products: %', (SELECT COUNT(*) FROM products);
    RAISE NOTICE 'Orders: %', (SELECT COUNT(*) FROM orders);
    RAISE NOTICE 'Order Items: %', (SELECT COUNT(*) FROM order_items);
    RAISE NOTICE 'Reviews: %', (SELECT COUNT(*) FROM reviews);
    RAISE NOTICE 'Large Table: %', (SELECT COUNT(*) FROM large_table);
    RAISE NOTICE 'All Data Types: %', (SELECT COUNT(*) FROM all_data_types);
    RAISE NOTICE 'Unicode Samples: %', (SELECT COUNT(*) FROM unicode_samples);
END $$;
