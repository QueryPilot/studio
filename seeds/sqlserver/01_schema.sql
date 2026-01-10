-- SQL Server Partitioning & Full Schema
-- Note: Requires creating Partition Functions and Schemes first

USE todoapp;
GO

-- ==============================================================================
-- 0. CLEANUP (Drop tables in reverse dependency order)
-- ==============================================================================
IF OBJECT_ID('dbo.user_activity_summary_base', 'V') IS NOT NULL DROP VIEW dbo.user_activity_summary_base;
IF OBJECT_ID('dbo.user_activity_summary_base', 'U') IS NOT NULL DROP TABLE dbo.user_activity_summary_base;

IF OBJECT_ID('dbo.activity_logs', 'U') IS NOT NULL DROP TABLE dbo.activity_logs;
IF OBJECT_ID('dbo.comments', 'U') IS NOT NULL DROP TABLE dbo.comments;
IF OBJECT_ID('dbo.todo_categories', 'U') IS NOT NULL DROP TABLE dbo.todo_categories;
IF OBJECT_ID('dbo.todo_collaborators', 'U') IS NOT NULL DROP TABLE dbo.todo_collaborators;
IF OBJECT_ID('dbo.related_todos', 'U') IS NOT NULL DROP TABLE dbo.related_todos;
IF OBJECT_ID('dbo.categories', 'U') IS NOT NULL DROP TABLE dbo.categories;
IF OBJECT_ID('dbo.todos', 'U') IS NOT NULL DROP TABLE dbo.todos;
IF OBJECT_ID('dbo.users', 'U') IS NOT NULL DROP TABLE dbo.users;

-- ==============================================================================
-- 1. PARTITION FUNCTIONS & SCHEMES
-- ==============================================================================

-- A. Status Partitioning
IF EXISTS (SELECT * FROM sys.partition_schemes WHERE name = 'ps_todos_status') DROP PARTITION SCHEME ps_todos_status;
IF EXISTS (SELECT * FROM sys.partition_functions WHERE name = 'pf_todos_status') DROP PARTITION FUNCTION pf_todos_status;

CREATE PARTITION FUNCTION pf_todos_status (VARCHAR(20))
AS RANGE RIGHT FOR VALUES ('completed', 'in_progress');

CREATE PARTITION SCHEME ps_todos_status
AS PARTITION pf_todos_status
ALL TO ([PRIMARY]);

-- B. Date Partitioning
IF EXISTS (SELECT * FROM sys.partition_schemes WHERE name = 'ps_logs_date') DROP PARTITION SCHEME ps_logs_date;
IF EXISTS (SELECT * FROM sys.partition_functions WHERE name = 'pf_logs_date') DROP PARTITION FUNCTION pf_logs_date;

CREATE PARTITION FUNCTION pf_logs_date (datetime2)
AS RANGE RIGHT FOR VALUES ('2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01');

CREATE PARTITION SCHEME ps_logs_date
AS PARTITION pf_logs_date
ALL TO ([PRIMARY]);

-- ==============================================================================
-- 2. CORE TABLES (Users, Categories)
-- ==============================================================================
CREATE TABLE dbo.users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    username NVARCHAR(50) UNIQUE NOT NULL,
    email NVARCHAR(255) UNIQUE NOT NULL,
    full_name NVARCHAR(100),
    avatar_url NVARCHAR(255),
    bio NVARCHAR(MAX),
    is_active BIT DEFAULT 1,
    email_verified BIT DEFAULT 0,
    phone NVARCHAR(20),
    date_of_birth DATE,
    preferences NVARCHAR(MAX), -- JSON
    metadata NVARCHAR(MAX), -- JSON
    last_login_at DATETIME2,
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME()
);

CREATE TABLE dbo.categories (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    name NVARCHAR(50) NOT NULL,
    color NVARCHAR(7),
    icon NVARCHAR(50),
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_categories_user_name UNIQUE(name, user_id),
    CONSTRAINT FK_categories_users FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
);

-- ==============================================================================
-- 3. TODOS TABLE (Partitioned)
-- ==============================================================================
CREATE TABLE dbo.todos (
    id INT IDENTITY(1,1) NOT NULL,
    uuid UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL,
    user_id INT NOT NULL, -- Logical FK to users
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'archived')) DEFAULT 'pending',
    priority INT DEFAULT 3,
    due_date DATETIME2,
    
    -- Extended fields
    due_time TIME,
    due_datetime DATETIME2,
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2),
    completion_percentage TINYINT DEFAULT 0,
    tags NVARCHAR(MAX), -- JSON
    attachments NVARCHAR(MAX), -- JSON
    checklist NVARCHAR(MAX), -- JSON
    custom_fields NVARCHAR(MAX), -- JSON
    thumbnail VARBINARY(MAX),
    color_code VARCHAR(7),
    position INT,
    is_recurring BIT DEFAULT 0,
    recurrence_pattern VARCHAR(50),
    difficulty_level TINYINT,
    reward_points INT,
    cost MONEY,
    latitude FLOAT,
    longitude FLOAT,
    short_code VARCHAR(20),
    long_description NVARCHAR(MAX),
    notes NVARCHAR(MAX),
    year_created INT,
    flags VARCHAR(50), -- Comma separated
    ip_address VARCHAR(45),
    
    -- Advanced Types
    xml_data XML,
    hierarchyid_path HIERARCHYID,
    geography_location GEOGRAPHY,
    geometry_shape GEOMETRY,

    started_at DATETIME2,
    completed_at DATETIME2,
    reminder_at DATETIME2,

    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),
    
    -- Primary Key on Scheme
    CONSTRAINT PK_todos PRIMARY KEY CLUSTERED (id, status)
) ON ps_todos_status(status);

-- Indexes aligned with partition
CREATE INDEX IX_todos_user_id ON dbo.todos(user_id) ON ps_todos_status(status);


-- ==============================================================================
-- 4. RELATED TABLES
-- ==============================================================================
CREATE TABLE dbo.todo_categories (
    todo_id INT NOT NULL,
    category_id INT NOT NULL,
    PRIMARY KEY (todo_id, category_id),
    CONSTRAINT FK_todo_categories_categories FOREIGN KEY (category_id) REFERENCES dbo.categories(id) ON DELETE CASCADE
);

CREATE TABLE dbo.comments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    todo_id INT NOT NULL,
    user_id INT NOT NULL,
    content NVARCHAR(MAX) NOT NULL,
    is_edited BIT DEFAULT 0,
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME()
);

CREATE TABLE dbo.todo_collaborators (
    todo_id INT NOT NULL,
    collaborator_id INT NOT NULL,
    PRIMARY KEY (todo_id, collaborator_id)
);

CREATE TABLE dbo.related_todos (
    todo_id INT NOT NULL,
    related_todo_id INT NOT NULL,
    relation_type VARCHAR(20),
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    PRIMARY KEY (todo_id, related_todo_id)
);

-- ==============================================================================
-- 5. ACTIVITY LOGS TABLE (Partitioned)
-- ==============================================================================
CREATE TABLE dbo.activity_logs (
    id BIGINT IDENTITY(1,1) NOT NULL,
    user_id INT NOT NULL,
    todo_id INT,
    action NVARCHAR(50) NOT NULL,
    entity_type NVARCHAR(50) NOT NULL,
    details NVARCHAR(MAX), -- JSON
    ip_address VARCHAR(45),
    user_agent NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    
    -- Primary Key on Scheme
    CONSTRAINT PK_activity_logs PRIMARY KEY CLUSTERED (id, created_at)
) ON ps_logs_date(created_at);

-- Indexes
CREATE INDEX IX_logs_user_id ON dbo.activity_logs(user_id) ON ps_logs_date(created_at);
