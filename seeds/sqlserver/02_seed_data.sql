-- SQL Server seed data with comprehensive data types
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

-- Declare variables
DECLARE @user_count INT = 100;
DECLARE @i INT = 1;
DECLARE @j INT;
DECLARE @user_id INT;
DECLARE @todo_count INT;
DECLARE @category_id INT;
DECLARE @todo_id INT;
DECLARE @random_status NVARCHAR(20);
DECLARE @random_priority INT;

SET NOCOUNT ON;

-- Cleanup existing data to avoid unique key violations on re-runs
DELETE FROM activity_logs;
DELETE FROM comments;
DELETE FROM related_todos;
DELETE FROM todo_collaborators;
DELETE FROM todo_categories;
DELETE FROM todos;
DELETE FROM categories;
DELETE FROM users;
DBCC CHECKIDENT ('users', RESEED, 0);
DBCC CHECKIDENT ('categories', RESEED, 0);
DBCC CHECKIDENT ('todos', RESEED, 0);
DBCC CHECKIDENT ('comments', RESEED, 0);
DBCC CHECKIDENT ('activity_logs', RESEED, 0);

PRINT 'Starting seed...';

-- Insert users
WHILE @i <= @user_count
BEGIN
    INSERT INTO users (
        username, email, full_name, avatar_url, bio, is_active,
        email_verified, phone, date_of_birth, preferences, metadata,
        last_login_at
    ) VALUES (
        CONCAT('user_', @i),
        CONCAT('user', @i, '@example.com'),
        CONCAT('User ', @i, ' Smith'),
        CONCAT('https://avatar.example.com/user', @i, '.jpg'),
        CONCAT('Bio for user ', @i, '. Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
        CASE WHEN RAND() > 0.1 THEN 1 ELSE 0 END,
        CASE WHEN RAND() > 0.3 THEN 1 ELSE 0 END,
        CONCAT('+1555', RIGHT('0000000' + CAST(CAST(RAND() * 9999999 AS INT) AS VARCHAR(7)), 7)),
        DATEADD(DAY, -CAST(RAND() * 365 * 50 AS INT), GETDATE()),
        JSON_MODIFY(
            JSON_MODIFY(
                JSON_MODIFY(
                    JSON_MODIFY('{}', '$.theme', CASE WHEN RAND() > 0.5 THEN 'dark' ELSE 'light' END),
                    '$.notifications', CAST(CASE WHEN RAND() > 0.3 THEN 1 ELSE 0 END AS BIT)
                ),
                '$.language', CHOOSE(CAST(RAND() * 5 AS INT) + 1, 'en', 'es', 'fr', 'de', 'ja')
            ),
            '$.timezone', CHOOSE(CAST(RAND() * 5 AS INT) + 1, 'UTC', 'EST', 'PST', 'CST', 'MST')
        ),
        JSON_MODIFY(
            JSON_MODIFY(
                JSON_MODIFY('{}', '$.subscription', CHOOSE(CAST(RAND() * 3 AS INT) + 1, 'free', 'basic', 'premium')),
                '$.referral_source', CHOOSE(CAST(RAND() * 4 AS INT) + 1, 'google', 'facebook', 'friend', 'other')
            ),
            '$.account_type', CHOOSE(CAST(RAND() * 3 AS INT) + 1, 'individual', 'team', 'enterprise')
        ),
        DATEADD(DAY, -CAST(RAND() * 30 AS INT), GETUTCDATE())
    );
    
    SET @i = @i + 1;
END;

-- Insert categories for each user
PRINT 'Inserting categories...';
SET @i = 1;
WHILE @i <= @user_count
BEGIN
    SET @user_id = NULL;
    SELECT @user_id = id FROM users ORDER BY id OFFSET (@i - 1) ROWS FETCH NEXT 1 ROWS ONLY;

    IF @user_id IS NOT NULL
    BEGIN
        INSERT INTO categories (name, color, icon, user_id) VALUES
            ('Work', '#FF5733', 'briefcase', @user_id),
            ('Personal', '#33FF57', 'home', @user_id),
            ('Shopping', '#3357FF', 'cart', @user_id),
            ('Health', '#FF33F5', 'heart', @user_id),
            ('Learning', '#F5FF33', 'book', @user_id);
    END
    
    SET @i = @i + 1;
END;

-- Insert todos for each user
PRINT 'Inserting todos...';
SET @i = 1;
WHILE @i <= @user_count
BEGIN
    SET @user_id = NULL;
    SELECT @user_id = id FROM users ORDER BY id OFFSET (@i - 1) ROWS FETCH NEXT 1 ROWS ONLY;
    
    IF @user_id IS NOT NULL
    BEGIN
        SET @todo_count = CAST(50 + (ABS(CHECKSUM(NEWID())) % 151) AS INT); -- 50-200 todos per user
        SET @j = 1;
        
        WHILE @j <= @todo_count
        BEGIN
            -- Set variables for consistent data generation
            SET @random_status = CASE (ABS(CHECKSUM(NEWID())) % 5)
                WHEN 0 THEN 'pending'
                WHEN 1 THEN 'in_progress'
                WHEN 2 THEN 'completed'
                WHEN 3 THEN 'cancelled'
                ELSE 'archived'
            END;
            SET @random_priority = (ABS(CHECKSUM(NEWID())) % 4) + 1;

            INSERT INTO todos (
                user_id, title, description, status, priority,
                due_date, due_time, due_datetime, estimated_hours, actual_hours,
                completion_percentage, tags, attachments, checklist, custom_fields,
                thumbnail, color_code, position, is_recurring, recurrence_pattern,
                difficulty_level, reward_points, cost, latitude, longitude,
                short_code, long_description, notes,
                xml_data, hierarchyid_path, geography_location, geometry_shape,
                started_at, completed_at, reminder_at
            ) VALUES (
                @user_id,
                CONCAT('Task ', @j, ' for user ', @i, ': ',
                    CHOOSE((ABS(CHECKSUM(NEWID())) % 10) + 1,
                        'Complete project documentation',
                        'Review pull requests',
                        'Attend team meeting',
                        'Update dependencies',
                        'Fix bug in production',
                        'Implement new feature',
                        'Write unit tests',
                        'Deploy to staging',
                        'Customer call',
                        'Research new technology'
                    )
                ),
                CONCAT('Description for task ', @j, '. Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
                @random_status,
                @random_priority,
                DATEADD(DAY, (ABS(CHECKSUM(NEWID())) % 365) - 180, CAST(GETDATE() AS DATE)),
                DATEADD(HOUR, (ABS(CHECKSUM(NEWID())) % 10), CAST('08:00:00' AS TIME)),
                DATEADD(DAY, (ABS(CHECKSUM(NEWID())) % 365) - 180, GETUTCDATE()),
                ROUND((ABS(CHECKSUM(NEWID())) % 2000) / 100.0 + 0.5, 2),
                NULL, -- Simplified actual_hours
                0, -- Simplified completion
                JSON_QUERY('["work", "important"]'),
                '[]',
                '[]',
                NULL,
                NULL, -- thumbnail
                '#FF0000',
                @j,
                0,
                NULL,
                1,
                100,
                NULL,
                NULL,
                NULL,
                CONCAT('TSK-', @i, '-', @j),
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL
            );
            
            SET @j = @j + 1;
        END;
    END
    
    SET @i = @i + 1;
END;

-- Add todo-category relationships
INSERT INTO todo_categories (todo_id, category_id)
SELECT TOP 5000
    t.id,
    c.id
FROM todos t
CROSS JOIN categories c
WHERE c.user_id = t.user_id
    AND RAND(CHECKSUM(NEWID())) < 0.5
ORDER BY NEWID();

-- Add collaborators
INSERT INTO todo_collaborators (todo_id, collaborator_id)
SELECT TOP 2000 * FROM (
    SELECT DISTINCT
        t.id AS todo_id,
        u.id AS collaborator_id
    FROM todos t
    CROSS JOIN users u
    WHERE t.user_id != u.id
        AND RAND(CHECKSUM(NEWID())) < 0.1
) AS subquery
ORDER BY NEWID();

-- Add related todos
INSERT INTO related_todos (todo_id, related_todo_id, relation_type)
SELECT TOP 1000 * FROM (
    SELECT DISTINCT
        t1.id AS todo_id,
        t2.id AS related_todo_id,
        CHOOSE(CAST(RAND(CHECKSUM(NEWID())) * 4 AS INT) + 1, 'blocks', 'blocked_by', 'related_to', 'duplicate_of') AS relation_type
    FROM todos t1
    JOIN todos t2 ON t1.user_id = t2.user_id AND t1.id < t2.id
    WHERE RAND(CHECKSUM(NEWID())) < 0.05
) AS subquery
ORDER BY NEWID();

-- Add comments
INSERT INTO comments (todo_id, user_id, content, is_edited)
SELECT TOP 500
    t.id,
    t.user_id,
    CONCAT('Comment: ',
        CHOOSE(CAST(RAND(CHECKSUM(NEWID())) * 8 AS INT) + 1,
            'Great progress on this!',
            'Need more information about requirements',
            'This is blocked by another task',
            'Updated the deadline',
            'Added new attachments',
            'Please review when you have time',
            'Marking as complete',
            'Moving to next sprint'
        )
    ),
    CASE WHEN RAND(CHECKSUM(NEWID())) > 0.8 THEN 1 ELSE 0 END
FROM todos t
WHERE RAND(CHECKSUM(NEWID())) < 0.3
ORDER BY NEWID();

-- Add activity logs
    INSERT INTO activity_logs (user_id, todo_id, action, entity_type, details)
    SELECT TOP 1000
        t.user_id,
        t.id,
        COALESCE(
            CHOOSE((ABS(CHECKSUM(NEWID())) % 6) + 1, 'created', 'updated', 'status_changed', 'priority_changed', 'assigned', 'commented'),
            'created'
        ),
        'todo',
        JSON_MODIFY(
        JSON_MODIFY(
            JSON_MODIFY('{}', '$.timestamp', CONVERT(VARCHAR(30), DATEADD(DAY, -CAST(RAND(CHECKSUM(NEWID())) * 30 AS INT), GETUTCDATE()), 126)),
            '$.ip_address', CONCAT('192.168.', CAST(RAND(CHECKSUM(NEWID())) * 255 AS INT), '.', CAST(RAND(CHECKSUM(NEWID())) * 255 AS INT))
        ),
        '$.user_agent', 'Mozilla/5.0'
    )
FROM todos t
WHERE RAND(CHECKSUM(NEWID())) < 0.2
ORDER BY NEWID();

-- Show summary
SELECT 'Seeding completed!' as message;
SELECT COUNT(*) as user_count FROM users;
SELECT COUNT(*) as todo_count FROM todos;
SELECT COUNT(*) as comment_count FROM comments;
SELECT COUNT(*) as activity_count FROM activity_logs;
GO
