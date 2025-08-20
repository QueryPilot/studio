#!/usr/bin/env python3
"""SQLite database seeder with comprehensive data types"""

import sqlite3
import random
import json
import datetime
import os
from decimal import Decimal
from typing import Any, List, Dict

def create_schema(conn: sqlite3.Connection) -> None:
    """Create SQLite schema with comprehensive data types"""
    cursor = conn.cursor()
    
    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON")
    
    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            full_name TEXT,
            avatar_url TEXT,
            bio TEXT,
            is_active INTEGER DEFAULT 1,
            email_verified INTEGER DEFAULT 0,
            phone TEXT,
            date_of_birth DATE,
            preferences TEXT DEFAULT '{}',
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP,
            deleted_at TIMESTAMP
        )
    """)
    
    # Todos table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled', 'archived')),
            priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
            
            -- Various data types
            due_date DATE,
            due_time TIME,
            due_datetime DATETIME,
            estimated_hours REAL,
            actual_hours REAL,
            completion_percentage INTEGER CHECK(completion_percentage >= 0 AND completion_percentage <= 100),
            
            -- JSON stored as TEXT
            tags TEXT DEFAULT '[]',
            attachments TEXT DEFAULT '[]',
            checklist TEXT DEFAULT '[]',
            custom_fields TEXT DEFAULT '{}',
            
            -- Binary and special types
            thumbnail BLOB,
            color_code TEXT,
            position INTEGER,
            is_recurring INTEGER DEFAULT 0,
            recurrence_pattern TEXT,
            parent_todo_id INTEGER,
            
            -- Numeric types
            difficulty_level INTEGER CHECK(difficulty_level >= 1 AND difficulty_level <= 10),
            reward_points INTEGER DEFAULT 0,
            cost REAL,
            latitude REAL,
            longitude REAL,
            
            -- Additional fields
            short_code TEXT,
            long_description TEXT,
            notes TEXT,
            ip_address TEXT,
            
            -- Timestamps
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reminder_at TIMESTAMP,
            archived_at TIMESTAMP,
            
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_todo_id) REFERENCES todos(id) ON DELETE SET NULL
        )
    """)
    
    # Categories table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT,
            icon TEXT,
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(name, user_id)
        )
    """)
    
    # Todo categories junction table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS todo_categories (
            todo_id INTEGER,
            category_id INTEGER,
            PRIMARY KEY (todo_id, category_id),
            FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
        )
    """)
    
    # Comments table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            todo_id INTEGER,
            user_id INTEGER,
            content TEXT NOT NULL,
            is_edited INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    
    # Activity log table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            todo_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
        )
    """)
    
    # Collaborators table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS todo_collaborators (
            todo_id INTEGER,
            collaborator_id INTEGER,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (todo_id, collaborator_id),
            FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
            FOREIGN KEY (collaborator_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    
    # Related todos table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS related_todos (
            todo_id INTEGER,
            related_todo_id INTEGER,
            relation_type TEXT DEFAULT 'related_to' CHECK(relation_type IN ('blocks', 'blocked_by', 'related_to', 'duplicate_of')),
            PRIMARY KEY (todo_id, related_todo_id),
            FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
            FOREIGN KEY (related_todo_id) REFERENCES todos(id) ON DELETE CASCADE
        )
    """)
    
    # Create indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_activity_logs_todo_id ON activity_logs(todo_id)")
    
    # =======================================================================
    # ADVANCED DATABASE OBJECTS
    # =======================================================================
    
    # Views
    cursor.execute("""
        CREATE VIEW IF NOT EXISTS user_stats AS
        SELECT 
            u.id,
            u.username,
            u.email,
            COUNT(t.id) as total_todos,
            COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_todos,
            COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_todos,
            COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress_todos,
            ROUND(AVG(CAST(t.completion_percentage AS REAL)), 2) as avg_completion,
            u.created_at,
            u.last_login_at
        FROM users u
        LEFT JOIN todos t ON u.id = t.user_id
        GROUP BY u.id, u.username, u.email, u.created_at, u.last_login_at
    """)
    
    cursor.execute("""
        CREATE VIEW IF NOT EXISTS todo_summary AS
        SELECT 
            t.id,
            t.title,
            t.status,
            t.priority,
            t.due_date,
            t.completion_percentage,
            u.username as owner,
            GROUP_CONCAT(DISTINCT c.name, ', ') as categories,
            COUNT(DISTINCT cm.id) as comment_count,
            COUNT(DISTINCT tc.collaborator_id) as collaborator_count
        FROM todos t
        JOIN users u ON t.user_id = u.id
        LEFT JOIN todo_categories tc_cat ON t.id = tc_cat.todo_id
        LEFT JOIN categories c ON tc_cat.category_id = c.id
        LEFT JOIN comments cm ON t.id = cm.todo_id
        LEFT JOIN todo_collaborators tc ON t.id = tc.todo_id
        GROUP BY t.id, t.title, t.status, t.priority, t.due_date, t.completion_percentage, u.username
    """)
    
    cursor.execute("""
        CREATE VIEW IF NOT EXISTS overdue_todos AS
        SELECT 
            t.*,
            u.username,
            u.email,
            CAST((julianday('now') - julianday(t.due_date)) AS INTEGER) as days_overdue
        FROM todos t
        JOIN users u ON t.user_id = u.id
        WHERE t.due_date < date('now') 
            AND t.status NOT IN ('completed', 'cancelled', 'archived')
    """)
    
    cursor.execute("""
        CREATE VIEW IF NOT EXISTS todo_analytics AS
        SELECT 
            date(t.created_at, 'weekday 0', '-6 days') as week_start,
            COUNT(*) as todos_created,
            COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as todos_completed,
            AVG(t.estimated_hours) as avg_estimated_hours,
            AVG(CASE WHEN t.status = 'completed' THEN t.actual_hours END) as avg_actual_hours,
            COUNT(DISTINCT t.user_id) as active_users
        FROM todos t
        GROUP BY date(t.created_at, 'weekday 0', '-6 days')
        ORDER BY week_start
    """)
    
    # Triggers (SQLite's main advanced feature)
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_update_user_timestamp
        AFTER UPDATE ON users
        FOR EACH ROW
        BEGIN
            UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_update_todo_timestamp
        AFTER UPDATE ON todos
        FOR EACH ROW
        BEGIN
            UPDATE todos SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_log_todo_creation
        AFTER INSERT ON todos
        FOR EACH ROW
        BEGIN
            INSERT INTO activity_logs (user_id, todo_id, action, details)
            VALUES (
                NEW.user_id,
                NEW.id,
                'created',
                json_object(
                    'title', NEW.title,
                    'priority', NEW.priority,
                    'created_at', NEW.created_at
                )
            );
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_log_todo_status_change
        AFTER UPDATE OF status ON todos
        FOR EACH ROW
        WHEN OLD.status != NEW.status
        BEGIN
            INSERT INTO activity_logs (user_id, todo_id, action, details)
            VALUES (
                NEW.user_id,
                NEW.id,
                'status_changed',
                json_object(
                    'old_status', OLD.status,
                    'new_status', NEW.status,
                    'changed_at', CURRENT_TIMESTAMP
                )
            );
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_log_todo_completion
        AFTER UPDATE OF completion_percentage ON todos
        FOR EACH ROW
        WHEN NEW.completion_percentage = 100 AND OLD.completion_percentage != 100
        BEGIN
            UPDATE todos SET 
                status = 'completed',
                completed_at = CURRENT_TIMESTAMP
            WHERE id = NEW.id;
            
            INSERT INTO activity_logs (user_id, todo_id, action, details)
            VALUES (
                NEW.user_id,
                NEW.id,
                'completed',
                json_object(
                    'completed_at', CURRENT_TIMESTAMP,
                    'actual_hours', NEW.actual_hours
                )
            );
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_prevent_self_reference
        BEFORE INSERT ON related_todos
        FOR EACH ROW
        WHEN NEW.todo_id = NEW.related_todo_id
        BEGIN
            SELECT RAISE(ABORT, 'Todo cannot be related to itself');
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_enforce_json_validation
        BEFORE INSERT ON todos
        FOR EACH ROW
        WHEN NEW.tags IS NOT NULL AND json_valid(NEW.tags) = 0
        BEGIN
            SELECT RAISE(ABORT, 'Invalid JSON in tags field');
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_enforce_json_validation_update
        BEFORE UPDATE ON todos
        FOR EACH ROW
        WHEN NEW.tags IS NOT NULL AND json_valid(NEW.tags) = 0
        BEGIN
            SELECT RAISE(ABORT, 'Invalid JSON in tags field');
        END
    """)
    
    # Full-Text Search (SQLite FTS5)
    cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS todos_fts USING fts5(
            title, 
            description, 
            content=todos, 
            content_rowid=id
        )
    """)
    
    # Trigger to keep FTS index in sync
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_todos_fts_insert
        AFTER INSERT ON todos
        BEGIN
            INSERT INTO todos_fts(rowid, title, description) 
            VALUES (NEW.id, NEW.title, NEW.description);
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_todos_fts_delete
        AFTER DELETE ON todos
        BEGIN
            DELETE FROM todos_fts WHERE rowid = OLD.id;
        END
    """)
    
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS tr_todos_fts_update
        AFTER UPDATE ON todos
        BEGIN
            UPDATE todos_fts 
            SET title = NEW.title, description = NEW.description 
            WHERE rowid = NEW.id;
        END
    """)
    
    conn.commit()

def seed_data(conn: sqlite3.Connection, user_count: int = 100) -> None:
    """Seed SQLite database with comprehensive test data"""
    cursor = conn.cursor()
    
    # Sample data arrays
    statuses = ['pending', 'in_progress', 'completed', 'cancelled', 'archived']
    priorities = ['low', 'medium', 'high', 'critical']
    languages = ['en', 'es', 'fr', 'de', 'ja']
    timezones = ['UTC', 'EST', 'PST', 'CST', 'MST']
    subscriptions = ['free', 'basic', 'premium']
    sources = ['google', 'facebook', 'friend', 'other']
    account_types = ['individual', 'team', 'enterprise']
    task_titles = [
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
    ]
    departments = ['Engineering', 'Marketing', 'Sales', 'Support', 'HR']
    clients = ['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Corp', None]
    comment_texts = [
        'Great progress on this!',
        'Need more information about requirements',
        'This is blocked by another task',
        'Updated the deadline',
        'Added new attachments',
        'Please review when you have time',
        'Marking as complete',
        'Moving to next sprint'
    ]
    
    # Insert users
    users = []
    for i in range(1, user_count + 1):
        user_data = (
            f'user_{i}',
            f'user{i}@example.com',
            f'User {i} Smith',
            f'https://avatar.example.com/user{i}.jpg',
            f'Bio for user {i}. ' + 'Lorem ipsum dolor sit amet. ' * random.randint(1, 3),
            1 if random.random() > 0.1 else 0,
            1 if random.random() > 0.3 else 0,
            f'+1555{random.randint(0, 9999999):07d}',
            (datetime.date.today() - datetime.timedelta(days=random.randint(365*18, 365*70))).isoformat(),
            json.dumps({
                'theme': 'dark' if random.random() > 0.5 else 'light',
                'notifications': random.random() > 0.3,
                'language': random.choice(languages),
                'timezone': random.choice(timezones)
            }),
            json.dumps({
                'subscription': random.choice(subscriptions),
                'referral_source': random.choice(sources),
                'account_type': random.choice(account_types)
            }),
            (datetime.datetime.now() - datetime.timedelta(days=random.randint(0, 30))).isoformat()
        )
        cursor.execute("""
            INSERT INTO users (username, email, full_name, avatar_url, bio, is_active,
                             email_verified, phone, date_of_birth, preferences, metadata, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, user_data)
        users.append(cursor.lastrowid)
    
    # Insert categories for each user
    categories = {}
    for user_id in users:
        category_names = ['Work', 'Personal', 'Shopping', 'Health', 'Learning']
        colors = ['#FF5733', '#33FF57', '#3357FF', '#FF33F5', '#F5FF33']
        icons = ['briefcase', 'home', 'cart', 'heart', 'book']
        
        user_categories = []
        for j, (name, color, icon) in enumerate(zip(category_names, colors, icons)):
            cursor.execute("""
                INSERT INTO categories (name, color, icon, user_id)
                VALUES (?, ?, ?, ?)
            """, (name, color, icon, user_id))
            user_categories.append(cursor.lastrowid)
        categories[user_id] = user_categories
    
    # Insert todos for each user
    todo_ids = []
    for user_id in users:
        todo_count = random.randint(50, 200)
        
        for j in range(1, todo_count + 1):
            status = random.choice(statuses)
            priority = random.choice(priorities)
            
            # Generate random data
            due_date = (datetime.date.today() + datetime.timedelta(days=random.randint(-180, 365))).isoformat()
            due_time = f"{random.randint(8, 18):02d}:{random.randint(0, 59):02d}:00"
            due_datetime = (datetime.datetime.now() + datetime.timedelta(days=random.randint(-180, 365))).isoformat()
            
            tags = json.dumps([random.choice(['work', 'personal', 'urgent', 'learning']),
                              random.choice(['important', 'project', 'team', 'solo'])])
            
            attachments = json.dumps([]) if random.random() > 0.7 else json.dumps([
                {'name': f'document{j}.pdf', 'size': random.randint(1000, 1000000), 
                 'url': f'https://files.example.com/doc{j}.pdf'},
                {'name': f'image{j}.png', 'size': random.randint(1000, 500000),
                 'url': f'https://files.example.com/img{j}.png'}
            ])
            
            checklist = json.dumps([]) if random.random() > 0.6 else json.dumps([
                {'id': 1, 'text': 'Research topic', 'done': False},
                {'id': 2, 'text': 'Create outline', 'done': False},
                {'id': 3, 'text': 'Write draft', 'done': False}
            ])
            
            custom_fields = json.dumps({
                'client': random.choice(clients),
                'project_code': f'PRJ-{random.randint(0, 9999):04d}' if random.random() > 0.5 else None,
                'billable': random.random() > 0.5,
                'department': random.choice(departments)
            })
            
            # Generate thumbnail (small random binary data)
            thumbnail = bytes([random.randint(0, 255) for _ in range(100)]) if random.random() > 0.9 else None
            
            todo_data = (
                user_id,
                f'Task {j} for user {user_id}: {random.choice(task_titles)}',
                f'Description for task {j}. ' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' * random.randint(1, 5),
                status,
                priority,
                due_date,
                due_time,
                due_datetime,
                round(random.uniform(0.5, 20), 2),
                round(random.uniform(0.5, 20), 2) if status in ['completed', 'archived'] else None,
                100 if status == 'completed' else (random.randint(0, 99) if status == 'in_progress' else 0),
                tags,
                attachments,
                checklist,
                custom_fields,
                thumbnail,
                f'#{random.randint(0, 16777215):06x}',
                j,
                1 if random.random() > 0.8 else 0,
                random.choice(['daily', 'weekly', 'monthly', 'yearly']) if random.random() > 0.8 else None,
                random.randint(1, 10),
                random.randint(0, 1000),
                round(random.uniform(0, 1000), 2) if random.random() > 0.7 else None,
                37.7749 + (random.random() - 0.5) if random.random() > 0.9 else None,
                -122.4194 + (random.random() - 0.5) if random.random() > 0.9 else None,
                f'TSK-{user_id:03d}-{j:04d}',
                'Lorem ipsum dolor sit amet. ' * random.randint(5, 15) if random.random() > 0.5 else None,
                f'Note: Important information. ' * random.randint(1, 3) if random.random() > 0.7 else None,
                f'192.168.{random.randint(0, 255)}.{random.randint(0, 255)}',
                (datetime.datetime.now() - datetime.timedelta(days=random.randint(0, 30))).isoformat() if status in ['in_progress', 'completed'] else None,
                (datetime.datetime.now() - datetime.timedelta(days=random.randint(0, 20))).isoformat() if status == 'completed' else None,
                (datetime.datetime.now() + datetime.timedelta(days=random.randint(0, 30))).isoformat() if random.random() > 0.6 else None
            )
            
            cursor.execute("""
                INSERT INTO todos (user_id, title, description, status, priority,
                                 due_date, due_time, due_datetime, estimated_hours, actual_hours,
                                 completion_percentage, tags, attachments, checklist, custom_fields,
                                 thumbnail, color_code, position, is_recurring, recurrence_pattern,
                                 difficulty_level, reward_points, cost, latitude, longitude,
                                 short_code, long_description, notes, ip_address,
                                 started_at, completed_at, reminder_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, todo_data)
            todo_ids.append(cursor.lastrowid)
    
    # Add todo-category relationships
    for _ in range(min(5000, len(todo_ids))):
        todo_id = random.choice(todo_ids)
        cursor.execute("SELECT user_id FROM todos WHERE id = ?", (todo_id,))
        user_id = cursor.fetchone()[0]
        if user_id in categories:
            category_id = random.choice(categories[user_id])
            try:
                cursor.execute("""
                    INSERT INTO todo_categories (todo_id, category_id)
                    VALUES (?, ?)
                """, (todo_id, category_id))
            except sqlite3.IntegrityError:
                pass  # Ignore duplicates
    
    # Add collaborators
    for _ in range(min(2000, len(todo_ids))):
        todo_id = random.choice(todo_ids)
        collaborator_id = random.choice(users)
        cursor.execute("SELECT user_id FROM todos WHERE id = ?", (todo_id,))
        todo_user_id = cursor.fetchone()[0]
        if collaborator_id != todo_user_id:
            try:
                cursor.execute("""
                    INSERT INTO todo_collaborators (todo_id, collaborator_id)
                    VALUES (?, ?)
                """, (todo_id, collaborator_id))
            except sqlite3.IntegrityError:
                pass  # Ignore duplicates
    
    # Add related todos
    for _ in range(min(1000, len(todo_ids) // 2)):
        todo_id1 = random.choice(todo_ids)
        todo_id2 = random.choice(todo_ids)
        if todo_id1 != todo_id2:
            relation_type = random.choice(['blocks', 'blocked_by', 'related_to', 'duplicate_of'])
            try:
                cursor.execute("""
                    INSERT INTO related_todos (todo_id, related_todo_id, relation_type)
                    VALUES (?, ?, ?)
                """, (min(todo_id1, todo_id2), max(todo_id1, todo_id2), relation_type))
            except sqlite3.IntegrityError:
                pass  # Ignore duplicates
    
    # Add comments
    for _ in range(min(500, len(todo_ids))):
        todo_id = random.choice(todo_ids)
        cursor.execute("SELECT user_id FROM todos WHERE id = ?", (todo_id,))
        user_id = cursor.fetchone()[0]
        cursor.execute("""
            INSERT INTO comments (todo_id, user_id, content, is_edited)
            VALUES (?, ?, ?, ?)
        """, (todo_id, user_id, f'Comment: {random.choice(comment_texts)}', 1 if random.random() > 0.8 else 0))
    
    # Add activity logs
    actions = ['created', 'updated', 'status_changed', 'priority_changed', 'assigned', 'commented']
    for _ in range(min(1000, len(todo_ids))):
        todo_id = random.choice(todo_ids)
        cursor.execute("SELECT user_id FROM todos WHERE id = ?", (todo_id,))
        user_id = cursor.fetchone()[0]
        details = json.dumps({
            'timestamp': (datetime.datetime.now() - datetime.timedelta(days=random.randint(0, 30))).isoformat(),
            'ip_address': f'192.168.{random.randint(0, 255)}.{random.randint(0, 255)}',
            'user_agent': 'Mozilla/5.0'
        })
        cursor.execute("""
            INSERT INTO activity_logs (user_id, todo_id, action, details)
            VALUES (?, ?, ?, ?)
        """, (user_id, todo_id, random.choice(actions), details))
    
    conn.commit()
    print(f"✅ Seeding completed: {user_count} users with their todos")

def main():
    # Create database file
    db_path = 'todoapp.db'
    
    # Remove existing database if it exists
    if os.path.exists(db_path):
        os.remove(db_path)
        print(f"🗑️  Removed existing database: {db_path}")
    
    # Create new database and seed
    conn = sqlite3.connect(db_path)
    print(f"📦 Creating SQLite database: {db_path}")
    
    try:
        create_schema(conn)
        print("🏗️  Schema created successfully")
        
        seed_data(conn, user_count=100)
        
        # Print statistics
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users")
        user_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM todos")
        todo_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM comments")
        comment_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM activity_logs")
        activity_count = cursor.fetchone()[0]
        
        print(f"\n📊 Database Statistics:")
        print(f"  - Users: {user_count}")
        print(f"  - Todos: {todo_count}")
        print(f"  - Comments: {comment_count}")
        print(f"  - Activity Logs: {activity_count}")
        
    finally:
        conn.close()

if __name__ == "__main__":
    main()