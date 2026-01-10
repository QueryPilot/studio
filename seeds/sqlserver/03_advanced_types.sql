-- Create database for advanced type testing
USE todoapp;
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Cleanup existing objects
IF OBJECT_ID('dbo.spatial_test', 'U') IS NOT NULL DROP TABLE dbo.spatial_test;
IF OBJECT_ID('dbo.computed_columns_test', 'U') IS NOT NULL DROP TABLE dbo.computed_columns_test;
IF OBJECT_ID('dbo.sales_analysis', 'V') IS NOT NULL DROP VIEW dbo.sales_analysis;
IF OBJECT_ID('dbo.sales_data', 'U') IS NOT NULL DROP TABLE dbo.sales_data;
IF OBJECT_ID('dbo.status_test', 'U') IS NOT NULL DROP TABLE dbo.status_test;
IF OBJECT_ID('dbo.numeric_types_test', 'U') IS NOT NULL DROP TABLE dbo.numeric_types_test;
GO

-- Create table with spatial and advanced MSSQL types
CREATE TABLE spatial_test (
    id INT PRIMARY KEY IDENTITY(1,1),
    name NVARCHAR(100),
    location GEOGRAPHY,
    shape GEOMETRY,
    path HIERARCHYID,
    xml_data XML,
    variant_data SQL_VARIANT,
    guid_data UNIQUEIDENTIFIER DEFAULT NEWID(),
    money_data MONEY,
    small_money SMALLMONEY,
    datetime2_data DATETIME2(7),
    datetimeoffset_data DATETIMEOFFSET,
    binary_data VARBINARY(MAX),
    created_at DATETIME DEFAULT GETDATE()
);
GO

-- Insert test data with spatial types
INSERT INTO spatial_test (
    name, 
    location, 
    shape, 
    path, 
    xml_data, 
    variant_data,
    money_data,
    small_money,
    datetime2_data,
    datetimeoffset_data,
    binary_data
) VALUES 
(
    'Point in Seattle',
    geography::Point(47.6062, -122.3321, 4326),
    geometry::STGeomFromText('POINT(0 0)', 0),
    '/1/',
    '<root><item id="1">Test Item</item></root>',
    CAST('Test Variant String' AS SQL_VARIANT),
    12345.67,
    123.45,
    SYSDATETIME(),
    SYSDATETIMEOFFSET(),
    CAST('Binary Data' AS VARBINARY(MAX))
),
(
    'Polygon Area',
    geography::STGeomFromText('POLYGON((-122.358 47.653, -122.348 47.649, -122.348 47.658, -122.358 47.658, -122.358 47.653))', 4326),
    geometry::STGeomFromText('POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))', 0),
    '/1/2/',
    '<root><item id="2">Another Item</item><nested><value>123</value></nested></root>',
    CAST(42 AS SQL_VARIANT),
    98765.43,
    999.99,
    DATEADD(DAY, -1, SYSDATETIME()),
    DATEADD(HOUR, -5, SYSDATETIMEOFFSET()),
    CAST('More Binary' AS VARBINARY(MAX))
),
(
    'Line String',
    geography::STGeomFromText('LINESTRING(-122.360 47.656, -122.343 47.656)', 4326),
    geometry::STGeomFromText('LINESTRING(0 0, 10 10, 20 25, 50 60)', 0),
    '/1/2/3/',
    '<root xmlns="http://example.com"><data type="complex"><value>Test</value></data></root>',
    CAST(3.14159 AS SQL_VARIANT),
    -5000.00,
    -50.50,
    '2024-01-15 14:30:00',
    '2024-01-15 14:30:00 -08:00',
    0x0102030405060708090A0B0C0D0E0F
);
GO

-- Create table with computed columns and identity
CREATE TABLE computed_columns_test (
    id INT IDENTITY(1,1) PRIMARY KEY,
    first_name NVARCHAR(50),
    last_name NVARCHAR(50),
    full_name AS (first_name + ' ' + last_name) PERSISTED,
    birth_date DATE,
    age AS (DATEDIFF(YEAR, birth_date, GETDATE())),
    salary DECIMAL(10,2),
    tax_rate DECIMAL(5,2) DEFAULT 0.20,
    tax_amount AS (salary * tax_rate),
    net_salary AS (salary - (salary * tax_rate))
);
GO

-- Insert test data for computed columns
INSERT INTO computed_columns_test (first_name, last_name, birth_date, salary)
VALUES 
    ('John', 'Doe', '1990-05-15', 75000.00),
    ('Jane', 'Smith', '1985-08-22', 85000.00),
    ('Bob', 'Johnson', '1995-12-01', 65000.00);
GO

-- Create table for testing window functions and CTEs
CREATE TABLE sales_data (
    id INT IDENTITY(1,1) PRIMARY KEY,
    product_name NVARCHAR(100),
    category NVARCHAR(50),
    sale_date DATE,
    quantity INT,
    unit_price DECIMAL(10,2),
    total_amount AS (quantity * unit_price) PERSISTED,
    region NVARCHAR(50)
);
GO

-- Insert sample sales data
INSERT INTO sales_data (product_name, category, sale_date, quantity, unit_price, region)
VALUES 
    ('Laptop Pro', 'Electronics', '2024-01-01', 5, 1299.99, 'North'),
    ('Laptop Pro', 'Electronics', '2024-01-02', 3, 1299.99, 'South'),
    ('Mouse Wireless', 'Electronics', '2024-01-01', 20, 29.99, 'North'),
    ('Keyboard Mechanical', 'Electronics', '2024-01-01', 10, 99.99, 'East'),
    ('Monitor 4K', 'Electronics', '2024-01-02', 7, 499.99, 'West'),
    ('Desk Chair', 'Furniture', '2024-01-01', 15, 249.99, 'North'),
    ('Standing Desk', 'Furniture', '2024-01-02', 8, 599.99, 'South'),
    ('Desk Lamp', 'Furniture', '2024-01-01', 25, 39.99, 'East');
GO

-- Create a view using window functions
CREATE VIEW sales_analysis AS
SELECT 
    product_name,
    category,
    sale_date,
    quantity,
    unit_price,
    total_amount,
    region,
    ROW_NUMBER() OVER (PARTITION BY category ORDER BY total_amount DESC) as rank_in_category,
    SUM(total_amount) OVER (PARTITION BY category) as category_total,
    AVG(total_amount) OVER (PARTITION BY category) as category_average,
    LAG(total_amount, 1) OVER (ORDER BY sale_date, id) as previous_sale,
    LEAD(total_amount, 1) OVER (ORDER BY sale_date, id) as next_sale
FROM sales_data;
GO

-- Create table with ENUM-like CHECK constraints (MSSQL doesn't have ENUM)
CREATE TABLE status_test (
    id INT IDENTITY(1,1) PRIMARY KEY,
    task_name NVARCHAR(100),
    status NVARCHAR(20) CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority NVARCHAR(10) CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    assigned_to NVARCHAR(100),
    created_at DATETIME2 DEFAULT SYSDATETIME()
);
GO

INSERT INTO status_test (task_name, status, priority, assigned_to)
VALUES 
    ('Implement feature X', 'in_progress', 'high', 'developer1'),
    ('Fix bug Y', 'pending', 'critical', 'developer2'),
    ('Update documentation', 'completed', 'low', 'developer3');
GO

-- Create table with various numeric types
CREATE TABLE numeric_types_test (
    id INT IDENTITY(1,1) PRIMARY KEY,
    tiny_int TINYINT,
    small_int SMALLINT,
    medium_int INT,
    big_int BIGINT,
    decimal_type DECIMAL(18,4),
    numeric_type NUMERIC(15,3),
    float_type FLOAT,
    real_type REAL,
    money_type MONEY,
    small_money_type SMALLMONEY,
    bit_type BIT
);
GO

INSERT INTO numeric_types_test 
VALUES 
    (255, 32767, 2147483647, 9223372036854775807, 12345.6789, 98765.432, 3.14159265359, 2.71828, 12345.67, 123.45, 1),
    (128, -32768, -2147483648, -9223372036854775808, -99999.9999, -88888.888, -1.23e10, -4.56e-5, -9999.99, -99.99, 0),
    (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL);
GO

PRINT 'Advanced MSSQL types and test data created successfully';
GO
