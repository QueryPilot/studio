-- Simplified seed data for Oracle
SET SERVEROUTPUT ON;

DECLARE
    user_count NUMBER := 50; -- Reduced for Oracle
    current_user_id NUMBER;
    todo_count NUMBER;
    i NUMBER;
    j NUMBER;
    random_status VARCHAR2(20);
    random_priority VARCHAR2(20);
BEGIN
    -- Insert users
    FOR i IN 1..user_count LOOP
        INSERT INTO users (
            username, email, full_name, avatar_url, bio, is_active, 
            email_verified, phone, date_of_birth, preferences, metadata,
            last_login_at
        ) VALUES (
            'user_' || i,
            'user' || i || '@example.com',
            'User ' || i || ' Smith',
            'https://avatar.example.com/user' || i || '.jpg',
            'Bio for user ' || i || '. Lorem ipsum dolor sit amet.',
            CASE WHEN MOD(i, 10) = 0 THEN 0 ELSE 1 END,
            CASE WHEN MOD(i, 3) = 0 THEN 0 ELSE 1 END,
            '+1555' || LPAD(TRUNC(DBMS_RANDOM.VALUE(1000000, 9999999)), 7, '0'),
            SYSDATE - TRUNC(DBMS_RANDOM.VALUE(365, 365*20)),
            '{"theme": "' || CASE WHEN MOD(i, 2) = 0 THEN 'dark' ELSE 'light' END || 
            '", "notifications": ' || CASE WHEN MOD(i, 3) != 0 THEN 'true' ELSE 'false' END || 
            ', "language": "en"}',
            '{"subscription": "free", "referral_source": "google"}',
            SYSTIMESTAMP - NUMTODSINTERVAL(TRUNC(DBMS_RANDOM.VALUE(1, 30)), 'DAY')
        );
    END LOOP;

    -- Insert categories for each user
    FOR i IN 1..user_count LOOP
        INSERT INTO categories (name, color, icon, user_id) VALUES ('Work', '#FF5733', 'briefcase', i);
        INSERT INTO categories (name, color, icon, user_id) VALUES ('Personal', '#33FF57', 'home', i);
        INSERT INTO categories (name, color, icon, user_id) VALUES ('Shopping', '#3357FF', 'cart', i);
        INSERT INTO categories (name, color, icon, user_id) VALUES ('Health', '#FF33F5', 'heart', i);
        INSERT INTO categories (name, color, icon, user_id) VALUES ('Learning', '#F5FF33', 'book', i);
    END LOOP;

    -- Insert todos for each user
    FOR i IN 1..user_count LOOP
        todo_count := 20 + TRUNC(DBMS_RANDOM.VALUE(0, 31)); -- 20-50 todos per user
        
        FOR j IN 1..todo_count LOOP
            -- Random status and priority
            CASE TRUNC(DBMS_RANDOM.VALUE(1, 6))
                WHEN 1 THEN random_status := 'pending';
                WHEN 2 THEN random_status := 'in_progress';
                WHEN 3 THEN random_status := 'completed';
                WHEN 4 THEN random_status := 'cancelled';
                ELSE random_status := 'archived';
            END CASE;
            
            CASE TRUNC(DBMS_RANDOM.VALUE(1, 5))
                WHEN 1 THEN random_priority := 'low';
                WHEN 2 THEN random_priority := 'medium';
                WHEN 3 THEN random_priority := 'high';
                ELSE random_priority := 'critical';
            END CASE;
            
            INSERT INTO todos (
                user_id, title, description, status, priority,
                due_date, estimated_hours, actual_hours,
                completion_percentage, tags, color_code, position,
                difficulty_level, reward_points, 
                started_at, completed_at
            ) VALUES (
                i,
                'Task ' || j || ' for user ' || i,
                'Description for task ' || j || '. Lorem ipsum dolor sit amet.',
                random_status,
                random_priority,
                SYSDATE + TRUNC(DBMS_RANDOM.VALUE(-30, 180)),
                ROUND(DBMS_RANDOM.VALUE(0.5, 20), 2),
                CASE WHEN random_status IN ('completed', 'archived') 
                     THEN ROUND(DBMS_RANDOM.VALUE(0.5, 20), 2) 
                     ELSE NULL END,
                CASE 
                    WHEN random_status = 'completed' THEN 100
                    WHEN random_status = 'in_progress' THEN TRUNC(DBMS_RANDOM.VALUE(0, 100))
                    ELSE 0
                END,
                '["work", "urgent"]',
                '#' || LPAD(TO_CHAR(TRUNC(DBMS_RANDOM.VALUE(0, 16777215)), 'FMXXXXXX'), 6, '0'),
                j,
                TRUNC(DBMS_RANDOM.VALUE(1, 11)),
                TRUNC(DBMS_RANDOM.VALUE(0, 1000)),
                CASE WHEN random_status IN ('in_progress', 'completed') 
                     THEN SYSTIMESTAMP - NUMTODSINTERVAL(TRUNC(DBMS_RANDOM.VALUE(1, 30)), 'DAY')
                     ELSE NULL END,
                CASE WHEN random_status = 'completed' 
                     THEN SYSTIMESTAMP - NUMTODSINTERVAL(TRUNC(DBMS_RANDOM.VALUE(1, 20)), 'DAY')
                     ELSE NULL END
            );
        END LOOP;
    END LOOP;

    -- Add some comments
    INSERT INTO comments (todo_id, user_id, content)
    SELECT 
        t.id,
        t.user_id,
        'Sample comment for todo ' || t.id
    FROM todos t
    WHERE MOD(t.id, 5) = 0; -- Every 5th todo gets a comment

    -- Add activity logs
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    SELECT 
        t.user_id,
        t.id,
        'created',
        '{"action": "created", "timestamp": "' || TO_CHAR(t.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"}'
    FROM todos t
    WHERE MOD(t.id, 3) = 0; -- Every 3rd todo gets an activity log

    DBMS_OUTPUT.PUT_LINE('Seeding completed: ' || user_count || ' users with their todos');
    COMMIT;
END;
/