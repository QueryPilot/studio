-- MySQL schema with comprehensive data types
CREATE DATABASE IF NOT EXISTS todoapp;
USE todoapp;

-- Drop existing tables (if they exist)
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS related_todos;
DROP TABLE IF EXISTS todo_collaborators;
DROP TABLE IF EXISTS todo_categories;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS todos;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- Users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uuid CHAR(36) DEFAULT (UUID()) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    bio TEXT,
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    phone VARCHAR(20),
    date_of_birth DATE,
    preferences JSON,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    deleted_at DATETIME,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Todos table with comprehensive data types
CREATE TABLE todos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uuid CHAR(36) DEFAULT (UUID()) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status ENUM('pending', 'in_progress', 'completed', 'cancelled', 'archived') DEFAULT 'pending',
    priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    
    -- Various data types
    due_date DATE,
    due_time TIME,
    due_datetime DATETIME,
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2),
    completion_percentage TINYINT UNSIGNED CHECK (completion_percentage <= 100),
    
    -- JSON types
    tags JSON,
    attachments JSON,
    checklist JSON,
    custom_fields JSON,
    
    -- Binary and special types
    thumbnail BLOB,
    color_code CHAR(7),
    position INT,
    is_recurring BOOLEAN DEFAULT false,
    recurrence_pattern VARCHAR(50),
    parent_todo_id INT,
    
    -- Numeric types
    difficulty_level TINYINT CHECK (difficulty_level >= 1 AND difficulty_level <= 10),
    reward_points INT DEFAULT 0,
    cost DECIMAL(10,2),
    latitude DOUBLE,
    longitude DOUBLE,
    
    -- String variations
    short_code VARCHAR(20),
    long_description MEDIUMTEXT,
    notes LONGTEXT,
    
    -- Additional MySQL specific types
    year_created YEAR,
    flags SET('urgent', 'important', 'delegated', 'waiting', 'someday'),
    ip_address VARCHAR(45),
    
    -- Geometry type (requires MySQL 5.7+)
    location POINT,
    
    -- Timestamps
    started_at DATETIME,
    completed_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    reminder_at DATETIME,
    archived_at DATETIME,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_todo_id) REFERENCES todos(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_priority (priority),
    INDEX idx_due_date (due_date),
    FULLTEXT idx_search (title, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Categories table
CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),
    icon VARCHAR(50),
    user_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_category (name, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Todo categories junction table
CREATE TABLE todo_categories (
    todo_id INT,
    category_id INT,
    PRIMARY KEY (todo_id, category_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comments table
CREATE TABLE comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    todo_id INT,
    user_id INT,
    content TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_todo_comments (todo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activity log table
CREATE TABLE activity_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    todo_id INT,
    action VARCHAR(50) NOT NULL,
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    INDEX idx_user_activity (user_id),
    INDEX idx_todo_activity (todo_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Collaborators table (MySQL doesn't support arrays like PostgreSQL)
CREATE TABLE todo_collaborators (
    todo_id INT,
    collaborator_id INT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (todo_id, collaborator_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (collaborator_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Related todos table
CREATE TABLE related_todos (
    todo_id INT,
    related_todo_id INT,
    relation_type ENUM('blocks', 'blocked_by', 'related_to', 'duplicate_of') DEFAULT 'related_to',
    PRIMARY KEY (todo_id, related_todo_id),
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    FOREIGN KEY (related_todo_id) REFERENCES todos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- ADVANCED DATABASE OBJECTS
-- ============================================================================

-- Views
DROP VIEW IF EXISTS user_stats;
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

DROP VIEW IF EXISTS todo_summary;
CREATE VIEW todo_summary AS
SELECT 
    t.id,
    t.title,
    t.status,
    t.priority,
    t.due_date,
    t.completion_percentage,
    u.username as owner,
    GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') as categories,
    COUNT(DISTINCT cm.id) as comment_count,
    COUNT(DISTINCT tc.collaborator_id) as collaborator_count
FROM todos t
JOIN users u ON t.user_id = u.id
LEFT JOIN todo_categories tc_cat ON t.id = tc_cat.todo_id
LEFT JOIN categories c ON tc_cat.category_id = c.id
LEFT JOIN comments cm ON t.id = cm.todo_id
LEFT JOIN todo_collaborators tc ON t.id = tc.todo_id
GROUP BY t.id, t.title, t.status, t.priority, t.due_date, t.completion_percentage, u.username;

DROP VIEW IF EXISTS overdue_todos;
CREATE VIEW overdue_todos AS
SELECT 
    t.*,
    u.username,
    u.email,
    DATEDIFF(CURDATE(), t.due_date) as days_overdue
FROM todos t
JOIN users u ON t.user_id = u.id
WHERE t.due_date < CURDATE() 
    AND t.status NOT IN ('completed', 'cancelled', 'archived');

-- Functions (MySQL uses DELIMITER for function definitions)
DELIMITER $$

DROP FUNCTION IF EXISTS get_user_completion_rate$$
CREATE FUNCTION get_user_completion_rate(user_id_param INT)
RETURNS DECIMAL(5,2)
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE total_count INT DEFAULT 0;
    DECLARE completed_count INT DEFAULT 0;
    DECLARE completion_rate DECIMAL(5,2) DEFAULT 0.00;
    
    SELECT COUNT(*) INTO total_count 
    FROM todos WHERE user_id = user_id_param;
    
    SELECT COUNT(*) INTO completed_count 
    FROM todos WHERE user_id = user_id_param AND status = 'completed';
    
    IF total_count > 0 THEN
        SET completion_rate = (completed_count / total_count) * 100;
    END IF;
    
    RETURN completion_rate;
END$$

DROP FUNCTION IF EXISTS calculate_todo_score$$
CREATE FUNCTION calculate_todo_score(todo_id_param INT)
RETURNS DECIMAL(5,2)
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE score DECIMAL(5,2) DEFAULT 0.00;
    DECLARE priority_weight DECIMAL(3,2);
    DECLARE completion_weight DECIMAL(3,2);
    DECLARE urgency_weight DECIMAL(3,2);
    DECLARE todo_priority VARCHAR(20);
    DECLARE todo_completion TINYINT;
    DECLARE todo_due_date DATE;
    
    -- Get todo details
    SELECT priority, completion_percentage, due_date
    INTO todo_priority, todo_completion, todo_due_date
    FROM todos WHERE id = todo_id_param;
    
    -- Priority weight
    CASE todo_priority
        WHEN 'critical' THEN SET priority_weight = 4.0;
        WHEN 'high' THEN SET priority_weight = 3.0;
        WHEN 'medium' THEN SET priority_weight = 2.0;
        WHEN 'low' THEN SET priority_weight = 1.0;
        ELSE SET priority_weight = 1.0;
    END CASE;
    
    -- Completion weight
    SET completion_weight = COALESCE(todo_completion, 0) / 100.0;
    
    -- Urgency weight (based on due date)
    IF todo_due_date IS NOT NULL THEN
        SET urgency_weight = CASE 
            WHEN todo_due_date < CURDATE() THEN 2.0  -- Overdue
            WHEN todo_due_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY) THEN 1.5  -- Due soon
            ELSE 1.0
        END;
    ELSE
        SET urgency_weight = 1.0;
    END IF;
    
    -- Calculate final score
    SET score = (priority_weight * 25) + (completion_weight * 50) + (urgency_weight * 25);
    
    RETURN score;
END$$

DROP FUNCTION IF EXISTS json_extract_text$$
CREATE FUNCTION json_extract_text(json_doc JSON, json_path VARCHAR(255))
RETURNS TEXT
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE result TEXT;
    SET result = JSON_UNQUOTE(JSON_EXTRACT(json_doc, json_path));
    RETURN result;
END$$

DELIMITER ;

-- Stored Procedures
DELIMITER $$

DROP PROCEDURE IF EXISTS complete_todo$$
CREATE PROCEDURE complete_todo(IN todo_id_param INT, IN actual_hours_param DECIMAL(5,2))
BEGIN
    DECLARE todo_exists INT DEFAULT 0;
    DECLARE user_id_val INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- Check if todo exists
    SELECT COUNT(*), user_id INTO todo_exists, user_id_val
    FROM todos WHERE id = todo_id_param;
    
    IF todo_exists = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Todo not found';
    END IF;
    
    -- Update todo
    UPDATE todos 
    SET 
        status = 'completed',
        completion_percentage = 100,
        completed_at = CURRENT_TIMESTAMP,
        actual_hours = COALESCE(actual_hours_param, actual_hours),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = todo_id_param;
    
    -- Log activity
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    VALUES (
        user_id_val,
        todo_id_param,
        'completed',
        JSON_OBJECT(
            'completed_at', CURRENT_TIMESTAMP,
            'actual_hours', COALESCE(actual_hours_param, 0)
        )
    );
    
    COMMIT;
END$$

DROP PROCEDURE IF EXISTS bulk_update_status$$
CREATE PROCEDURE bulk_update_status(IN todo_ids TEXT, IN new_status VARCHAR(20), IN user_id_param INT)
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE todo_id INT;
    DECLARE affected_count INT DEFAULT 0;
    DECLARE todo_cursor CURSOR FOR 
        SELECT CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(todo_ids, ',', numbers.n), ',', -1)) AS UNSIGNED) as id
        FROM (
            SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION
            SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10
        ) numbers
        WHERE CHAR_LENGTH(todo_ids) - CHAR_LENGTH(REPLACE(todo_ids, ',', '')) >= numbers.n - 1;
    
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    OPEN todo_cursor;
    
    read_loop: LOOP
        FETCH todo_cursor INTO todo_id;
        IF done THEN
            LEAVE read_loop;
        END IF;
        
        UPDATE todos 
        SET status = new_status, updated_at = CURRENT_TIMESTAMP
        WHERE id = todo_id AND user_id = user_id_param;
        
        IF ROW_COUNT() > 0 THEN
            SET affected_count = affected_count + 1;
            
            INSERT INTO activity_logs (user_id, todo_id, action, details)
            VALUES (
                user_id_param,
                todo_id,
                'status_changed',
                JSON_OBJECT('new_status', new_status, 'changed_at', CURRENT_TIMESTAMP)
            );
        END IF;
    END LOOP;
    
    CLOSE todo_cursor;
    
    SELECT CONCAT('Updated ', affected_count, ' todos to status ', new_status) as result;
    
    COMMIT;
END$$

DROP PROCEDURE IF EXISTS generate_user_report$$
CREATE PROCEDURE generate_user_report(IN user_id_param INT)
BEGIN
    -- User summary
    SELECT 
        u.username,
        u.email,
        COUNT(t.id) as total_todos,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_todos,
        COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_todos,
        COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress_todos,
        ROUND(AVG(t.completion_percentage), 2) as avg_completion_percentage,
        get_user_completion_rate(user_id_param) as completion_rate
    FROM users u
    LEFT JOIN todos t ON u.id = t.user_id
    WHERE u.id = user_id_param
    GROUP BY u.id, u.username, u.email;
    
    -- Recent activity
    SELECT 
        al.action,
        al.details,
        al.created_at,
        t.title as todo_title
    FROM activity_logs al
    LEFT JOIN todos t ON al.todo_id = t.id
    WHERE al.user_id = user_id_param
    ORDER BY al.created_at DESC
    LIMIT 10;
    
    -- Category breakdown
    SELECT 
        c.name as category,
        COUNT(t.id) as todo_count,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_count
    FROM categories c
    LEFT JOIN todo_categories tc ON c.id = tc.category_id
    LEFT JOIN todos t ON tc.todo_id = t.id
    WHERE c.user_id = user_id_param
    GROUP BY c.id, c.name
    ORDER BY todo_count DESC;
END$$

DELIMITER ;

-- Triggers
DELIMITER $$

CREATE TRIGGER tr_update_todo_timestamp
    BEFORE UPDATE ON todos
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END$$

CREATE TRIGGER tr_log_todo_creation
    AFTER INSERT ON todos
    FOR EACH ROW
BEGIN
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    VALUES (
        NEW.user_id,
        NEW.id,
        'created',
        JSON_OBJECT(
            'title', NEW.title,
            'priority', NEW.priority,
            'created_at', NEW.created_at
        )
    );
END$$

CREATE TRIGGER tr_log_todo_status_change
    AFTER UPDATE ON todos
    FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO activity_logs (user_id, todo_id, action, details)
        VALUES (
            NEW.user_id,
            NEW.id,
            'status_changed',
            JSON_OBJECT(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'changed_at', CURRENT_TIMESTAMP
            )
        );
    END IF;
END$$

DELIMITER ;

-- Events (MySQL's equivalent to scheduled jobs)
-- Note: Events require the event scheduler to be enabled
-- SET GLOBAL event_scheduler = ON; -- Commented out due to permission restrictions in Docker

DELIMITER $$

CREATE EVENT IF NOT EXISTS daily_todo_cleanup
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_DATE + INTERVAL 1 DAY
DO
BEGIN
    -- Archive completed todos older than 30 days
    UPDATE todos 
    SET status = 'archived' 
    WHERE status = 'completed' 
        AND completed_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
    
    -- Log cleanup activity
    INSERT INTO activity_logs (user_id, todo_id, action, details)
    SELECT 
        user_id,
        id,
        'auto_archived',
        JSON_OBJECT('archived_at', NOW(), 'reason', 'completed_over_30_days')
    FROM todos 
    WHERE status = 'archived' 
        AND updated_at = CURRENT_TIMESTAMP;
END$$

DELIMITER ;