-- Oracle seed data with comprehensive data types

SET SQLBLANKLINES ON;
SET SERVEROUTPUT ON;

DECLARE
    user_count NUMBER := 100;
    user_id NUMBER;
    todo_count NUMBER;
    random_status VARCHAR2(20);
    random_priority NUMBER;
    category_id NUMBER;
    todo_id NUMBER;
    
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
            'Bio for user ' || i || '. Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
            CASE WHEN DBMS_RANDOM.VALUE > 0.1 THEN 1 ELSE 0 END,
            CASE WHEN DBMS_RANDOM.VALUE > 0.3 THEN 1 ELSE 0 END,
            '+1555' || LPAD(TRUNC(DBMS_RANDOM.VALUE * 9999999), 7, '0'),
            SYSDATE - TRUNC(DBMS_RANDOM.VALUE * 365 * 50),
            JSON_OBJECT(
                'theme' VALUE CASE WHEN DBMS_RANDOM.VALUE > 0.5 THEN 'dark' ELSE 'light' END,
                'notifications' VALUE CASE WHEN DBMS_RANDOM.VALUE > 0.3 THEN 'true' ELSE 'false' END,
                'language' VALUE CASE 
                    WHEN DBMS_RANDOM.VALUE < 0.2 THEN 'en'
                    WHEN DBMS_RANDOM.VALUE < 0.4 THEN 'es'
                    WHEN DBMS_RANDOM.VALUE < 0.6 THEN 'fr'
                    WHEN DBMS_RANDOM.VALUE < 0.8 THEN 'de'
                    ELSE 'ja'
                END,
                'timezone' VALUE CASE 
                    WHEN DBMS_RANDOM.VALUE < 0.2 THEN 'UTC'
                    WHEN DBMS_RANDOM.VALUE < 0.4 THEN 'EST'
                    WHEN DBMS_RANDOM.VALUE < 0.6 THEN 'PST'
                    WHEN DBMS_RANDOM.VALUE < 0.8 THEN 'CST'
                    ELSE 'MST'
                END
            ),
            JSON_OBJECT(
                'subscription' VALUE CASE 
                    WHEN DBMS_RANDOM.VALUE < 0.33 THEN 'free'
                    WHEN DBMS_RANDOM.VALUE < 0.66 THEN 'basic'
                    ELSE 'premium'
                END,
                'referral_source' VALUE CASE 
                    WHEN DBMS_RANDOM.VALUE < 0.25 THEN 'google'
                    WHEN DBMS_RANDOM.VALUE < 0.5 THEN 'facebook'
                    WHEN DBMS_RANDOM.VALUE < 0.75 THEN 'friend'
                    ELSE 'other'
                END,
                'account_type' VALUE CASE 
                    WHEN DBMS_RANDOM.VALUE < 0.33 THEN 'individual'
                    WHEN DBMS_RANDOM.VALUE < 0.66 THEN 'team'
                    ELSE 'enterprise'
                END
            ),
            SYSTIMESTAMP - INTERVAL '30' DAY * DBMS_RANDOM.VALUE
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
        todo_count := TRUNC(50 + DBMS_RANDOM.VALUE * 151); -- 50-200 todos per user
        
        FOR j IN 1..todo_count LOOP
            random_status := CASE 
                WHEN DBMS_RANDOM.VALUE < 0.2 THEN 'pending'
                WHEN DBMS_RANDOM.VALUE < 0.4 THEN 'in_progress'
                WHEN DBMS_RANDOM.VALUE < 0.6 THEN 'completed'
                WHEN DBMS_RANDOM.VALUE < 0.8 THEN 'cancelled'
                ELSE 'archived'
            END;
            
            random_priority := TRUNC(DBMS_RANDOM.VALUE * 5) + 1;
            
            INSERT INTO todos (
                user_id, title, description, status, priority,
                due_date, due_time, due_datetime, estimated_hours, actual_hours,
                completion_percentage, tags, attachments, checklist, custom_fields,
                color_code, position, is_recurring, recurrence_pattern,
                difficulty_level, reward_points, cost, latitude, longitude,
                short_code, long_description, notes,
                xml_data, interval_ds, year_month_interval, raw_data,
                started_at, completed_at, reminder_at
            ) VALUES (
                i,
                'Task ' || j || ' for user ' || i || ': ' || CASE 
                    WHEN DBMS_RANDOM.VALUE < 0.1 THEN 'Complete project documentation'
                    WHEN DBMS_RANDOM.VALUE < 0.2 THEN 'Review pull requests'
                    WHEN DBMS_RANDOM.VALUE < 0.3 THEN 'Attend team meeting'
                    WHEN DBMS_RANDOM.VALUE < 0.4 THEN 'Update dependencies'
                    WHEN DBMS_RANDOM.VALUE < 0.5 THEN 'Fix bug in production'
                    WHEN DBMS_RANDOM.VALUE < 0.6 THEN 'Implement new feature'
                    WHEN DBMS_RANDOM.VALUE < 0.7 THEN 'Write unit tests'
                    WHEN DBMS_RANDOM.VALUE < 0.8 THEN 'Deploy to staging'
                    WHEN DBMS_RANDOM.VALUE < 0.9 THEN 'Customer call'
                    ELSE 'Research new technology'
                END,
                'Description for task ' || j || '. Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
                random_status,
                random_priority,
                SYSDATE + TRUNC(DBMS_RANDOM.VALUE * 365 - 180),
                SYSTIMESTAMP + INTERVAL '8' HOUR + INTERVAL '0' MINUTE,
                SYSTIMESTAMP + INTERVAL '1' DAY * (DBMS_RANDOM.VALUE * 365 - 180),
                ROUND(DBMS_RANDOM.VALUE * 20 + 0.5, 2),
                CASE WHEN random_status IN ('completed', 'archived') THEN ROUND(DBMS_RANDOM.VALUE * 20 + 0.5, 2) ELSE NULL END,
                CASE
                    WHEN random_status = 'completed' THEN 100
                    WHEN random_status = 'in_progress' THEN TRUNC(DBMS_RANDOM.VALUE * 99)
                    ELSE 0
                END,
                JSON_ARRAY(
                    CASE 
                        WHEN DBMS_RANDOM.VALUE < 0.25 THEN 'work'
                        WHEN DBMS_RANDOM.VALUE < 0.5 THEN 'personal'
                        WHEN DBMS_RANDOM.VALUE < 0.75 THEN 'urgent'
                        ELSE 'learning'
                    END,
                    CASE 
                        WHEN DBMS_RANDOM.VALUE < 0.25 THEN 'important'
                        WHEN DBMS_RANDOM.VALUE < 0.5 THEN 'project'
                        WHEN DBMS_RANDOM.VALUE < 0.75 THEN 'team'
                        ELSE 'solo'
                    END
                ),
                CASE WHEN DBMS_RANDOM.VALUE > 0.7 THEN
                    JSON_ARRAY(
                        JSON_OBJECT(
                            'name' VALUE 'document' || j || '.pdf',
                            'size' VALUE TRUNC(DBMS_RANDOM.VALUE * 1000000),
                            'url' VALUE 'https://files.example.com/doc' || j || '.pdf'
                        ),
                        JSON_OBJECT(
                            'name' VALUE 'image' || j || '.png',
                            'size' VALUE TRUNC(DBMS_RANDOM.VALUE * 500000),
                            'url' VALUE 'https://files.example.com/img' || j || '.png'
                        )
                    )
                ELSE JSON_ARRAY() END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.6 THEN
                    JSON_ARRAY(
                        JSON_OBJECT('id' VALUE 1, 'text' VALUE 'Research topic', 'done' VALUE 'false'),
                        JSON_OBJECT('id' VALUE 2, 'text' VALUE 'Create outline', 'done' VALUE 'false'),
                        JSON_OBJECT('id' VALUE 3, 'text' VALUE 'Write draft', 'done' VALUE 'false')
                    )
                ELSE JSON_ARRAY() END,
                JSON_OBJECT(
                    'client' VALUE CASE 
                        WHEN DBMS_RANDOM.VALUE < 0.2 THEN 'Acme Corp'
                        WHEN DBMS_RANDOM.VALUE < 0.4 THEN 'Globex Inc'
                        WHEN DBMS_RANDOM.VALUE < 0.6 THEN 'Initech'
                        WHEN DBMS_RANDOM.VALUE < 0.8 THEN 'Umbrella Corp'
                        ELSE 'None'
                    END,
                    'project_code' VALUE CASE WHEN DBMS_RANDOM.VALUE > 0.5 THEN 'PRJ-' || LPAD(TRUNC(DBMS_RANDOM.VALUE * 9999), 4, '0') ELSE NULL END,
                    'billable' VALUE CASE WHEN DBMS_RANDOM.VALUE > 0.5 THEN 'true' ELSE 'false' END,
                    'department' VALUE CASE 
                        WHEN DBMS_RANDOM.VALUE < 0.2 THEN 'Engineering'
                        WHEN DBMS_RANDOM.VALUE < 0.4 THEN 'Marketing'
                        WHEN DBMS_RANDOM.VALUE < 0.6 THEN 'Sales'
                        WHEN DBMS_RANDOM.VALUE < 0.8 THEN 'Support'
                        ELSE 'HR'
                    END
                ),
                '#' || LPAD(TO_CHAR(TRUNC(DBMS_RANDOM.VALUE * 16777215), 'XXXXXX'), 6, '0'),
                j,
                CASE WHEN DBMS_RANDOM.VALUE > 0.8 THEN 1 ELSE 0 END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.8 THEN 
                    CASE 
                        WHEN DBMS_RANDOM.VALUE < 0.25 THEN 'daily'
                        WHEN DBMS_RANDOM.VALUE < 0.5 THEN 'weekly'
                        WHEN DBMS_RANDOM.VALUE < 0.75 THEN 'monthly'
                        ELSE 'yearly'
                    END
                ELSE NULL END,
                TRUNC(DBMS_RANDOM.VALUE * 10 + 1),
                TRUNC(DBMS_RANDOM.VALUE * 1000),
                CASE WHEN DBMS_RANDOM.VALUE > 0.7 THEN DBMS_RANDOM.VALUE * 1000 ELSE NULL END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.9 THEN 37.7749 + (DBMS_RANDOM.VALUE - 0.5) ELSE NULL END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.9 THEN -122.4194 + (DBMS_RANDOM.VALUE - 0.5) ELSE NULL END,
                'TSK-' || LPAD(i, 3, '0') || '-' || LPAD(j, 4, '0'),
                CASE WHEN DBMS_RANDOM.VALUE > 0.5 THEN 
                    RPAD('Lorem ipsum dolor sit amet. ', TRUNC(DBMS_RANDOM.VALUE * 10 + 5) * 30, 'Lorem ipsum dolor sit amet. ')
                ELSE NULL END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.7 THEN 
                    'Note: ' || RPAD('Important information. ', TRUNC(DBMS_RANDOM.VALUE * 3 + 1) * 25, 'Important information. ')
                ELSE NULL END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.8 THEN 
                    XMLTYPE('<task><metadata><source>system</source><version>1.0</version></metadata></task>')
                ELSE NULL END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.9 THEN 
                    INTERVAL '1' DAY + INTERVAL '2' HOUR + INTERVAL '30' MINUTE
                ELSE NULL END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.9 THEN 
                    INTERVAL '1' YEAR + INTERVAL '6' MONTH
                ELSE NULL END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.9 THEN 
                    HEXTORAW('DEADBEEF')
                ELSE NULL END,
                CASE WHEN random_status IN ('in_progress', 'completed') THEN 
                    SYSTIMESTAMP - INTERVAL '30' DAY * DBMS_RANDOM.VALUE 
                ELSE NULL END,
                CASE WHEN random_status = 'completed' THEN 
                    SYSTIMESTAMP - INTERVAL '20' DAY * DBMS_RANDOM.VALUE 
                ELSE NULL END,
                CASE WHEN DBMS_RANDOM.VALUE > 0.6 THEN 
                    SYSTIMESTAMP + INTERVAL '30' DAY * DBMS_RANDOM.VALUE 
                ELSE NULL END
            );
        END LOOP;
    END LOOP;
    
    -- Insert activity logs
    FOR t IN (SELECT id, user_id, created_at FROM todos WHERE ROWNUM <= 2000) LOOP
        INSERT INTO activity_logs (
            user_id, todo_id, action, entity_type, details, created_at
        ) VALUES (
            t.user_id,
            t.id,
            CASE 
                WHEN DBMS_RANDOM.VALUE < 0.2 THEN 'created'
                WHEN DBMS_RANDOM.VALUE < 0.4 THEN 'updated'
                WHEN DBMS_RANDOM.VALUE < 0.6 THEN 'status_changed'
                WHEN DBMS_RANDOM.VALUE < 0.8 THEN 'assigned'
                ELSE 'commented'
            END,
            'todo',
            JSON_OBJECT(
                'changes' VALUE 'status',
                'previous' VALUE 'pending',
                'new' VALUE 'in_progress'
            ),
            t.created_at -- Use todo's created_at to distribute across partitions
        );
    END LOOP;
    
    COMMIT;
    
    -- Show summary
    DBMS_OUTPUT.PUT_LINE('Seeding completed!');
    
END;
/

-- Show counts
SELECT 'Users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'Todos' as table_name, COUNT(*) as count FROM todos
UNION ALL
SELECT 'Categories' as table_name, COUNT(*) as count FROM categories
UNION ALL
SELECT 'Activity Logs' as table_name, COUNT(*) as count FROM activity_logs;