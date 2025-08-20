-- Oracle schema with comprehensive data types
-- Run as todoapp user

-- Drop existing objects if they exist
BEGIN
    FOR i IN (SELECT table_name FROM user_tables) LOOP
        EXECUTE IMMEDIATE 'DROP TABLE ' || i.table_name || ' CASCADE CONSTRAINTS';
    END LOOP;
    FOR i IN (SELECT sequence_name FROM user_sequences) LOOP
        EXECUTE IMMEDIATE 'DROP SEQUENCE ' || i.sequence_name;
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
    preferences CLOB DEFAULT '{}' CHECK (preferences IS JSON),
    metadata CLOB CHECK (metadata IS JSON),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Todos table with comprehensive data types
CREATE TABLE todos (
    id NUMBER PRIMARY KEY,
    uuid RAW(16) DEFAULT SYS_GUID() NOT NULL UNIQUE,
    user_id NUMBER NOT NULL,
    title VARCHAR2(500) NOT NULL,
    description CLOB,
    status VARCHAR2(20) DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled', 'archived')),
    priority VARCHAR2(20) DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    
    -- Various data types
    due_date DATE,
    due_time TIMESTAMP,
    due_datetime TIMESTAMP WITH TIME ZONE,
    estimated_hours NUMBER(5,2),
    actual_hours NUMBER(5,2),
    completion_percentage NUMBER(3) CHECK(completion_percentage >= 0 AND completion_percentage <= 100),
    
    -- JSON stored as CLOB
    tags CLOB DEFAULT '[]' CHECK (tags IS JSON),
    attachments CLOB DEFAULT '[]' CHECK (attachments IS JSON),
    checklist CLOB DEFAULT '[]' CHECK (checklist IS JSON),
    custom_fields CLOB DEFAULT '{}' CHECK (custom_fields IS JSON),
    
    -- Binary and special types
    thumbnail BLOB,
    color_code CHAR(7),
    position NUMBER,
    is_recurring NUMBER(1) DEFAULT 0,
    recurrence_pattern VARCHAR2(50),
    parent_todo_id NUMBER,
    
    -- Numeric types
    difficulty_level NUMBER(2) CHECK(difficulty_level >= 1 AND difficulty_level <= 10),
    reward_points NUMBER DEFAULT 0,
    cost NUMBER(10,2),
    latitude BINARY_DOUBLE,
    longitude BINARY_DOUBLE,
    
    -- Oracle-specific types
    short_code VARCHAR2(20),
    long_description CLOB,
    notes CLOB,
    xml_data XMLTYPE,
    
    -- Interval types
    interval_ds INTERVAL DAY TO SECOND,
    year_month_interval INTERVAL YEAR TO MONTH,
    raw_data RAW(2000),
    
    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    reminder_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_todo_id) REFERENCES todos(id)
);

-- Categories table
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

-- Todo categories junction table
CREATE TABLE todo_categories (
    todo_id NUMBER,
    category_id NUMBER,
    PRIMARY KEY (todo_id, category_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Comments table
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

-- Activity log table
CREATE TABLE activity_logs (
    id NUMBER PRIMARY KEY,
    user_id NUMBER,
    todo_id NUMBER,
    action VARCHAR2(50) NOT NULL,
    details CLOB CHECK (details IS JSON),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
);

-- Collaborators table
CREATE TABLE todo_collaborators (
    todo_id NUMBER,
    collaborator_id NUMBER,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    PRIMARY KEY (todo_id, collaborator_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (collaborator_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Related todos table
CREATE TABLE related_todos (
    todo_id NUMBER,
    related_todo_id NUMBER,
    relation_type VARCHAR2(20) DEFAULT 'related_to' CHECK(relation_type IN ('blocks', 'blocked_by', 'related_to', 'duplicate_of')),
    PRIMARY KEY (todo_id, related_todo_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (related_todo_id) REFERENCES todos(id) ON DELETE CASCADE
);

-- Triggers for auto-incrementing IDs
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

-- ============================================================================
-- ADVANCED DATABASE OBJECTS
-- ============================================================================

-- Views
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

CREATE OR REPLACE VIEW todo_summary AS
SELECT 
    t.id,
    t.title,
    t.status,
    t.priority,
    t.due_date,
    t.completion_percentage,
    u.username as owner,
    LISTAGG(c.name, ', ') WITHIN GROUP (ORDER BY c.name) as categories,
    COUNT(DISTINCT cm.id) as comment_count,
    COUNT(DISTINCT tc.collaborator_id) as collaborator_count
FROM todos t
JOIN users u ON t.user_id = u.id
LEFT JOIN todo_categories tc_cat ON t.id = tc_cat.todo_id
LEFT JOIN categories c ON tc_cat.category_id = c.id
LEFT JOIN comments cm ON t.id = cm.todo_id
LEFT JOIN todo_collaborators tc ON t.id = tc.todo_id
GROUP BY t.id, t.title, t.status, t.priority, t.due_date, t.completion_percentage, u.username;

CREATE OR REPLACE VIEW overdue_todos AS
SELECT 
    t.*,
    u.username,
    u.email,
    TRUNC(SYSDATE) - t.due_date as days_overdue
FROM todos t
JOIN users u ON t.user_id = u.id
WHERE t.due_date < TRUNC(SYSDATE) 
    AND t.status NOT IN ('completed', 'cancelled', 'archived');

CREATE OR REPLACE VIEW todo_analytics AS
SELECT 
    TRUNC(t.created_at, 'IW') as week_start,
    COUNT(*) as todos_created,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as todos_completed,
    AVG(t.estimated_hours) as avg_estimated_hours,
    AVG(CASE WHEN t.status = 'completed' THEN t.actual_hours END) as avg_actual_hours,
    COUNT(DISTINCT t.user_id) as active_users
FROM todos t
GROUP BY TRUNC(t.created_at, 'IW')
ORDER BY week_start;

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
    SUM(CASE WHEN t.status = 'completed' THEN NVL(t.actual_hours, 0) ELSE 0 END) as total_actual_hours
FROM users u
LEFT JOIN todos t ON u.id = t.user_id
LEFT JOIN activity_logs al ON u.id = al.user_id
LEFT JOIN comments cm ON u.id = cm.user_id
GROUP BY u.id, u.username;

-- Oracle Package for Todo Management
CREATE OR REPLACE PACKAGE todo_management AS
    -- Type definitions
    TYPE todo_stats_rec IS RECORD (
        total_todos NUMBER,
        completed_todos NUMBER,
        pending_todos NUMBER,
        in_progress_todos NUMBER,
        overdue_todos NUMBER,
        completion_rate NUMBER
    );
    
    -- Public procedures and functions
    FUNCTION get_user_completion_rate(p_user_id NUMBER) RETURN NUMBER;
    FUNCTION calculate_todo_score(p_todo_id NUMBER) RETURN NUMBER;
    FUNCTION get_user_todo_stats(p_user_id NUMBER) RETURN todo_stats_rec;
    FUNCTION parse_json_value(p_json_clob CLOB, p_key VARCHAR2) RETURN VARCHAR2;
    
    PROCEDURE complete_todo(p_todo_id NUMBER, p_actual_hours NUMBER DEFAULT NULL);
    PROCEDURE bulk_update_status(p_todo_ids VARCHAR2, p_new_status VARCHAR2, p_user_id NUMBER);
    PROCEDURE generate_user_report(p_user_id NUMBER);
    PROCEDURE refresh_materialized_views;
    
    -- Exceptions
    todo_not_found EXCEPTION;
    invalid_status EXCEPTION;
    invalid_user EXCEPTION;
    
    PRAGMA EXCEPTION_INIT(todo_not_found, -20001);
    PRAGMA EXCEPTION_INIT(invalid_status, -20002);
    PRAGMA EXCEPTION_INIT(invalid_user, -20003);
END todo_management;
/

CREATE OR REPLACE PACKAGE BODY todo_management AS

    FUNCTION get_user_completion_rate(p_user_id NUMBER) RETURN NUMBER IS
        v_total_count NUMBER := 0;
        v_completed_count NUMBER := 0;
        v_completion_rate NUMBER := 0;
    BEGIN
        SELECT COUNT(*) INTO v_total_count 
        FROM todos WHERE user_id = p_user_id;
        
        SELECT COUNT(*) INTO v_completed_count 
        FROM todos WHERE user_id = p_user_id AND status = 'completed';
        
        IF v_total_count > 0 THEN
            v_completion_rate := (v_completed_count / v_total_count) * 100;
        END IF;
        
        RETURN ROUND(v_completion_rate, 2);
    END get_user_completion_rate;

    FUNCTION calculate_todo_score(p_todo_id NUMBER) RETURN NUMBER IS
        v_score NUMBER := 0;
        v_priority_weight NUMBER;
        v_completion_weight NUMBER;
        v_urgency_weight NUMBER;
        v_todo_priority VARCHAR2(20);
        v_todo_completion NUMBER;
        v_todo_due_date DATE;
    BEGIN
        -- Get todo details
        SELECT priority, completion_percentage, due_date
        INTO v_todo_priority, v_todo_completion, v_todo_due_date
        FROM todos WHERE id = p_todo_id;
        
        -- Priority weight
        v_priority_weight := CASE v_todo_priority
            WHEN 'critical' THEN 4.0
            WHEN 'high' THEN 3.0
            WHEN 'medium' THEN 2.0
            WHEN 'low' THEN 1.0
            ELSE 1.0
        END;
        
        -- Completion weight
        v_completion_weight := NVL(v_todo_completion, 0) / 100.0;
        
        -- Urgency weight (based on due date)
        IF v_todo_due_date IS NOT NULL THEN
            v_urgency_weight := CASE 
                WHEN v_todo_due_date < TRUNC(SYSDATE) THEN 2.0  -- Overdue
                WHEN v_todo_due_date <= TRUNC(SYSDATE) + 3 THEN 1.5  -- Due soon
                ELSE 1.0
            END;
        ELSE
            v_urgency_weight := 1.0;
        END IF;
        
        -- Calculate final score
        v_score := (v_priority_weight * 25) + (v_completion_weight * 50) + (v_urgency_weight * 25);
        
        RETURN ROUND(v_score, 2);
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20001, 'Todo not found with id: ' || p_todo_id);
    END calculate_todo_score;

    FUNCTION get_user_todo_stats(p_user_id NUMBER) RETURN todo_stats_rec IS
        v_stats todo_stats_rec;
    BEGIN
        SELECT 
            COUNT(*),
            COUNT(CASE WHEN status = 'completed' THEN 1 END),
            COUNT(CASE WHEN status = 'pending' THEN 1 END),
            COUNT(CASE WHEN status = 'in_progress' THEN 1 END),
            COUNT(CASE WHEN due_date < TRUNC(SYSDATE) AND status != 'completed' THEN 1 END),
            CASE 
                WHEN COUNT(*) > 0 THEN 
                    ROUND((COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*)) * 100, 2)
                ELSE 0 
            END
        INTO v_stats.total_todos, v_stats.completed_todos, v_stats.pending_todos,
             v_stats.in_progress_todos, v_stats.overdue_todos, v_stats.completion_rate
        FROM todos 
        WHERE user_id = p_user_id;
        
        RETURN v_stats;
    END get_user_todo_stats;

    FUNCTION parse_json_value(p_json_clob CLOB, p_key VARCHAR2) RETURN VARCHAR2 IS
        v_result VARCHAR2(4000);
        v_start_pos NUMBER;
        v_end_pos NUMBER;
        v_key_pattern VARCHAR2(100);
    BEGIN
        -- Simple JSON parsing for key-value extraction
        v_key_pattern := '"' || p_key || '":"';
        v_start_pos := INSTR(p_json_clob, v_key_pattern);
        
        IF v_start_pos > 0 THEN
            v_start_pos := v_start_pos + LENGTH(v_key_pattern);
            v_end_pos := INSTR(p_json_clob, '"', v_start_pos);
            IF v_end_pos > v_start_pos THEN
                v_result := SUBSTR(p_json_clob, v_start_pos, v_end_pos - v_start_pos);
            END IF;
        END IF;
        
        RETURN v_result;
    END parse_json_value;

    PROCEDURE complete_todo(p_todo_id NUMBER, p_actual_hours NUMBER DEFAULT NULL) IS
        v_user_id NUMBER;
        v_todo_exists NUMBER := 0;
    BEGIN
        -- Check if todo exists and get user_id
        BEGIN
            SELECT user_id INTO v_user_id FROM todos WHERE id = p_todo_id;
            v_todo_exists := 1;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20001, 'Todo with id ' || p_todo_id || ' does not exist');
        END;
        
        -- Update todo
        UPDATE todos 
        SET 
            status = 'completed',
            completion_percentage = 100,
            completed_at = SYSTIMESTAMP,
            actual_hours = NVL(p_actual_hours, actual_hours),
            updated_at = SYSTIMESTAMP
        WHERE id = p_todo_id;
        
        -- Log activity
        INSERT INTO activity_logs (user_id, todo_id, action, details)
        VALUES (
            v_user_id,
            p_todo_id,
            'completed',
            '{"completed_at":"' || TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') || 
            '","actual_hours":' || NVL(TO_CHAR(p_actual_hours), '0') || '}'
        );
        
        COMMIT;
    END complete_todo;

    PROCEDURE bulk_update_status(p_todo_ids VARCHAR2, p_new_status VARCHAR2, p_user_id NUMBER) IS
        v_affected_count NUMBER := 0;
        v_todo_id NUMBER;
        v_current_ids VARCHAR2(4000) := p_todo_ids || ',';
        v_pos NUMBER;
    BEGIN
        -- Validate status
        IF p_new_status NOT IN ('pending', 'in_progress', 'completed', 'cancelled', 'archived') THEN
            RAISE_APPLICATION_ERROR(-20002, 'Invalid status: ' || p_new_status);
        END IF;
        
        -- Parse comma-separated IDs and update each todo
        WHILE INSTR(v_current_ids, ',') > 0 LOOP
            v_pos := INSTR(v_current_ids, ',');
            v_todo_id := TO_NUMBER(TRIM(SUBSTR(v_current_ids, 1, v_pos - 1)));
            v_current_ids := SUBSTR(v_current_ids, v_pos + 1);
            
            -- Update todo if it belongs to the user
            UPDATE todos 
            SET status = p_new_status, updated_at = SYSTIMESTAMP
            WHERE id = v_todo_id AND user_id = p_user_id;
            
            IF SQL%ROWCOUNT > 0 THEN
                v_affected_count := v_affected_count + 1;
                
                -- Log activity
                INSERT INTO activity_logs (user_id, todo_id, action, details)
                VALUES (
                    p_user_id,
                    v_todo_id,
                    'status_changed',
                    '{"new_status":"' || p_new_status || 
                    '","changed_at":"' || TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') || '"}'
                );
            END IF;
        END LOOP;
        
        COMMIT;
        DBMS_OUTPUT.PUT_LINE('Updated ' || v_affected_count || ' todos to status ' || p_new_status);
    END bulk_update_status;

    PROCEDURE generate_user_report(p_user_id NUMBER) IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        -- User summary
        DBMS_OUTPUT.PUT_LINE('=== User Summary ===');
        FOR rec IN (
            SELECT 
                u.username,
                u.email,
                COUNT(t.id) as total_todos,
                COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_todos,
                COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_todos,
                COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress_todos,
                ROUND(AVG(t.completion_percentage), 2) as avg_completion_percentage,
                get_user_completion_rate(p_user_id) as completion_rate
            FROM users u
            LEFT JOIN todos t ON u.id = t.user_id
            WHERE u.id = p_user_id
            GROUP BY u.id, u.username, u.email
        ) LOOP
            DBMS_OUTPUT.PUT_LINE('User: ' || rec.username || ' (' || rec.email || ')');
            DBMS_OUTPUT.PUT_LINE('Total Todos: ' || rec.total_todos);
            DBMS_OUTPUT.PUT_LINE('Completed: ' || rec.completed_todos);
            DBMS_OUTPUT.PUT_LINE('Pending: ' || rec.pending_todos);
            DBMS_OUTPUT.PUT_LINE('In Progress: ' || rec.in_progress_todos);
            DBMS_OUTPUT.PUT_LINE('Completion Rate: ' || rec.completion_rate || '%');
        END LOOP;
        
        -- Recent activity (limited to 10)
        DBMS_OUTPUT.PUT_LINE(CHR(10) || '=== Recent Activity ===');
        FOR rec IN (
            SELECT * FROM (
                SELECT 
                    al.action,
                    al.details,
                    al.created_at,
                    t.title as todo_title
                FROM activity_logs al
                LEFT JOIN todos t ON al.todo_id = t.id
                WHERE al.user_id = p_user_id
                ORDER BY al.created_at DESC
            ) WHERE ROWNUM <= 10
        ) LOOP
            DBMS_OUTPUT.PUT_LINE(rec.action || ': ' || NVL(rec.todo_title, 'N/A') || 
                               ' (' || TO_CHAR(rec.created_at, 'YYYY-MM-DD HH24:MI') || ')');
        END LOOP;
    END generate_user_report;

    PROCEDURE refresh_materialized_views IS
    BEGIN
        DBMS_MVIEW.REFRESH('mv_user_activity_summary');
        DBMS_OUTPUT.PUT_LINE('Materialized views refreshed successfully');
    EXCEPTION
        WHEN OTHERS THEN
            DBMS_OUTPUT.PUT_LINE('Error refreshing materialized views: ' || SQLERRM);
    END refresh_materialized_views;

END todo_management;
/

-- Additional Triggers for business logic
CREATE OR REPLACE TRIGGER tr_update_todo_timestamp
    BEFORE UPDATE ON todos
    FOR EACH ROW
BEGIN
    :new.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER tr_log_todo_creation
    AFTER INSERT ON todos
    FOR EACH ROW
BEGIN
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    VALUES (
        :new.user_id,
        :new.id,
        'created',
        '{"title":"' || REPLACE(:new.title, '"', '\"') || 
        '","priority":"' || :new.priority || 
        '","created_at":"' || TO_CHAR(:new.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') || '"}'
    );
END;
/

CREATE OR REPLACE TRIGGER tr_log_todo_status_change
    AFTER UPDATE OF status ON todos
    FOR EACH ROW
    WHEN (OLD.status != NEW.status)
BEGIN
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    VALUES (
        :new.user_id,
        :new.id,
        'status_changed',
        '{"old_status":"' || :old.status || 
        '","new_status":"' || :new.status || 
        '","changed_at":"' || TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') || '"}'
    );
END;
/

CREATE OR REPLACE TRIGGER tr_log_todo_completion
    AFTER UPDATE OF completion_percentage ON todos
    FOR EACH ROW
    WHEN (NEW.completion_percentage = 100 AND OLD.completion_percentage != 100)
BEGIN
    -- Auto-complete when percentage reaches 100
    IF :new.status != 'completed' THEN
        UPDATE todos 
        SET status = 'completed', completed_at = SYSTIMESTAMP
        WHERE id = :new.id;
    END IF;
    
    -- Log completion
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    VALUES (
        :new.user_id,
        :new.id,
        'completed',
        '{"completed_at":"' || TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') || 
        '","actual_hours":' || NVL(TO_CHAR(:new.actual_hours), '0') || '}'
    );
END;
/

-- Oracle Scheduler Job for automated cleanup
BEGIN
    DBMS_SCHEDULER.CREATE_JOB (
        job_name        => 'DAILY_TODO_CLEANUP',
        job_type        => 'PLSQL_BLOCK',
        job_action      => 'BEGIN
                               -- Archive completed todos older than 30 days
                               UPDATE todos 
                               SET status = ''archived'', archived_at = SYSTIMESTAMP 
                               WHERE status = ''completed'' 
                                   AND completed_at < SYSTIMESTAMP - INTERVAL ''30'' DAY;
                               
                               -- Log cleanup activity
                               INSERT INTO activity_logs (user_id, todo_id, action, details)
                               SELECT 
                                   user_id,
                                   id,
                                   ''auto_archived'',
                                   ''{"archived_at":"'' || TO_CHAR(SYSTIMESTAMP, ''YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'') || 
                                   ''","reason":"completed_over_30_days"}''
                               FROM todos 
                               WHERE status = ''archived'' 
                                   AND updated_at = SYSTIMESTAMP;
                               
                               COMMIT;
                            END;',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ=DAILY; BYHOUR=2; BYMINUTE=0; BYSECOND=0',
        enabled         => TRUE,
        comments        => 'Daily cleanup of completed todos older than 30 days'
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Job might already exist
        NULL;
END;
/