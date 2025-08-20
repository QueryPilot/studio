-- Simplified Oracle schema that works better with SQL*Plus
-- Basic table creation without complex PL/SQL

-- Drop existing objects if they exist
DECLARE
    v_sql VARCHAR2(2000);
BEGIN
    FOR i IN (SELECT table_name FROM user_tables) LOOP
        v_sql := 'DROP TABLE ' || i.table_name || ' CASCADE CONSTRAINTS';
        EXECUTE IMMEDIATE v_sql;
    END LOOP;
    FOR i IN (SELECT sequence_name FROM user_sequences) LOOP
        v_sql := 'DROP SEQUENCE ' || i.sequence_name;
        EXECUTE IMMEDIATE v_sql;
    END LOOP;
END;
/

-- Create sequences
CREATE SEQUENCE users_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE todos_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE categories_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE comments_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE activity_logs_seq START WITH 1 INCREMENT BY 1;

-- Users table
CREATE TABLE users (
    id NUMBER PRIMARY KEY,
    uuid RAW(16) DEFAULT SYS_GUID() NOT NULL UNIQUE,
    username VARCHAR2(50) UNIQUE NOT NULL,
    email VARCHAR2(255) UNIQUE NOT NULL,
    full_name VARCHAR2(255),
    avatar_url VARCHAR2(4000),
    bio CLOB,
    is_active NUMBER(1) DEFAULT 1,
    email_verified NUMBER(1) DEFAULT 0,
    phone VARCHAR2(20),
    date_of_birth DATE,
    preferences CLOB DEFAULT '{}',
    metadata CLOB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Todos table
CREATE TABLE todos (
    id NUMBER PRIMARY KEY,
    uuid RAW(16) DEFAULT SYS_GUID() NOT NULL UNIQUE,
    user_id NUMBER NOT NULL,
    title VARCHAR2(500) NOT NULL,
    description CLOB,
    status VARCHAR2(20) DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled', 'archived')),
    priority VARCHAR2(20) DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    due_date DATE,
    due_time TIMESTAMP,
    due_datetime TIMESTAMP WITH TIME ZONE,
    estimated_hours NUMBER(5,2),
    actual_hours NUMBER(5,2),
    completion_percentage NUMBER(3) CHECK(completion_percentage >= 0 AND completion_percentage <= 100),
    tags CLOB DEFAULT '[]',
    attachments CLOB DEFAULT '[]',
    checklist CLOB DEFAULT '[]',
    custom_fields CLOB DEFAULT '{}',
    thumbnail BLOB,
    color_code CHAR(7),
    position NUMBER,
    is_recurring NUMBER(1) DEFAULT 0,
    recurrence_pattern VARCHAR2(50),
    parent_todo_id NUMBER,
    difficulty_level NUMBER(2) CHECK(difficulty_level >= 1 AND difficulty_level <= 10),
    reward_points NUMBER DEFAULT 0,
    cost NUMBER(10,2),
    latitude BINARY_DOUBLE,
    longitude BINARY_DOUBLE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    reminder_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_todo_id) REFERENCES todos(id)
);

-- Other tables
CREATE TABLE categories (
    id NUMBER PRIMARY KEY,
    name VARCHAR2(100) NOT NULL,
    color VARCHAR2(7),
    icon VARCHAR2(50),
    user_id NUMBER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(name, user_id)
);

CREATE TABLE todo_categories (
    todo_id NUMBER,
    category_id NUMBER,
    PRIMARY KEY (todo_id, category_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE comments (
    id NUMBER PRIMARY KEY,
    todo_id NUMBER,
    user_id NUMBER,
    content CLOB NOT NULL,
    is_edited NUMBER(1) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE activity_logs (
    id NUMBER PRIMARY KEY,
    user_id NUMBER,
    todo_id NUMBER,
    action VARCHAR2(50) NOT NULL,
    details CLOB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
);

CREATE TABLE todo_collaborators (
    todo_id NUMBER,
    collaborator_id NUMBER,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    PRIMARY KEY (todo_id, collaborator_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (collaborator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE related_todos (
    todo_id NUMBER,
    related_todo_id NUMBER,
    relation_type VARCHAR2(20) DEFAULT 'related_to' CHECK(relation_type IN ('blocks', 'blocked_by', 'related_to', 'duplicate_of')),
    PRIMARY KEY (todo_id, related_todo_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (related_todo_id) REFERENCES todos(id) ON DELETE CASCADE
);

-- Basic triggers for auto-incrementing IDs
CREATE OR REPLACE TRIGGER users_id_trigger
    BEFORE INSERT ON users
    FOR EACH ROW
BEGIN
    IF :new.id IS NULL THEN
        :new.id := users_seq.NEXTVAL;
    END IF;
END;
/

CREATE OR REPLACE TRIGGER todos_id_trigger
    BEFORE INSERT ON todos
    FOR EACH ROW
BEGIN
    IF :new.id IS NULL THEN
        :new.id := todos_seq.NEXTVAL;
    END IF;
END;
/

CREATE OR REPLACE TRIGGER categories_id_trigger
    BEFORE INSERT ON categories
    FOR EACH ROW
BEGIN
    IF :new.id IS NULL THEN
        :new.id := categories_seq.NEXTVAL;
    END IF;
END;
/

CREATE OR REPLACE TRIGGER comments_id_trigger
    BEFORE INSERT ON comments
    FOR EACH ROW
BEGIN
    IF :new.id IS NULL THEN
        :new.id := comments_seq.NEXTVAL;
    END IF;
END;
/

CREATE OR REPLACE TRIGGER activity_logs_id_trigger
    BEFORE INSERT ON activity_logs
    FOR EACH ROW
BEGIN
    IF :new.id IS NULL THEN
        :new.id := activity_logs_seq.NEXTVAL;
    END IF;
END;
/

-- Create indexes
CREATE INDEX idx_todos_user_id ON todos(user_id);
CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_priority ON todos(priority);
CREATE INDEX idx_todos_due_date ON todos(due_date);
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_todo_id ON activity_logs(todo_id);
CREATE INDEX idx_comments_todo_id ON comments(todo_id);

-- Basic views
CREATE OR REPLACE VIEW user_stats AS
SELECT 
    u.id,
    u.username,
    u.email,
    COUNT(t.id) as total_todos,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_todos,
    COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_todos,
    COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress_todos,
    ROUND(AVG(t.completion_percentage), 2) as avg_completion,
    u.created_at,
    u.last_login_at
FROM users u
LEFT JOIN todos t ON u.id = t.user_id
GROUP BY u.id, u.username, u.email, u.created_at, u.last_login_at;

COMMIT;