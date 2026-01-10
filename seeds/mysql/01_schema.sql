-- Partitioning Strategy:
-- 1. todos: List Partitioning by 'status' (Active vs. Done)
-- 2. activity_logs: Range Partitioning by 'created_at' (Yearly)

USE todoapp;
SET FOREIGN_KEY_CHECKS = 0;

-- ==========================================
-- 1. CLEANUP
-- ==========================================
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS todo_categories;
DROP TABLE IF EXISTS todo_collaborators;
DROP TABLE IF EXISTS related_todos;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS todos;
DROP TABLE IF EXISTS users;

-- ==========================================
-- 2. USERS & CATEGORIES
-- ==========================================
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    avatar_url VARCHAR(255),
    bio TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    phone VARCHAR(20),
    date_of_birth DATE,
    preferences JSON,
    metadata JSON,
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7),
    icon VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_category (name, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==========================================
-- 3. TODOS TABLE (Partitioned)
-- ==========================================
-- No FKs to users allowed if we wanted strict partitioning rules in some versions,
-- but typically outgoing FKs are okay in InnoDB partitioned tables.
-- However, we'll keep it simple and safe: No FKs in partitioned tables for this demo.

CREATE TABLE todos (
    id INT AUTO_INCREMENT,
    user_id INT NOT NULL, -- No FK constraint
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority INT DEFAULT 3,
    due_date TIMESTAMP NULL,
    
    -- Extended fields
    due_time TIME,
    due_datetime DATETIME,
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2),
    completion_percentage TINYINT DEFAULT 0,
    tags JSON,
    attachments JSON,
    checklist JSON,
    custom_fields JSON,
    color_code VARCHAR(7),
    position INT,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern VARCHAR(50),
    difficulty_level TINYINT,
    reward_points INT,
    cost DECIMAL(10,2),
    latitude DOUBLE,
    longitude DOUBLE,
    short_code VARCHAR(20),
    long_description TEXT,
    notes TEXT,
    year_created INT,
    flags SET('urgent', 'important', 'delegated'),
    ip_address VARCHAR(45),
    started_at DATETIME,
    completed_at DATETIME,
    reminder_at DATETIME,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Partition Key (status) must be in PK
    PRIMARY KEY (id, status),
    KEY idx_user_id (user_id),
    KEY idx_created_at (created_at)
)
PARTITION BY LIST COLUMNS(status) (
    PARTITION p_active VALUES IN ('pending', 'in_progress'),
    PARTITION p_done   VALUES IN ('completed', 'cancelled', 'archived')
);

-- ==========================================
-- 4. RELATED TABLES (No FKs to todos)
-- ==========================================
CREATE TABLE todo_categories (
    todo_id INT NOT NULL,
    category_id INT NOT NULL,
    PRIMARY KEY (todo_id, category_id),
    KEY idx_category (category_id)
    -- No FK to todos
    -- FK to categories is fine
    -- FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    todo_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_todo (todo_id),
    KEY idx_user (user_id)
);

CREATE TABLE todo_collaborators (
    todo_id INT NOT NULL,
    collaborator_id INT NOT NULL,
    PRIMARY KEY (todo_id, collaborator_id),
    KEY idx_collaborator (collaborator_id)
);

CREATE TABLE related_todos (
    todo_id INT NOT NULL,
    related_todo_id INT NOT NULL,
    relation_type VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (todo_id, related_todo_id)
);

-- ==========================================
-- 5. ACTIVITY LOGS (Partitioned)
-- ==========================================
CREATE TABLE activity_logs (
    id BIGINT AUTO_INCREMENT,
    user_id INT NOT NULL,
    todo_id INT,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    details JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- PK must include partition key
    PRIMARY KEY (id, created_at),
    KEY idx_logs_user_id (user_id),
    KEY idx_logs_action (action)
)
PARTITION BY RANGE COLUMNS(created_at) (
    PARTITION p_old     VALUES LESS THAN ('2023-01-01'),
    PARTITION p_2023    VALUES LESS THAN ('2024-01-01'),
    PARTITION p_2024    VALUES LESS THAN ('2025-01-01'),
    PARTITION p_2025    VALUES LESS THAN ('2026-01-01'),
    PARTITION p_future  VALUES LESS THAN (MAXVALUE)
);

SET FOREIGN_KEY_CHECKS = 1;
