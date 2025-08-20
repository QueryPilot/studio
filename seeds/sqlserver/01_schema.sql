-- SQL Server schema with comprehensive data types
USE master;
GO

-- Create database if not exists
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'todoapp')
BEGIN
    CREATE DATABASE todoapp;
END
GO

USE todoapp;
GO

-- Drop existing tables if they exist
IF OBJECT_ID('dbo.activity_logs', 'U') IS NOT NULL DROP TABLE dbo.activity_logs;
IF OBJECT_ID('dbo.comments', 'U') IS NOT NULL DROP TABLE dbo.comments;
IF OBJECT_ID('dbo.related_todos', 'U') IS NOT NULL DROP TABLE dbo.related_todos;
IF OBJECT_ID('dbo.todo_collaborators', 'U') IS NOT NULL DROP TABLE dbo.todo_collaborators;
IF OBJECT_ID('dbo.todo_categories', 'U') IS NOT NULL DROP TABLE dbo.todo_categories;
IF OBJECT_ID('dbo.categories', 'U') IS NOT NULL DROP TABLE dbo.categories;
IF OBJECT_ID('dbo.todos', 'U') IS NOT NULL DROP TABLE dbo.todos;
IF OBJECT_ID('dbo.users', 'U') IS NOT NULL DROP TABLE dbo.users;
GO

-- Users table
CREATE TABLE users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    uuid UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL UNIQUE,
    username NVARCHAR(50) UNIQUE NOT NULL,
    email NVARCHAR(255) UNIQUE NOT NULL,
    full_name NVARCHAR(255),
    avatar_url NVARCHAR(MAX),
    bio NVARCHAR(MAX),
    is_active BIT DEFAULT 1,
    email_verified BIT DEFAULT 0,
    phone NVARCHAR(20),
    date_of_birth DATE,
    preferences NVARCHAR(MAX) DEFAULT '{}',
    metadata NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),
    last_login_at DATETIME2,
    deleted_at DATETIME2
);
GO

-- Todos table with comprehensive data types
CREATE TABLE todos (
    id INT IDENTITY(1,1) PRIMARY KEY,
    uuid UNIQUEIDENTIFIER DEFAULT NEWID() NOT NULL UNIQUE,
    user_id INT NOT NULL,
    title NVARCHAR(500) NOT NULL,
    description NVARCHAR(MAX),
    status NVARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled', 'archived')),
    priority NVARCHAR(20) DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    
    -- Various data types
    due_date DATE,
    due_time TIME,
    due_datetime DATETIME2,
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2),
    completion_percentage TINYINT CHECK(completion_percentage >= 0 AND completion_percentage <= 100),
    
    -- JSON stored as NVARCHAR(MAX)
    tags NVARCHAR(MAX) DEFAULT '[]',
    attachments NVARCHAR(MAX) DEFAULT '[]',
    checklist NVARCHAR(MAX) DEFAULT '[]',
    custom_fields NVARCHAR(MAX) DEFAULT '{}',
    
    -- Binary and special types
    thumbnail VARBINARY(MAX),
    color_code CHAR(7),
    position INT,
    is_recurring BIT DEFAULT 0,
    recurrence_pattern NVARCHAR(50),
    parent_todo_id INT,
    
    -- Numeric types
    difficulty_level TINYINT CHECK(difficulty_level >= 1 AND difficulty_level <= 10),
    reward_points INT DEFAULT 0,
    cost MONEY,
    latitude FLOAT,
    longitude FLOAT,
    
    -- Additional SQL Server specific types
    short_code NVARCHAR(20),
    long_description NVARCHAR(MAX),
    notes NVARCHAR(MAX),
    xml_data XML,
    hierarchyid_path HIERARCHYID,
    geography_location GEOGRAPHY,
    geometry_shape GEOMETRY,
    
    -- Timestamps
    started_at DATETIME2,
    completed_at DATETIME2,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),
    reminder_at DATETIME2,
    archived_at DATETIME2,
    row_version ROWVERSION,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_todo_id) REFERENCES todos(id)
);
GO

-- Categories table
CREATE TABLE categories (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    color NVARCHAR(7),
    icon NVARCHAR(50),
    user_id INT,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(name, user_id)
);
GO

-- Todo categories junction table
CREATE TABLE todo_categories (
    todo_id INT,
    category_id INT,
    PRIMARY KEY (todo_id, category_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE NO ACTION
);
GO

-- Comments table
CREATE TABLE comments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    todo_id INT,
    user_id INT,
    content NVARCHAR(MAX) NOT NULL,
    is_edited BIT DEFAULT 0,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

-- Activity log table
CREATE TABLE activity_logs (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id INT,
    todo_id INT,
    action NVARCHAR(50) NOT NULL,
    details NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
);
GO

-- Collaborators table
CREATE TABLE todo_collaborators (
    todo_id INT,
    collaborator_id INT,
    added_at DATETIME2 DEFAULT GETUTCDATE(),
    PRIMARY KEY (todo_id, collaborator_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (collaborator_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

-- Related todos table
CREATE TABLE related_todos (
    todo_id INT,
    related_todo_id INT,
    relation_type NVARCHAR(20) DEFAULT 'related_to' CHECK(relation_type IN ('blocks', 'blocked_by', 'related_to', 'duplicate_of')),
    PRIMARY KEY (todo_id, related_todo_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (related_todo_id) REFERENCES todos(id) ON DELETE NO ACTION
);
GO

-- Create indexes
CREATE INDEX idx_todos_user_id ON todos(user_id);
CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_priority ON todos(priority);
CREATE INDEX idx_todos_due_date ON todos(due_date);
-- Note: FULLTEXT index requires a FULLTEXT catalog to be created first
-- Skipping FULLTEXT index for now as it requires additional setup
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_todo_id ON activity_logs(todo_id);
GO

-- ============================================================================
-- ADVANCED DATABASE OBJECTS
-- ============================================================================

-- Views
CREATE VIEW user_stats AS
SELECT 
    u.id,
    u.username,
    u.email,
    COUNT(t.id) as total_todos,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_todos,
    COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_todos,
    COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress_todos,
    ROUND(AVG(CAST(t.completion_percentage AS FLOAT)), 2) as avg_completion,
    u.created_at,
    u.last_login_at
FROM users u
LEFT JOIN todos t ON u.id = t.user_id
GROUP BY u.id, u.username, u.email, u.created_at, u.last_login_at;
GO

CREATE VIEW todo_summary AS
SELECT 
    t.id,
    t.title,
    t.status,
    t.priority,
    t.due_date,
    t.completion_percentage,
    u.username as owner,
    STRING_AGG(c.name, ', ') as categories,
    COUNT(DISTINCT cm.id) as comment_count,
    COUNT(DISTINCT tc.collaborator_id) as collaborator_count
FROM todos t
JOIN users u ON t.user_id = u.id
LEFT JOIN todo_categories tc_cat ON t.id = tc_cat.todo_id
LEFT JOIN categories c ON tc_cat.category_id = c.id
LEFT JOIN comments cm ON t.id = cm.todo_id
LEFT JOIN todo_collaborators tc ON t.id = tc.todo_id
GROUP BY t.id, t.title, t.status, t.priority, t.due_date, t.completion_percentage, u.username;
GO

CREATE VIEW overdue_todos AS
SELECT 
    t.*,
    u.username,
    u.email,
    DATEDIFF(DAY, t.due_date, GETDATE()) as days_overdue
FROM todos t
JOIN users u ON t.user_id = u.id
WHERE t.due_date < CAST(GETDATE() AS DATE) 
    AND t.status NOT IN ('completed', 'cancelled', 'archived');
GO

CREATE VIEW todo_analytics AS
SELECT 
    DATEADD(WEEK, DATEDIFF(WEEK, 0, t.created_at), 0) as week_start,
    COUNT(*) as todos_created,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as todos_completed,
    AVG(t.estimated_hours) as avg_estimated_hours,
    AVG(CASE WHEN t.status = 'completed' THEN t.actual_hours END) as avg_actual_hours,
    COUNT(DISTINCT t.user_id) as active_users
FROM todos t
GROUP BY DATEADD(WEEK, DATEDIFF(WEEK, 0, t.created_at), 0);
GO

-- Indexed Views (SQL Server's equivalent to materialized views)
CREATE VIEW user_activity_summary_base
WITH SCHEMABINDING AS
SELECT 
    u.id as user_id,
    u.username,
    COUNT_BIG(*) as count_all,
    COUNT_BIG(t.id) as total_todos,
    SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_todos,
    SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending_todos,
    SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_todos,
    SUM(ISNULL(t.estimated_hours, 0)) as total_estimated_hours,
    SUM(CASE WHEN t.status = 'completed' THEN ISNULL(t.actual_hours, 0) ELSE 0 END) as total_actual_hours
FROM dbo.users u
LEFT JOIN dbo.todos t ON u.id = t.user_id
GROUP BY u.id, u.username;
GO

-- Create unique clustered index to make it an indexed view
CREATE UNIQUE CLUSTERED INDEX idx_user_activity_summary ON user_activity_summary_base(user_id);
GO

-- User-Defined Functions
CREATE FUNCTION dbo.fn_get_user_completion_rate(@user_id INT)
RETURNS DECIMAL(5,2)
AS
BEGIN
    DECLARE @total_count INT, @completed_count INT, @completion_rate DECIMAL(5,2);
    
    SELECT @total_count = COUNT(*) FROM todos WHERE user_id = @user_id;
    SELECT @completed_count = COUNT(*) FROM todos WHERE user_id = @user_id AND status = 'completed';
    
    IF @total_count > 0
        SET @completion_rate = (@completed_count * 100.0) / @total_count;
    ELSE
        SET @completion_rate = 0.00;
    
    RETURN @completion_rate;
END;
GO

CREATE FUNCTION dbo.fn_calculate_todo_score(@todo_id INT)
RETURNS DECIMAL(5,2)
AS
BEGIN
    DECLARE @score DECIMAL(5,2) = 0.00;
    DECLARE @priority_weight DECIMAL(3,2);
    DECLARE @completion_weight DECIMAL(3,2);
    DECLARE @urgency_weight DECIMAL(3,2);
    DECLARE @todo_priority NVARCHAR(20);
    DECLARE @todo_completion TINYINT;
    DECLARE @todo_due_date DATE;
    
    -- Get todo details
    SELECT @todo_priority = priority, @todo_completion = completion_percentage, @todo_due_date = due_date
    FROM todos WHERE id = @todo_id;
    
    -- Priority weight
    SET @priority_weight = CASE @todo_priority
        WHEN 'critical' THEN 4.0
        WHEN 'high' THEN 3.0
        WHEN 'medium' THEN 2.0
        WHEN 'low' THEN 1.0
        ELSE 1.0
    END;
    
    -- Completion weight
    SET @completion_weight = ISNULL(@todo_completion, 0) / 100.0;
    
    -- Urgency weight (based on due date)
    IF @todo_due_date IS NOT NULL
    BEGIN
        SET @urgency_weight = CASE 
            WHEN @todo_due_date < CAST(GETDATE() AS DATE) THEN 2.0  -- Overdue
            WHEN @todo_due_date <= DATEADD(DAY, 3, CAST(GETDATE() AS DATE)) THEN 1.5  -- Due soon
            ELSE 1.0
        END;
    END
    ELSE
        SET @urgency_weight = 1.0;
    
    -- Calculate final score
    SET @score = (@priority_weight * 25) + (@completion_weight * 50) + (@urgency_weight * 25);
    
    RETURN @score;
END;
GO

CREATE FUNCTION dbo.fn_parse_json_value(@json_string NVARCHAR(MAX), @key NVARCHAR(100))
RETURNS NVARCHAR(MAX)
AS
BEGIN
    DECLARE @result NVARCHAR(MAX);
    
    -- Simple JSON parsing for key-value extraction
    -- This is a basic implementation - in production, use JSON_VALUE if SQL Server 2016+
    DECLARE @key_pattern NVARCHAR(200) = '"' + @key + '":"';
    DECLARE @start_pos INT = CHARINDEX(@key_pattern, @json_string);
    
    IF @start_pos > 0
    BEGIN
        SET @start_pos = @start_pos + LEN(@key_pattern);
        DECLARE @end_pos INT = CHARINDEX('"', @json_string, @start_pos);
        IF @end_pos > @start_pos
            SET @result = SUBSTRING(@json_string, @start_pos, @end_pos - @start_pos);
    END
    
    RETURN @result;
END;
GO

-- Table-Valued Function
CREATE FUNCTION dbo.fn_get_user_todo_stats(@user_id INT)
RETURNS @result TABLE (
    total_todos INT,
    completed_todos INT,
    pending_todos INT,
    in_progress_todos INT,
    overdue_todos INT,
    completion_rate DECIMAL(5,2)
)
AS
BEGIN
    INSERT INTO @result
    SELECT 
        COUNT(*) as total_todos,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_todos,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_todos,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_todos,
        COUNT(CASE WHEN due_date < CAST(GETDATE() AS DATE) AND status != 'completed' THEN 1 END) as overdue_todos,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                ROUND((COUNT(CASE WHEN status = 'completed' THEN 1 END) * 100.0) / COUNT(*), 2)
            ELSE 0 
        END as completion_rate
    FROM todos 
    WHERE user_id = @user_id;
    
    RETURN;
END;
GO

-- Stored Procedures
CREATE PROCEDURE sp_complete_todo
    @todo_id INT,
    @actual_hours DECIMAL(5,2) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @user_id INT;
    DECLARE @todo_exists BIT = 0;
    
    BEGIN TRY
        BEGIN TRANSACTION;
        
        -- Check if todo exists and get user_id
        SELECT @user_id = user_id, @todo_exists = 1
        FROM todos WHERE id = @todo_id;
        
        IF @todo_exists = 0
        BEGIN
            RAISERROR('Todo with id %d does not exist', 16, 1, @todo_id);
            RETURN;
        END
        
        -- Update todo
        UPDATE todos 
        SET 
            status = 'completed',
            completion_percentage = 100,
            completed_at = GETUTCDATE(),
            actual_hours = ISNULL(@actual_hours, actual_hours),
            updated_at = GETUTCDATE()
        WHERE id = @todo_id;
        
        -- Log activity
        INSERT INTO activity_logs (user_id, todo_id, action, details)
        VALUES (
            @user_id,
            @todo_id,
            'completed',
            '{"completed_at":"' + CONVERT(NVARCHAR(30), GETUTCDATE(), 127) + '","actual_hours":' + CAST(ISNULL(@actual_hours, 0) AS NVARCHAR(10)) + '}'
        );
        
        COMMIT TRANSACTION;
        
        SELECT 'Todo completed successfully' as result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;
        
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrorMessage, 16, 1);
    END CATCH
END;
GO

CREATE PROCEDURE sp_bulk_update_todo_status
    @todo_ids NVARCHAR(MAX),  -- Comma-separated list of todo IDs
    @new_status NVARCHAR(20),
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @affected_count INT = 0;
    DECLARE @todo_id INT;
    DECLARE @pos INT;
    DECLARE @current_ids NVARCHAR(MAX) = @todo_ids + ',';
    
    BEGIN TRY
        BEGIN TRANSACTION;
        
        -- Parse comma-separated IDs and update each todo
        WHILE CHARINDEX(',', @current_ids) > 0
        BEGIN
            SET @pos = CHARINDEX(',', @current_ids);
            SET @todo_id = CAST(LTRIM(RTRIM(LEFT(@current_ids, @pos - 1))) AS INT);
            SET @current_ids = RIGHT(@current_ids, LEN(@current_ids) - @pos);
            
            -- Update todo if it belongs to the user
            UPDATE todos 
            SET status = @new_status, updated_at = GETUTCDATE()
            WHERE id = @todo_id AND user_id = @user_id;
            
            IF @@ROWCOUNT > 0
            BEGIN
                SET @affected_count = @affected_count + 1;
                
                -- Log activity
                INSERT INTO activity_logs (user_id, todo_id, action, details)
                VALUES (
                    @user_id,
                    @todo_id,
                    'status_changed',
                    '{"new_status":"' + @new_status + '","changed_at":"' + CONVERT(NVARCHAR(30), GETUTCDATE(), 127) + '"}'
                );
            END
        END
        
        COMMIT TRANSACTION;
        
        SELECT 'Updated ' + CAST(@affected_count AS NVARCHAR(10)) + ' todos to status ' + @new_status as result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;
        
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrorMessage, 16, 1);
    END CATCH
END;
GO

CREATE PROCEDURE sp_generate_user_report
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    
    -- User summary
    SELECT 
        u.username,
        u.email,
        COUNT(t.id) as total_todos,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_todos,
        COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_todos,
        COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress_todos,
        ROUND(AVG(CAST(t.completion_percentage AS FLOAT)), 2) as avg_completion_percentage,
        dbo.fn_get_user_completion_rate(@user_id) as completion_rate
    FROM users u
    LEFT JOIN todos t ON u.id = t.user_id
    WHERE u.id = @user_id
    GROUP BY u.id, u.username, u.email;
    
    -- Recent activity
    SELECT TOP 10
        al.action,
        al.details,
        al.created_at,
        t.title as todo_title
    FROM activity_logs al
    LEFT JOIN todos t ON al.todo_id = t.id
    WHERE al.user_id = @user_id
    ORDER BY al.created_at DESC;
    
    -- Category breakdown
    SELECT 
        c.name as category,
        COUNT(t.id) as todo_count,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_count
    FROM categories c
    LEFT JOIN todo_categories tc ON c.id = tc.category_id
    LEFT JOIN todos t ON tc.todo_id = t.id
    WHERE c.user_id = @user_id
    GROUP BY c.id, c.name
    ORDER BY todo_count DESC;
END;
GO

-- Triggers
CREATE TRIGGER tr_update_todo_timestamp
ON todos
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    UPDATE todos 
    SET updated_at = GETUTCDATE()
    FROM todos t
    INNER JOIN inserted i ON t.id = i.id;
END;
GO

CREATE TRIGGER tr_log_todo_creation
ON todos
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    SELECT 
        i.user_id,
        i.id,
        'created',
        '{"title":"' + REPLACE(i.title, '"', '\"') + '","priority":"' + i.priority + '","created_at":"' + CONVERT(NVARCHAR(30), i.created_at, 127) + '"}'
    FROM inserted i;
END;
GO

CREATE TRIGGER tr_log_todo_status_change
ON todos
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    SELECT 
        i.user_id,
        i.id,
        'status_changed',
        '{"old_status":"' + d.status + '","new_status":"' + i.status + '","changed_at":"' + CONVERT(NVARCHAR(30), GETUTCDATE(), 127) + '"}'
    FROM inserted i
    INNER JOIN deleted d ON i.id = d.id
    WHERE i.status != d.status;
END;
GO

CREATE TRIGGER tr_log_todo_completion
ON todos
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Auto-complete when percentage reaches 100
    UPDATE todos
    SET 
        status = 'completed',
        completed_at = GETUTCDATE()
    FROM todos t
    INNER JOIN inserted i ON t.id = i.id
    INNER JOIN deleted d ON i.id = d.id
    WHERE i.completion_percentage = 100 
        AND d.completion_percentage != 100
        AND i.status != 'completed';
    
    -- Log completion
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    SELECT 
        i.user_id,
        i.id,
        'completed',
        '{"completed_at":"' + CONVERT(NVARCHAR(30), GETUTCDATE(), 127) + '","actual_hours":' + CAST(ISNULL(i.actual_hours, 0) AS NVARCHAR(10)) + '}'
    FROM inserted i
    INNER JOIN deleted d ON i.id = d.id
    WHERE i.completion_percentage = 100 AND d.completion_percentage != 100;
END;
GO