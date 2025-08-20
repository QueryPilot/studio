-- MySQL seed data with comprehensive data types
USE todoapp;

-- Disable foreign key checks temporarily
SET FOREIGN_KEY_CHECKS = 0;

-- Create stored procedure for seeding
DELIMITER $$

CREATE PROCEDURE seed_data()
BEGIN
    DECLARE user_count INT DEFAULT 100;
    DECLARE i INT DEFAULT 1;
    DECLARE j INT DEFAULT 1;
    DECLARE todo_count INT;
    DECLARE random_status VARCHAR(20);
    DECLARE random_priority VARCHAR(20);
    
    -- Insert users
    WHILE i <= user_count DO
        INSERT INTO users (
            username, email, full_name, avatar_url, bio, is_active,
            email_verified, phone, date_of_birth, preferences, metadata,
            last_login_at
        ) VALUES (
            CONCAT('user_', i),
            CONCAT('user', i, '@example.com'),
            CONCAT('User ', i, ' Smith'),
            CONCAT('https://avatar.example.com/user', i, '.jpg'),
            CONCAT('Bio for user ', i, '. Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
            IF(RAND() > 0.1, 1, 0),
            IF(RAND() > 0.3, 1, 0),
            CONCAT('+1555', LPAD(FLOOR(RAND() * 9999999), 7, '0')),
            DATE_SUB(CURDATE(), INTERVAL FLOOR(RAND() * 365 * 50) DAY),
            JSON_OBJECT(
                'theme', IF(RAND() > 0.5, 'dark', 'light'),
                'notifications', IF(RAND() > 0.3, true, false),
                'language', ELT(FLOOR(RAND() * 5) + 1, 'en', 'es', 'fr', 'de', 'ja'),
                'timezone', ELT(FLOOR(RAND() * 5) + 1, 'UTC', 'EST', 'PST', 'CST', 'MST')
            ),
            JSON_OBJECT(
                'subscription', ELT(FLOOR(RAND() * 3) + 1, 'free', 'basic', 'premium'),
                'referral_source', ELT(FLOOR(RAND() * 4) + 1, 'google', 'facebook', 'friend', 'other'),
                'account_type', ELT(FLOOR(RAND() * 3) + 1, 'individual', 'team', 'enterprise')
            ),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 30) DAY)
        );
        SET i = i + 1;
    END WHILE;
    
    -- Insert categories for each user
    SET i = 1;
    WHILE i <= user_count DO
        INSERT INTO categories (name, color, icon, user_id) VALUES
            ('Work', '#FF5733', 'briefcase', i),
            ('Personal', '#33FF57', 'home', i),
            ('Shopping', '#3357FF', 'cart', i),
            ('Health', '#FF33F5', 'heart', i),
            ('Learning', '#F5FF33', 'book', i);
        SET i = i + 1;
    END WHILE;
    
    -- Insert todos for each user
    SET i = 1;
    WHILE i <= user_count DO
        SET todo_count = FLOOR(50 + RAND() * 151); -- 50-200 todos per user
        SET j = 1;
        
        WHILE j <= todo_count DO
            SET random_status = ELT(FLOOR(RAND() * 5) + 1, 'pending', 'in_progress', 'completed', 'cancelled', 'archived');
            SET random_priority = ELT(FLOOR(RAND() * 4) + 1, 'low', 'medium', 'high', 'critical');
            
            INSERT INTO todos (
                user_id, title, description, status, priority,
                due_date, due_time, due_datetime, estimated_hours, actual_hours,
                completion_percentage, tags, attachments, checklist, custom_fields,
                color_code, position, is_recurring, recurrence_pattern,
                difficulty_level, reward_points, cost, latitude, longitude,
                short_code, long_description, notes,
                year_created, flags, ip_address,
                location,
                started_at, completed_at, reminder_at
            ) VALUES (
                i,
                CONCAT('Task ', j, ' for user ', i, ': ', 
                    ELT(FLOOR(RAND() * 10) + 1,
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
                CONCAT('Description for task ', j, '. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'),
                random_status,
                random_priority,
                DATE_ADD(CURDATE(), INTERVAL FLOOR(RAND() * 365 - 180) DAY),
                ADDTIME('08:00:00', SEC_TO_TIME(FLOOR(RAND() * 36000))),
                DATE_ADD(NOW(), INTERVAL FLOOR(RAND() * 365 - 180) DAY),
                ROUND(RAND() * 20 + 0.5, 2),
                IF(random_status IN ('completed', 'archived'), ROUND(RAND() * 20 + 0.5, 2), NULL),
                CASE
                    WHEN random_status = 'completed' THEN 100
                    WHEN random_status = 'in_progress' THEN FLOOR(RAND() * 99)
                    ELSE 0
                END,
                JSON_ARRAY(
                    ELT(FLOOR(RAND() * 4) + 1, 'work', 'personal', 'urgent', 'learning'),
                    ELT(FLOOR(RAND() * 4) + 1, 'important', 'project', 'team', 'solo')
                ),
                IF(RAND() > 0.7,
                    JSON_ARRAY(
                        JSON_OBJECT('name', CONCAT('document', j, '.pdf'), 'size', FLOOR(RAND() * 1000000), 'url', CONCAT('https://files.example.com/doc', j, '.pdf')),
                        JSON_OBJECT('name', CONCAT('image', j, '.png'), 'size', FLOOR(RAND() * 500000), 'url', CONCAT('https://files.example.com/img', j, '.png'))
                    ),
                    JSON_ARRAY()
                ),
                IF(RAND() > 0.6,
                    JSON_ARRAY(
                        JSON_OBJECT('id', 1, 'text', 'Research topic', 'done', false),
                        JSON_OBJECT('id', 2, 'text', 'Create outline', 'done', false),
                        JSON_OBJECT('id', 3, 'text', 'Write draft', 'done', false)
                    ),
                    JSON_ARRAY()
                ),
                JSON_OBJECT(
                    'client', ELT(FLOOR(RAND() * 5) + 1, 'Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Corp', 'None'),
                    'project_code', IF(RAND() > 0.5, CONCAT('PRJ-', LPAD(FLOOR(RAND() * 9999), 4, '0')), NULL),
                    'billable', IF(RAND() > 0.5, true, false),
                    'department', ELT(FLOOR(RAND() * 5) + 1, 'Engineering', 'Marketing', 'Sales', 'Support', 'HR')
                ),
                CONCAT('#', LPAD(HEX(FLOOR(RAND() * 16777215)), 6, '0')),
                j,
                IF(RAND() > 0.8, 1, 0),
                IF(RAND() > 0.8, ELT(FLOOR(RAND() * 4) + 1, 'daily', 'weekly', 'monthly', 'yearly'), NULL),
                FLOOR(RAND() * 10) + 1,
                FLOOR(RAND() * 1000),
                IF(RAND() > 0.7, ROUND(RAND() * 1000, 2), NULL),
                IF(RAND() > 0.9, 37.7749 + (RAND() - 0.5), NULL),
                IF(RAND() > 0.9, -122.4194 + (RAND() - 0.5), NULL),
                CONCAT('TSK-', LPAD(i, 3, '0'), '-', LPAD(j, 4, '0')),
                IF(RAND() > 0.5, REPEAT('Lorem ipsum dolor sit amet. ', FLOOR(RAND() * 10 + 5)), NULL),
                IF(RAND() > 0.7, CONCAT('Note: ', REPEAT('Important information. ', FLOOR(RAND() * 3 + 1))), NULL),
                YEAR(CURDATE()),
                IF(RAND() > 0.7,
                    CONCAT_WS(',',
                        IF(RAND() > 0.5, 'urgent', NULL),
                        IF(RAND() > 0.5, 'important', NULL),
                        IF(RAND() > 0.7, 'delegated', NULL)
                    ),
                    NULL
                ),
                CONCAT('192.168.', FLOOR(RAND() * 255), '.', FLOOR(RAND() * 255)),
                IF(RAND() > 0.9, ST_GeomFromText(CONCAT('POINT(', 37.7749 + (RAND() - 0.5), ' ', -122.4194 + (RAND() - 0.5), ')')), NULL),
                IF(random_status IN ('in_progress', 'completed'), DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 30) DAY), NULL),
                IF(random_status = 'completed', DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 20) DAY), NULL),
                IF(RAND() > 0.6, DATE_ADD(NOW(), INTERVAL FLOOR(RAND() * 30) DAY), NULL)
            );
            
            SET j = j + 1;
        END WHILE;
        
        SET i = i + 1;
    END WHILE;
    
    -- Add todo-category relationships
    INSERT INTO todo_categories (todo_id, category_id)
    SELECT 
        t.id,
        c.id
    FROM todos t
    JOIN categories c ON c.user_id = t.user_id
    WHERE RAND() < 0.5
    LIMIT 5000;
    
    -- Add collaborators
    INSERT INTO todo_collaborators (todo_id, collaborator_id)
    SELECT DISTINCT
        t.id,
        u.id
    FROM todos t
    CROSS JOIN users u
    WHERE t.user_id != u.id
        AND RAND() < 0.1
    LIMIT 2000;
    
    -- Add related todos
    INSERT INTO related_todos (todo_id, related_todo_id, relation_type)
    SELECT DISTINCT
        t1.id,
        t2.id,
        ELT(FLOOR(RAND() * 4) + 1, 'blocks', 'blocked_by', 'related_to', 'duplicate_of')
    FROM todos t1
    JOIN todos t2 ON t1.user_id = t2.user_id AND t1.id < t2.id
    WHERE RAND() < 0.05
    LIMIT 1000;
    
    -- Add comments
    INSERT INTO comments (todo_id, user_id, content, is_edited)
    SELECT 
        t.id,
        t.user_id,
        CONCAT('Comment: ', 
            ELT(FLOOR(RAND() * 8) + 1,
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
        IF(RAND() > 0.8, 1, 0)
    FROM todos t
    WHERE RAND() < 0.3
    LIMIT 500;
    
    -- Add activity logs
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    SELECT 
        t.user_id,
        t.id,
        ELT(FLOOR(RAND() * 6) + 1, 'created', 'updated', 'status_changed', 'priority_changed', 'assigned', 'commented'),
        JSON_OBJECT(
            'timestamp', DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 30) DAY),
            'ip_address', CONCAT('192.168.', FLOOR(RAND() * 255), '.', FLOOR(RAND() * 255)),
            'user_agent', 'Mozilla/5.0'
        )
    FROM todos t
    WHERE RAND() < 0.2
    LIMIT 1000;
    
END$$

DELIMITER ;

-- Execute the procedure
CALL seed_data();

-- Clean up
DROP PROCEDURE seed_data;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;

-- Show summary
SELECT 'Seeding completed!' as message;
SELECT COUNT(*) as user_count FROM users;
SELECT COUNT(*) as todo_count FROM todos;
SELECT COUNT(*) as comment_count FROM comments;
SELECT COUNT(*) as activity_count FROM activity_logs;