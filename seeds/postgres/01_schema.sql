-- Partitioning Strategy:
-- 1. todos: List Partitioning by 'status' (Active vs. Done)
-- 2. activity_logs: Range Partitioning by 'created_at' (Yearly)

-- ==========================================
-- 1. CLEANUP
-- ==========================================
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS todo_categories CASCADE;
DROP TABLE IF EXISTS todo_collaborators CASCADE;
DROP TABLE IF EXISTS related_todos CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS todos CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS todo_status CASCADE;
DROP TYPE IF EXISTS priority_level CASCADE; -- In case it existed

-- ==========================================
-- 2. ENUMS & USERS
-- ==========================================
CREATE TYPE todo_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled', 'archived');
CREATE EXTENSION IF NOT EXISTS hstore; -- Required for metadata

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    avatar_url VARCHAR(255),
    bio TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    phone VARCHAR(20),
    date_of_birth DATE,
    preferences JSONB DEFAULT '{}',
    metadata HSTORE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7),
    icon VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, user_id)
);

-- ==========================================
-- 3. TODOS TABLE (Partitioned by List)
-- ==========================================
CREATE TABLE todos (
    id SERIAL,
    uuid UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id), -- FK to users is fine (users is standard table)
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status todo_status NOT NULL DEFAULT 'pending',
    priority INTEGER DEFAULT 3,
    due_date TIMESTAMP WITH TIME ZONE,
    
    -- Extended fields
    due_time TIME WITHOUT TIME ZONE,
    due_datetime TIMESTAMP WITH TIME ZONE,
    estimated_hours NUMERIC(5,2),
    actual_hours NUMERIC(5,2),
    completion_percentage SMALLINT DEFAULT 0,
    tags JSONB DEFAULT '[]',
    attachments JSONB DEFAULT '[]',
    checklist JSONB DEFAULT '[]',
    custom_fields JSONB DEFAULT '{}',
    color_code VARCHAR(7),
    position INTEGER,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern VARCHAR(50),
    difficulty_level SMALLINT,
    reward_points INTEGER,
    cost MONEY,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    collaborator_ids INTEGER[],
    related_todo_ids INTEGER[],
    blocked_by_ids INTEGER[],
    created_from_ip INET,
    last_modified_ip INET,
    valid_during TSTZRANGE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    reminder_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- PK must include the partition key (status)
    PRIMARY KEY (id, status)
) PARTITION BY LIST (status);

-- Create Partitions
CREATE TABLE todos_active PARTITION OF todos 
    FOR VALUES IN ('pending', 'in_progress');

CREATE TABLE todos_done PARTITION OF todos 
    FOR VALUES IN ('completed', 'cancelled', 'archived');

-- Indexes
CREATE INDEX idx_todos_user_id ON todos(user_id);
CREATE INDEX idx_todos_created_at ON todos(created_at);

-- ==========================================
-- 4. RELATED TABLES (No FKs to todos)
-- ==========================================
-- Since 'todos' is partitioned with (id, status) PK, we can't easily have a FK just on 'id'.
-- We will omit FK constraints to 'todos' for these child tables to simplify.

CREATE TABLE todo_categories (
    todo_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, category_id)
);

CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    todo_id INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE todo_collaborators (
    todo_id INTEGER NOT NULL,
    collaborator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, collaborator_id)
);

CREATE TABLE related_todos (
    todo_id INTEGER NOT NULL,
    related_todo_id INTEGER NOT NULL,
    relation_type VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (todo_id, related_todo_id)
);

-- ==========================================
-- 5. ACTIVITY LOGS TABLE (Partitioned by Range)
-- ==========================================
CREATE TABLE activity_logs (
    id BIGSERIAL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    todo_id INTEGER,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- PK must include partition key (created_at)
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create Partitions (Yearly)
CREATE TABLE logs_old PARTITION OF activity_logs 
    FOR VALUES FROM (MINVALUE) TO ('2023-01-01');

CREATE TABLE logs_2023 PARTITION OF activity_logs 
    FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');

CREATE TABLE logs_2024 PARTITION OF activity_logs 
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE logs_2025 PARTITION OF activity_logs 
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE logs_future PARTITION OF activity_logs 
    FOR VALUES FROM ('2026-01-01') TO (MAXVALUE);

-- Indexes
CREATE INDEX idx_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_logs_action ON activity_logs(action);

-- ==========================================
-- 6. TRIGGERS
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_todos_updated_at
    BEFORE UPDATE ON todos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
