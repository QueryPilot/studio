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
DECLARE @random_status NVARCHAR(20);
DECLARE @random_priority NVARCHAR(20);
DECLARE @category_id INT;
DECLARE @todo_id INT;

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
SET @i = 1;
WHILE @i <= @user_count
BEGIN
    INSERT INTO categories (name, color, icon, user_id) VALUES
        ('Work', '#FF5733', 'briefcase', @i),
        ('Personal', '#33FF57', 'home', @i),
        ('Shopping', '#3357FF', 'cart', @i),
        ('Health', '#FF33F5', 'heart', @i),
        ('Learning', '#F5FF33', 'book', @i);
    
    SET @i = @i + 1;
END;

-- Insert todos for each user
SET @i = 1;
WHILE @i <= @user_count
BEGIN
    SET @todo_count = CAST(50 + RAND() * 151 AS INT); -- 50-200 todos per user
    SET @j = 1;
    
    WHILE @j <= @todo_count
    BEGIN
        SET @random_status = CHOOSE(CAST(RAND() * 5 AS INT) + 1, 'pending', 'in_progress', 'completed', 'cancelled', 'archived');
        SET @random_priority = CHOOSE(CAST(RAND() * 4 AS INT) + 1, 'low', 'medium', 'high', 'critical');
        
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
            @i,
            CONCAT('Task ', @j, ' for user ', @i, ': ',
                CHOOSE(CAST(RAND() * 10 AS INT) + 1,
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
            CONCAT('Description for task ', @j, '. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'),
            @random_status,
            @random_priority,
            DATEADD(DAY, CAST(RAND() * 365 - 180 AS INT), CAST(GETDATE() AS DATE)),
            DATEADD(HOUR, CAST(RAND() * 10 AS INT), CAST('08:00:00' AS TIME)),
            DATEADD(DAY, CAST(RAND() * 365 - 180 AS INT), GETUTCDATE()),
            ROUND(RAND() * 20 + 0.5, 2),
            CASE WHEN @random_status IN ('completed', 'archived') THEN ROUND(RAND() * 20 + 0.5, 2) ELSE NULL END,
            CASE
                WHEN @random_status = 'completed' THEN 100
                WHEN @random_status = 'in_progress' THEN CAST(RAND() * 99 AS TINYINT)
                ELSE 0
            END,
            JSON_QUERY('[' + 
                '"' + CHOOSE(CAST(RAND() * 4 AS INT) + 1, 'work', 'personal', 'urgent', 'learning') + '",' +
                '"' + CHOOSE(CAST(RAND() * 4 AS INT) + 1, 'important', 'project', 'team', 'solo') + '"' +
            ']'),
            CASE WHEN RAND() > 0.7 THEN
                JSON_QUERY('[' +
                    '{"name":"document' + CAST(@j AS VARCHAR) + '.pdf","size":' + CAST(CAST(RAND() * 1000000 AS INT) AS VARCHAR) + ',"url":"https://files.example.com/doc' + CAST(@j AS VARCHAR) + '.pdf"},' +
                    '{"name":"image' + CAST(@j AS VARCHAR) + '.png","size":' + CAST(CAST(RAND() * 500000 AS INT) AS VARCHAR) + ',"url":"https://files.example.com/img' + CAST(@j AS VARCHAR) + '.png"}' +
                ']')
            ELSE '[]' END,
            CASE WHEN RAND() > 0.6 THEN
                JSON_QUERY('[' +
                    '{"id":1,"text":"Research topic","done":false},' +
                    '{"id":2,"text":"Create outline","done":false},' +
                    '{"id":3,"text":"Write draft","done":false}' +
                ']')
            ELSE '[]' END,
            JSON_MODIFY(
                JSON_MODIFY(
                    JSON_MODIFY(
                        JSON_MODIFY('{}', '$.client', CHOOSE(CAST(RAND() * 5 AS INT) + 1, 'Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Corp', 'None')),
                        '$.project_code', CASE WHEN RAND() > 0.5 THEN CONCAT('PRJ-', RIGHT('0000' + CAST(CAST(RAND() * 9999 AS INT) AS VARCHAR(4)), 4)) ELSE NULL END
                    ),
                    '$.billable', CAST(CASE WHEN RAND() > 0.5 THEN 1 ELSE 0 END AS BIT)
                ),
                '$.department', CHOOSE(CAST(RAND() * 5 AS INT) + 1, 'Engineering', 'Marketing', 'Sales', 'Support', 'HR')
            ),
            CASE WHEN RAND() > 0.9 THEN CAST(CRYPT_GEN_RANDOM(100) AS VARBINARY(MAX)) ELSE NULL END,
            CONCAT('#', RIGHT('000000' + CONVERT(VARCHAR(6), CAST(RAND() * 16777215 AS INT), 16), 6)),
            @j,
            CASE WHEN RAND() > 0.8 THEN 1 ELSE 0 END,
            CASE WHEN RAND() > 0.8 THEN CHOOSE(CAST(RAND() * 4 AS INT) + 1, 'daily', 'weekly', 'monthly', 'yearly') ELSE NULL END,
            CAST(RAND() * 10 + 1 AS TINYINT),
            CAST(RAND() * 1000 AS INT),
            CASE WHEN RAND() > 0.7 THEN CAST(RAND() * 1000 AS MONEY) ELSE NULL END,
            CASE WHEN RAND() > 0.9 THEN 37.7749 + (RAND() - 0.5) ELSE NULL END,
            CASE WHEN RAND() > 0.9 THEN -122.4194 + (RAND() - 0.5) ELSE NULL END,
            CONCAT('TSK-', RIGHT('000' + CAST(@i AS VARCHAR(3)), 3), '-', RIGHT('0000' + CAST(@j AS VARCHAR(4)), 4)),
            CASE WHEN RAND() > 0.5 THEN REPLICATE('Lorem ipsum dolor sit amet. ', CAST(RAND() * 10 + 5 AS INT)) ELSE NULL END,
            CASE WHEN RAND() > 0.7 THEN CONCAT('Note: ', REPLICATE('Important information. ', CAST(RAND() * 3 + 1 AS INT))) ELSE NULL END,
            CASE WHEN RAND() > 0.8 THEN 
                CAST('<task><metadata><source>system</source><version>1.0</version></metadata></task>' AS XML)
            ELSE NULL END,
            CASE WHEN RAND() > 0.9 THEN hierarchyid::GetRoot().GetDescendant(NULL, NULL) ELSE NULL END,
            CASE WHEN RAND() > 0.9 THEN geography::Point(37.7749 + (RAND() - 0.5), -122.4194 + (RAND() - 0.5), 4326) ELSE NULL END,
            CASE WHEN RAND() > 0.9 THEN geometry::STGeomFromText('POINT(' + CAST(RAND() * 100 AS VARCHAR) + ' ' + CAST(RAND() * 100 AS VARCHAR) + ')', 0) ELSE NULL END,
            CASE WHEN @random_status IN ('in_progress', 'completed') THEN DATEADD(DAY, -CAST(RAND() * 30 AS INT), GETUTCDATE()) ELSE NULL END,
            CASE WHEN @random_status = 'completed' THEN DATEADD(DAY, -CAST(RAND() * 20 AS INT), GETUTCDATE()) ELSE NULL END,
            CASE WHEN RAND() > 0.6 THEN DATEADD(DAY, CAST(RAND() * 30 AS INT), GETUTCDATE()) ELSE NULL END
        );
        
        SET @j = @j + 1;
    END;
    
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
INSERT INTO activity_logs (user_id, todo_id, action, details)
SELECT TOP 1000
    t.user_id,
    t.id,
    COALESCE(
        CHOOSE((ABS(CHECKSUM(NEWID())) % 6) + 1, 'created', 'updated', 'status_changed', 'priority_changed', 'assigned', 'commented'),
        'created'
    ),
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
