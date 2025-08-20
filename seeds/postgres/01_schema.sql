-- PostgreSQL schema with comprehensive data types

-- Drop existing tables and types (if they exist)
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS todo_categories CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS todo_collaborators CASCADE;
DROP TABLE IF EXISTS related_todos CASCADE;
DROP TABLE IF EXISTS todos CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS todo_status CASCADE;
DROP TYPE IF EXISTS priority_level CASCADE;

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "hstore";

-- Custom enum type
CREATE TYPE todo_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled', 'archived');
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'critical');

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    bio TEXT,
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    phone VARCHAR(20),
    date_of_birth DATE,
    preferences JSONB DEFAULT '{}',
    metadata HSTORE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Todos table with comprehensive data types
CREATE TABLE todos (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status todo_status DEFAULT 'pending',
    priority priority_level DEFAULT 'medium',
    
    -- Various data types
    due_date DATE,
    due_time TIME,
    due_datetime TIMESTAMP WITH TIME ZONE,
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2),
    completion_percentage SMALLINT CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
    
    -- JSON types
    tags JSONB DEFAULT '[]',
    attachments JSONB DEFAULT '[]',
    checklist JSONB DEFAULT '[]',
    custom_fields JSONB DEFAULT '{}',
    
    -- Binary and special types
    thumbnail BYTEA,
    color_code CHAR(7),
    position INTEGER,
    is_recurring BOOLEAN DEFAULT false,
    recurrence_pattern VARCHAR(50),
    parent_todo_id INTEGER REFERENCES todos(id) ON DELETE SET NULL,
    
    -- Numeric types
    difficulty_level SMALLINT CHECK (difficulty_level >= 1 AND difficulty_level <= 10),
    reward_points INTEGER DEFAULT 0,
    cost MONEY,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    
    -- Array types
    collaborator_ids INTEGER[],
    related_todo_ids INTEGER[],
    blocked_by_ids INTEGER[],
    
    -- Full text search
    search_vector tsvector,
    
    -- IP and network types
    created_from_ip INET,
    last_modified_ip INET,
    
    -- Range types
    valid_during tstzrange,
    
    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reminder_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE
);

-- Categories table
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),
    icon VARCHAR(50),
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, user_id)
);

-- Todo categories junction table
CREATE TABLE todo_categories (
    todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, category_id)
);

-- Comments table
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Collaborators table
CREATE TABLE todo_collaborators (
    todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
    collaborator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (todo_id, collaborator_id)
);

-- Related todos table
CREATE TABLE related_todos (
    todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
    related_todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
    relation_type VARCHAR(20) DEFAULT 'related_to' CHECK(relation_type IN ('blocks', 'blocked_by', 'related_to', 'duplicate_of')),
    PRIMARY KEY (todo_id, related_todo_id)
);

-- Activity log table
CREATE TABLE activity_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_todos_user_id ON todos(user_id);
CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_priority ON todos(priority);
CREATE INDEX idx_todos_due_date ON todos(due_date);
CREATE INDEX idx_todos_search_vector ON todos USING GIN(search_vector);
CREATE INDEX idx_todos_tags ON todos USING GIN(tags);
CREATE INDEX idx_todos_custom_fields ON todos USING GIN(custom_fields);
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_todo_id ON activity_logs(todo_id);

-- Create trigger to update search vector
CREATE OR REPLACE FUNCTION update_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_todos_search_vector
    BEFORE INSERT OR UPDATE ON todos
    FOR EACH ROW
    EXECUTE FUNCTION update_search_vector();

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_todos_updated_at
    BEFORE UPDATE ON todos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

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
    ROUND(AVG(t.completion_percentage), 2) as avg_completion,
    u.created_at,
    u.last_login_at
FROM users u
LEFT JOIN todos t ON u.id = t.user_id
GROUP BY u.id, u.username, u.email, u.created_at, u.last_login_at;

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

-- Materialized Views
CREATE MATERIALIZED VIEW mv_user_activity_summary AS
SELECT 
    u.id as user_id,
    u.username,
    COUNT(DISTINCT t.id) as total_todos,
    COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) as completed_todos,
    COUNT(DISTINCT al.id) as total_activities,
    COUNT(DISTINCT cm.id) as total_comments,
    MAX(al.created_at) as last_activity,
    AVG(t.estimated_hours) as avg_estimated_hours,
    SUM(CASE WHEN t.status = 'completed' THEN t.actual_hours ELSE 0 END) as total_actual_hours,
    ARRAY_AGG(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) as categories_used
FROM users u
LEFT JOIN todos t ON u.id = t.user_id
LEFT JOIN activity_logs al ON u.id = al.user_id
LEFT JOIN comments cm ON u.id = cm.user_id
LEFT JOIN todo_categories tc ON t.id = tc.todo_id
LEFT JOIN categories c ON tc.category_id = c.id
GROUP BY u.id, u.username;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_user_activity_user_id ON mv_user_activity_summary(user_id);

CREATE MATERIALIZED VIEW mv_todo_analytics AS
SELECT 
    DATE_TRUNC('week', t.created_at) as week_start,
    COUNT(*) as todos_created,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as todos_completed,
    AVG(t.estimated_hours) as avg_estimated_hours,
    AVG(CASE WHEN t.status = 'completed' THEN t.actual_hours END) as avg_actual_hours,
    COUNT(DISTINCT t.user_id) as active_users
FROM todos t
GROUP BY DATE_TRUNC('week', t.created_at)
ORDER BY week_start;

-- Functions
CREATE OR REPLACE FUNCTION get_user_todo_stats(user_id_param INTEGER)
RETURNS TABLE (
    total_todos BIGINT,
    completed_todos BIGINT,
    pending_todos BIGINT,
    in_progress_todos BIGINT,
    overdue_todos BIGINT,
    completion_rate NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_todos,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_todos,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_todos,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_todos,
        COUNT(CASE WHEN due_date < CURRENT_DATE AND status != 'completed' THEN 1 END) as overdue_todos,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                ROUND((COUNT(CASE WHEN status = 'completed' THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
            ELSE 0 
        END as completion_rate
    FROM todos 
    WHERE user_id = user_id_param;
END;
$$;

CREATE OR REPLACE FUNCTION search_todos(search_term TEXT, user_id_param INTEGER DEFAULT NULL)
RETURNS TABLE (
    id INTEGER,
    title VARCHAR(500),
    description TEXT,
    status todo_status,
    priority priority_level,
    due_date DATE,
    username VARCHAR(50),
    rank REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        u.username,
        ts_rank(t.search_vector, plainto_tsquery('english', search_term)) as rank
    FROM todos t
    JOIN users u ON t.user_id = u.id
    WHERE 
        t.search_vector @@ plainto_tsquery('english', search_term)
        AND (user_id_param IS NULL OR t.user_id = user_id_param)
    ORDER BY rank DESC, t.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION calculate_todo_complexity(todo_id_param INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    complexity_score NUMERIC := 0;
    checklist_items INTEGER;
    attachment_count INTEGER;
    collaborator_count INTEGER;
    subtask_count INTEGER;
BEGIN
    -- Get todo details
    SELECT 
        jsonb_array_length(COALESCE(checklist, '[]')),
        jsonb_array_length(COALESCE(attachments, '[]')),
        (SELECT COUNT(*) FROM todo_collaborators WHERE todo_id = todo_id_param),
        (SELECT COUNT(*) FROM todos WHERE parent_todo_id = todo_id_param)
    INTO checklist_items, attachment_count, collaborator_count, subtask_count
    FROM todos WHERE id = todo_id_param;
    
    -- Calculate complexity score
    complexity_score := 
        COALESCE(checklist_items, 0) * 0.5 +
        COALESCE(attachment_count, 0) * 0.3 +
        COALESCE(collaborator_count, 0) * 0.7 +
        COALESCE(subtask_count, 0) * 1.2;
    
    RETURN ROUND(complexity_score, 2);
END;
$$;

-- Stored Procedures
CREATE OR REPLACE PROCEDURE complete_todo(todo_id_param INTEGER, actual_hours_param NUMERIC DEFAULT NULL)
LANGUAGE plpgsql
AS $$
DECLARE
    todo_exists BOOLEAN;
    user_id_val INTEGER;
BEGIN
    -- Check if todo exists and get user_id
    SELECT EXISTS(SELECT 1 FROM todos WHERE id = todo_id_param), user_id
    INTO todo_exists, user_id_val
    FROM todos WHERE id = todo_id_param;
    
    IF NOT todo_exists THEN
        RAISE EXCEPTION 'Todo with id % does not exist', todo_id_param;
    END IF;
    
    -- Update todo
    UPDATE todos 
    SET 
        status = 'completed',
        completion_percentage = 100,
        completed_at = CURRENT_TIMESTAMP,
        actual_hours = COALESCE(actual_hours_param, actual_hours)
    WHERE id = todo_id_param;
    
    -- Log activity
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    VALUES (
        user_id_val,
        todo_id_param,
        'completed',
        jsonb_build_object(
            'completed_at', CURRENT_TIMESTAMP,
            'actual_hours', COALESCE(actual_hours_param, 0)
        )
    );
    
    COMMIT;
END;
$$;

CREATE OR REPLACE PROCEDURE bulk_update_todo_status(
    todo_ids INTEGER[],
    new_status todo_status,
    user_id_param INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    todo_id INTEGER;
    affected_count INTEGER := 0;
BEGIN
    -- Update all todos in the array
    FOREACH todo_id IN ARRAY todo_ids
    LOOP
        UPDATE todos 
        SET status = new_status, updated_at = CURRENT_TIMESTAMP
        WHERE id = todo_id AND user_id = user_id_param;
        
        IF FOUND THEN
            affected_count := affected_count + 1;
            
            -- Log activity
            INSERT INTO activity_logs (user_id, todo_id, action, details)
            VALUES (
                user_id_param,
                todo_id,
                'status_changed',
                jsonb_build_object('new_status', new_status, 'changed_at', CURRENT_TIMESTAMP)
            );
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Updated % todos to status %', affected_count, new_status;
    COMMIT;
END;
$$;

-- Additional trigger for materialized view refresh
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Refresh materialized views when todos are modified
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_activity_summary;
    REFRESH MATERIALIZED VIEW mv_todo_analytics;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tr_refresh_mv_after_todo_change
    AFTER INSERT OR UPDATE OR DELETE ON todos
    FOR EACH STATEMENT
    EXECUTE FUNCTION refresh_materialized_views();

-- ============================================================================
-- BUSINESS LOGIC TRIGGERS
-- ============================================================================

-- Trigger function for logging todo creation
CREATE OR REPLACE FUNCTION log_todo_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    VALUES (
        NEW.user_id,
        NEW.id,
        'created',
        jsonb_build_object(
            'title', NEW.title,
            'priority', NEW.priority,
            'created_at', NEW.created_at
        )
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_log_todo_creation
    AFTER INSERT ON todos
    FOR EACH ROW
    EXECUTE FUNCTION log_todo_creation();

-- Trigger function for logging status changes
CREATE OR REPLACE FUNCTION log_todo_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO activity_logs (user_id, todo_id, action, details)
        VALUES (
            NEW.user_id,
            NEW.id,
            'status_changed',
            jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'changed_at', CURRENT_TIMESTAMP
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_log_todo_status_change
    AFTER UPDATE OF status ON todos
    FOR EACH ROW
    EXECUTE FUNCTION log_todo_status_change();

-- Trigger function for auto-completion and logging
CREATE OR REPLACE FUNCTION handle_todo_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Auto-complete when percentage reaches 100
    IF NEW.completion_percentage = 100 AND OLD.completion_percentage != 100 THEN
        NEW.status := 'completed';
        NEW.completed_at := CURRENT_TIMESTAMP;
        
        -- Log completion
        INSERT INTO activity_logs (user_id, todo_id, action, details)
        VALUES (
            NEW.user_id,
            NEW.id,
            'completed',
            jsonb_build_object(
                'completed_at', CURRENT_TIMESTAMP,
                'actual_hours', COALESCE(NEW.actual_hours, 0)
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_handle_todo_completion
    BEFORE UPDATE OF completion_percentage ON todos
    FOR EACH ROW
    EXECUTE FUNCTION handle_todo_completion();

-- Trigger function for logging priority changes
CREATE OR REPLACE FUNCTION log_todo_priority_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.priority != NEW.priority THEN
        INSERT INTO activity_logs (user_id, todo_id, action, details)
        VALUES (
            NEW.user_id,
            NEW.id,
            'priority_changed',
            jsonb_build_object(
                'old_priority', OLD.priority,
                'new_priority', NEW.priority,
                'changed_at', CURRENT_TIMESTAMP
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_log_todo_priority_change
    AFTER UPDATE OF priority ON todos
    FOR EACH ROW
    EXECUTE FUNCTION log_todo_priority_change();

-- Trigger function to prevent self-referencing related todos
CREATE OR REPLACE FUNCTION prevent_self_reference_related_todos()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.todo_id = NEW.related_todo_id THEN
        RAISE EXCEPTION 'Todo cannot be related to itself';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_prevent_self_reference_related_todos
    BEFORE INSERT OR UPDATE ON related_todos
    FOR EACH ROW
    EXECUTE FUNCTION prevent_self_reference_related_todos();

-- Trigger function for JSONB validation
CREATE OR REPLACE FUNCTION validate_todo_jsonb_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Validate that JSONB fields contain valid JSON
    BEGIN
        -- Test tags field
        IF NEW.tags IS NOT NULL THEN
            PERFORM NEW.tags::jsonb;
        END IF;
        
        -- Test attachments field
        IF NEW.attachments IS NOT NULL THEN
            PERFORM NEW.attachments::jsonb;
        END IF;
        
        -- Test checklist field
        IF NEW.checklist IS NOT NULL THEN
            PERFORM NEW.checklist::jsonb;
        END IF;
        
        -- Test custom_fields field
        IF NEW.custom_fields IS NOT NULL THEN
            PERFORM NEW.custom_fields::jsonb;
        END IF;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'Invalid JSON in JSONB field';
    END;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_validate_todo_jsonb_fields
    BEFORE INSERT OR UPDATE ON todos
    FOR EACH ROW
    EXECUTE FUNCTION validate_todo_jsonb_fields();

-- Trigger function for logging user updates
CREATE OR REPLACE FUNCTION log_user_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Log significant user profile changes
    IF OLD.email != NEW.email OR OLD.username != NEW.username OR OLD.is_active != NEW.is_active THEN
        INSERT INTO activity_logs (user_id, todo_id, action, details)
        VALUES (
            NEW.id,
            NULL,  -- No specific todo
            'profile_updated',
            jsonb_build_object(
                'changed_fields', jsonb_build_array(
                    CASE WHEN OLD.email != NEW.email THEN 'email' END,
                    CASE WHEN OLD.username != NEW.username THEN 'username' END,
                    CASE WHEN OLD.is_active != NEW.is_active THEN 'is_active' END
                ) - NULL,  -- Remove NULL values
                'updated_at', CURRENT_TIMESTAMP
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_log_user_updates
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION log_user_updates();

-- Trigger function for logging comment creation
CREATE OR REPLACE FUNCTION log_comment_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    VALUES (
        NEW.user_id,
        NEW.todo_id,
        'commented',
        jsonb_build_object(
            'comment_id', NEW.id,
            'content_length', char_length(NEW.content),
            'created_at', NEW.created_at
        )
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_log_comment_creation
    AFTER INSERT ON comments
    FOR EACH ROW
    EXECUTE FUNCTION log_comment_creation();

-- Trigger function for validating date constraints
CREATE OR REPLACE FUNCTION validate_todo_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Ensure due_date is not in the past for new todos
    IF TG_OP = 'INSERT' AND NEW.due_date IS NOT NULL AND NEW.due_date < CURRENT_DATE THEN
        RAISE WARNING 'Due date % is in the past', NEW.due_date;
    END IF;
    
    -- Ensure completed_at is not before created_at
    IF NEW.completed_at IS NOT NULL AND NEW.completed_at < NEW.created_at THEN
        RAISE EXCEPTION 'Completed date cannot be before created date';
    END IF;
    
    -- Ensure started_at is not before created_at
    IF NEW.started_at IS NOT NULL AND NEW.started_at < NEW.created_at THEN
        RAISE EXCEPTION 'Started date cannot be before created date';
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_validate_todo_dates
    BEFORE INSERT OR UPDATE ON todos
    FOR EACH ROW
    EXECUTE FUNCTION validate_todo_dates();

-- Trigger function for automatic status updates based on dates
CREATE OR REPLACE FUNCTION auto_update_todo_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Auto-set status to 'in_progress' when started_at is set
    IF OLD.started_at IS NULL AND NEW.started_at IS NOT NULL AND NEW.status = 'pending' THEN
        NEW.status := 'in_progress';
    END IF;
    
    -- Auto-archive very old completed todos (older than 1 year)
    IF NEW.status = 'completed' 
       AND NEW.completed_at IS NOT NULL 
       AND NEW.completed_at < CURRENT_TIMESTAMP - INTERVAL '1 year'
       AND NEW.status != 'archived' THEN
        NEW.status := 'archived';
        NEW.archived_at := CURRENT_TIMESTAMP;
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_auto_update_todo_status
    BEFORE UPDATE ON todos
    FOR EACH ROW
    EXECUTE FUNCTION auto_update_todo_status();

-- Trigger function for maintaining todo position sequence
CREATE OR REPLACE FUNCTION maintain_todo_position()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Auto-assign position if not provided
    IF TG_OP = 'INSERT' AND NEW.position IS NULL THEN
        SELECT COALESCE(MAX(position), 0) + 1 
        INTO NEW.position 
        FROM todos 
        WHERE user_id = NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_maintain_todo_position
    BEFORE INSERT ON todos
    FOR EACH ROW
    EXECUTE FUNCTION maintain_todo_position();