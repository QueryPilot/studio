-- Simplified PostgreSQL seed data
-- Insert users first
INSERT INTO users (
    username, email, full_name, avatar_url, bio, is_active, 
    email_verified, phone, date_of_birth, preferences, metadata,
    last_login_at
) 
SELECT 
    'user_' || i,
    'user' || i || '@example.com',
    'User ' || i || ' Smith',
    'https://avatar.example.com/user' || i || '.jpg',
    'Bio for user ' || i,
    true,
    random() > 0.3,
    '+1555' || lpad((random() * 9999999)::int::text, 7, '0'),
    CURRENT_DATE - ((random() * 365 * 30) || ' days')::interval,
    jsonb_build_object(
        'theme', CASE WHEN random() > 0.5 THEN 'dark' ELSE 'light' END,
        'notifications', random() > 0.3,
        'language', 'en'
    ),
    hstore(ARRAY[
        ['subscription', 'free'],
        ['referral_source', 'direct']
    ]),
    CURRENT_TIMESTAMP - ((random() * 30) || ' days')::interval
FROM generate_series(1, 100) AS i;

-- Insert categories for each user
INSERT INTO categories (name, color, icon, user_id)
SELECT 
    category_name,
    color_code,
    icon_name,
    u.id
FROM users u,
(VALUES 
    ('Work', '#FF5733', 'briefcase'),
    ('Personal', '#33FF57', 'home'),
    ('Shopping', '#3357FF', 'cart'),
    ('Health', '#FF33F5', 'heart'),
    ('Learning', '#F5FF33', 'book')
) AS cat(category_name, color_code, icon_name);

-- Insert todos for each user (simplified data)
INSERT INTO todos (
    user_id, title, description, status, priority,
    due_date, estimated_hours, actual_hours,
    completion_percentage, tags, color_code, position,
    difficulty_level, reward_points, created_at
)
SELECT 
    u.id,
    'Task ' || t.task_num || ' for user ' || u.id,
    'Description for task ' || t.task_num,
    (ARRAY['pending'::todo_status, 'in_progress'::todo_status, 'completed'::todo_status, 'cancelled'::todo_status, 'archived'::todo_status])[floor(random() * 5 + 1)],
    (ARRAY['low'::priority_level, 'medium'::priority_level, 'high'::priority_level, 'critical'::priority_level])[floor(random() * 4 + 1)],
    CURRENT_DATE + ((random() * 365 - 180) || ' days')::interval,
    (random() * 20 + 0.5)::numeric(5,2),
    CASE WHEN random() > 0.5 THEN (random() * 20 + 0.5)::numeric(5,2) ELSE NULL END,
    floor(random() * 101)::smallint,
    '["work", "project"]'::jsonb,
    '#' || lpad(to_hex(floor(random() * 16777215)::int), 6, '0'),
    t.task_num,
    floor(random() * 10 + 1)::smallint,
    floor(random() * 1000)::int,
    CURRENT_TIMESTAMP - ((random() * 30) || ' days')::interval
FROM users u,
generate_series(1, 50) AS t(task_num); -- 50 todos per user

-- Add some comments
INSERT INTO comments (todo_id, user_id, content)
SELECT 
    t.id,
    t.user_id,
    'Sample comment for todo ' || t.id
FROM todos t
WHERE random() > 0.8; -- Random 20% of todos get comments

-- Add activity logs
INSERT INTO activity_logs (user_id, todo_id, action, details)
SELECT 
    t.user_id,
    t.id,
    'created',
    jsonb_build_object(
        'title', t.title,
        'priority', t.priority,
        'created_at', t.created_at
    )
FROM todos t
WHERE random() > 0.7; -- Random 30% get activity logs

-- Final count
SELECT 
    (SELECT COUNT(*) FROM users) AS users_count,
    (SELECT COUNT(*) FROM todos) AS todos_count,
    (SELECT COUNT(*) FROM comments) AS comments_count,
    (SELECT COUNT(*) FROM activity_logs) AS activity_logs_count;