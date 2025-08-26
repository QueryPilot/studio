-- Seed data for PostgreSQL

-- Temporarily disable the materialized view refresh trigger to avoid memory issues
ALTER TABLE todos DISABLE TRIGGER tr_refresh_mv_after_todo_change;

DO $$
DECLARE
    user_count INTEGER := 100;
    current_user_id INTEGER;
    todo_count INTEGER;
    i INTEGER;
    j INTEGER;
    random_status todo_status;
    random_priority priority_level;
    statuses todo_status[] := ARRAY['pending', 'in_progress', 'completed', 'cancelled', 'archived'];
    priorities priority_level[] := ARRAY['low', 'medium', 'high', 'critical'];
    sample_tags JSONB[] := ARRAY[
        '["work", "urgent"]'::JSONB,
        '["personal", "health"]'::JSONB,
        '["project", "team"]'::JSONB,
        '["home", "family"]'::JSONB,
        '["learning", "development"]'::JSONB,
        '["finance", "budget"]'::JSONB,
        '["travel", "vacation"]'::JSONB,
        '["shopping", "errands"]'::JSONB
    ];
    sample_checklist JSONB := '[
        {"id": 1, "text": "Research topic", "done": false},
        {"id": 2, "text": "Create outline", "done": false},
        {"id": 3, "text": "Write draft", "done": false},
        {"id": 4, "text": "Review and edit", "done": false},
        {"id": 5, "text": "Final review", "done": false}
    ]'::JSONB;
BEGIN
    RAISE NOTICE 'Starting to insert % users', user_count;
    
    -- Insert users
    FOR i IN 1..user_count LOOP
        BEGIN
            INSERT INTO users (
            username, email, full_name, avatar_url, bio, is_active, 
            email_verified, phone, date_of_birth, preferences, metadata,
            last_login_at
        ) VALUES (
            'user_' || i,
            'user' || i || '@example.com',
            'User ' || i || ' Smith',
            'https://avatar.example.com/user' || i || '.jpg',
            'Bio for user ' || i || '. ' || repeat('Lorem ipsum dolor sit amet. ', (random() * 3 + 1)::int),
            random() > 0.1,
            random() > 0.3,
            '+1555' || lpad((random() * 9999999)::int::text, 7, '0'),
            CURRENT_DATE - ((random() * 365 * 50) || ' days')::interval,
            jsonb_build_object(
                'theme', CASE WHEN random() > 0.5 THEN 'dark' ELSE 'light' END,
                'notifications', random() > 0.3,
                'language', (ARRAY['en', 'es', 'fr', 'de', 'ja'])[floor(random() * 5 + 1)],
                'timezone', (ARRAY['UTC', 'EST', 'PST', 'CST', 'MST'])[floor(random() * 5 + 1)]
            ),
            hstore(ARRAY[
                ['subscription', (ARRAY['free', 'basic', 'premium'])[floor(random() * 3 + 1)]],
                ['referral_source', (ARRAY['google', 'facebook', 'friend', 'other'])[floor(random() * 4 + 1)]],
                ['account_type', (ARRAY['individual', 'team', 'enterprise'])[floor(random() * 3 + 1)]]
            ]),
            CURRENT_TIMESTAMP - ((random() * 30) || ' days')::interval
        );
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Error inserting user %: %', i, SQLERRM;
        END;
    END LOOP;
    
    -- Check how many users were inserted
    SELECT COUNT(*) INTO i FROM users;
    RAISE NOTICE 'Successfully inserted % users', i;
    
    IF i = 0 THEN
        RAISE EXCEPTION 'Failed to insert any users';
    END IF;

    -- Insert categories for each user
    FOR current_user_id IN (SELECT id FROM users ORDER BY id LIMIT user_count) LOOP
        INSERT INTO categories (name, color, icon, user_id) VALUES
            ('Work', '#FF5733', 'briefcase', current_user_id),
            ('Personal', '#33FF57', 'home', current_user_id),
            ('Shopping', '#3357FF', 'cart', current_user_id),
            ('Health', '#FF33F5', 'heart', current_user_id),
            ('Learning', '#F5FF33', 'book', current_user_id);
    END LOOP;

    -- Insert todos for each user
    FOR current_user_id IN (SELECT id FROM users ORDER BY id) LOOP
        todo_count := 50 + floor(random() * 151)::int; -- 50-200 todos per user
        
        FOR j IN 1..todo_count LOOP
            random_status := statuses[floor(random() * 5 + 1)];
            random_priority := priorities[floor(random() * 4 + 1)];
            
            INSERT INTO todos (
                user_id, title, description, status, priority,
                due_date, due_time, due_datetime, estimated_hours, actual_hours,
                completion_percentage, tags, attachments, checklist, custom_fields,
                color_code, position, is_recurring, recurrence_pattern,
                difficulty_level, reward_points, cost, latitude, longitude,
                collaborator_ids, related_todo_ids, blocked_by_ids,
                created_from_ip, last_modified_ip, valid_during,
                started_at, completed_at, reminder_at
            ) VALUES (
                current_user_id,
                'Task ' || j || ' for user ' || current_user_id || ': ' || (ARRAY[
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
                ])[floor(random() * 10 + 1)],
                'Description for task ' || j || '. ' || repeat('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ', (random() * 5 + 1)::int),
                random_status,
                random_priority,
                CURRENT_DATE + ((random() * 365 - 180) || ' days')::interval,
                (TIME '08:00:00' + ((random() * 10) || ' hours')::interval)::TIME,
                CURRENT_TIMESTAMP + ((random() * 365 - 180) || ' days')::interval,
                (random() * 20 + 0.5)::numeric(5,2),
                CASE WHEN random_status IN ('completed', 'archived') THEN (random() * 20 + 0.5)::numeric(5,2) ELSE NULL END,
                CASE 
                    WHEN random_status = 'completed' THEN 100
                    WHEN random_status = 'in_progress' THEN floor(random() * 99)::smallint
                    ELSE 0
                END,
                sample_tags[floor(random() * 8 + 1)],
                CASE WHEN random() > 0.7 THEN 
                    jsonb_build_array(
                        jsonb_build_object('name', 'document.pdf', 'size', floor(random() * 1000000), 'url', 'https://files.example.com/doc' || j || '.pdf'),
                        jsonb_build_object('name', 'image.png', 'size', floor(random() * 500000), 'url', 'https://files.example.com/img' || j || '.png')
                    )
                ELSE '[]'::jsonb END,
                CASE WHEN random() > 0.6 THEN sample_checklist ELSE '[]'::jsonb END,
                jsonb_build_object(
                    'client', (ARRAY['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Corp', NULL])[floor(random() * 5 + 1)],
                    'project_code', CASE WHEN random() > 0.5 THEN 'PRJ-' || lpad((random() * 9999)::int::text, 4, '0') ELSE NULL END,
                    'billable', random() > 0.5,
                    'department', (ARRAY['Engineering', 'Marketing', 'Sales', 'Support', 'HR'])[floor(random() * 5 + 1)]
                ),
                '#' || lpad(to_hex(floor(random() * 16777215)::int), 6, '0'),
                j,
                random() > 0.8,
                CASE WHEN random() > 0.8 THEN (ARRAY['daily', 'weekly', 'monthly', 'yearly'])[floor(random() * 4 + 1)] ELSE NULL END,
                floor(random() * 10 + 1)::smallint,
                floor(random() * 1000)::int,
                CASE WHEN random() > 0.7 THEN (random() * 1000)::numeric::money ELSE NULL END,
                CASE WHEN random() > 0.9 THEN 37.7749 + (random() - 0.5) ELSE NULL END,
                CASE WHEN random() > 0.9 THEN -122.4194 + (random() - 0.5) ELSE NULL END,
                CASE WHEN random() > 0.7 THEN 
                    ARRAY[floor(random() * user_count + 1)::int, floor(random() * user_count + 1)::int]
                ELSE NULL END,
                CASE WHEN j > 5 AND random() > 0.8 THEN 
                    ARRAY[j - floor(random() * 5 + 1)::int, j - floor(random() * 5 + 1)::int]
                ELSE NULL END,
                CASE WHEN j > 10 AND random() > 0.9 THEN 
                    ARRAY[j - floor(random() * 10 + 1)::int]
                ELSE NULL END,
                ('192.168.' || floor(random() * 255) || '.' || floor(random() * 255))::inet,
                ('10.0.' || floor(random() * 255) || '.' || floor(random() * 255))::inet,
                CASE WHEN random() > 0.8 THEN 
                    tstzrange(CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ((random() * 365) || ' days')::interval)
                ELSE NULL END,
                CASE WHEN random_status IN ('in_progress', 'completed') THEN 
                    CURRENT_TIMESTAMP + ((random() * 5) || ' minutes')::interval
                ELSE NULL END,
                CASE WHEN random_status = 'completed' THEN 
                    CURRENT_TIMESTAMP + ((random() * 10) || ' minutes')::interval
                ELSE NULL END,
                CASE WHEN random() > 0.6 THEN 
                    CURRENT_TIMESTAMP + ((random() * 30) || ' days')::interval
                ELSE NULL END
            );
        END LOOP;
    END LOOP;

    -- Add todo categories relationships
    INSERT INTO todo_categories (todo_id, category_id)
    SELECT 
        t.id,
        c.id
    FROM todos t
    CROSS JOIN LATERAL (
        SELECT id 
        FROM categories 
        WHERE categories.user_id = t.user_id 
        ORDER BY random() 
        LIMIT floor(random() * 3 + 1)::int
    ) c;

    -- Add some comments
    INSERT INTO comments (todo_id, user_id, content, is_edited)
    SELECT 
        t.id,
        t.user_id,
        'Comment ' || row_number() OVER () || ': ' || (ARRAY[
            'Great progress on this!',
            'Need more information about requirements',
            'This is blocked by another task',
            'Updated the deadline',
            'Added new attachments',
            'Please review when you have time',
            'Marking as complete',
            'Moving to next sprint'
        ])[floor(random() * 8 + 1)],
        random() > 0.8
    FROM todos t
    WHERE random() > 0.7
    LIMIT 500;

    -- Add activity logs
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    SELECT 
        t.user_id,
        t.id,
        (ARRAY['created', 'updated', 'status_changed', 'priority_changed', 'assigned', 'commented'])[floor(random() * 6 + 1)],
        jsonb_build_object(
            'timestamp', CURRENT_TIMESTAMP - ((random() * 30) || ' days')::interval,
            'ip_address', ('192.168.' || floor(random() * 255) || '.' || floor(random() * 255))::text,
            'user_agent', 'Mozilla/5.0'
        )
    FROM todos t
    WHERE random() > 0.5
    LIMIT 1000;

    RAISE NOTICE 'Seeding completed: % users with their todos', user_count;
END $$;

-- Re-enable the trigger
ALTER TABLE todos ENABLE TRIGGER tr_refresh_mv_after_todo_change;

-- Refresh materialized views manually once after all data is inserted
REFRESH MATERIALIZED VIEW mv_user_activity_summary;
REFRESH MATERIALIZED VIEW mv_todo_analytics;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Materialized views refreshed successfully';
END $$;