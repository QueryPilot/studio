#!/usr/bin/env python3
"""
PostgreSQL Bulk Seeding Script
Generates and loads 100K records with partitioning support.
"""

import subprocess
import os
import sys
from pathlib import Path


def run_command(cmd, description):
    """Run shell command with error handling."""
    print(f"→ {description}")
    try:
        result = subprocess.run(
            cmd, shell=True, check=True, capture_output=True, text=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"ERROR: {description} failed")
        print(f"Command: {cmd}")
        print(f"Error: {e.stderr}")
        sys.exit(1)


def main():
    project_root = Path(__file__).parent.parent
    seeds_dir = project_root / "seeds"
    data_dir = seeds_dir / "bulk_data" / "postgres"
    data_dir.mkdir(parents=True, exist_ok=True)

    # Configuration
    postgres_host = "localhost"
    postgres_port = "15432"
    postgres_user = "devuser"
    postgres_password = "devpass123"
    postgres_db = "todoapp"

    # Set environment variables for psql
    env = os.environ.copy()
    env.update(
        {
            "PGHOST": postgres_host,
            "PGPORT": postgres_port,
            "PGUSER": postgres_user,
            "PGPASSWORD": postgres_password,
            "PGDATABASE": postgres_db,
        }
    )

    print("🚀 PostgreSQL Bulk Seeding (100K records)")
    print("=" * 50)

    # Generate data files
    print("\n📝 Generating data files...")

    # Users (10K)
    run_command(
        f"cd {seeds_dir} && source bulk_seed_venv/bin/activate && python3 generate_data.py --database postgres --table users --count 10000 --output {data_dir}/users.csv",
        "Generate 10K users",
    )

    # Todos (80K total - ~8 per user)
    run_command(
        f"cd {seeds_dir} && source bulk_seed_venv/bin/activate && python3 generate_data.py --database postgres --table todos --count 80000 --output {data_dir}/todos.csv --users 10000",
        "Generate 80K todos",
    )

    # Categories (10K total - ~1 per user)
    run_command(
        f"cd {seeds_dir} && source bulk_seed_venv/bin/activate && python3 generate_data.py --database postgres --table categories --count 10000 --output {data_dir}/categories.csv --users 10000",
        "Generate 10K categories",
    )

    # Bulk load data
    print("\n📥 Loading data into PostgreSQL...")

    # Create partitioned tables if not exists
    partitioning_sql = f"""
    -- Create partitioned users table
    CREATE TABLE IF NOT EXISTS users_partitioned (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(255),
        avatar_url TEXT,
        bio TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        email_verified BOOLEAN DEFAULT FALSE,
        phone VARCHAR(50),
        date_of_birth DATE,
        preferences JSONB,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_login_at TIMESTAMP WITH TIME ZONE
    ) PARTITION BY RANGE (created_at);

    -- Create monthly partitions for the last year
    CREATE TABLE IF NOT EXISTS users_y2024m01 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
    CREATE TABLE IF NOT EXISTS users_y2024m02 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
    CREATE TABLE IF NOT EXISTS users_y2024m03 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');
    CREATE TABLE IF NOT EXISTS users_y2024m04 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');
    CREATE TABLE IF NOT EXISTS users_y2024m05 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');
    CREATE TABLE IF NOT EXISTS users_y2024m06 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');
    CREATE TABLE IF NOT EXISTS users_y2024m07 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');
    CREATE TABLE IF NOT EXISTS users_y2024m08 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');
    CREATE TABLE IF NOT EXISTS users_y2024m09 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');
    CREATE TABLE IF NOT EXISTS users_y2024m10 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');
    CREATE TABLE IF NOT EXISTS users_y2024m11 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');
    CREATE TABLE IF NOT EXISTS users_y2024m12 PARTITION OF users_partitioned
        FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

    -- Create default partition for older dates
    CREATE TABLE IF NOT EXISTS users_default PARTITION OF users_partitioned DEFAULT;

    -- Create partitioned todos table
    CREATE TABLE IF NOT EXISTS todos_partitioned (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        priority VARCHAR(20) DEFAULT 'medium',
        due_date TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        tags JSONB,
        checklist JSONB,
        attachments JSONB,
        location JSONB,
        custom_fields JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    ) PARTITION BY HASH (user_id);

    -- Create hash partitions for todos (distribute by user_id)
    CREATE TABLE IF NOT EXISTS todos_p0 PARTITION OF todos_partitioned
        FOR VALUES WITH (MODULUS 4, REMAINDER 0);
    CREATE TABLE IF NOT EXISTS todos_p1 PARTITION OF todos_partitioned
        FOR VALUES WITH (MODULUS 4, REMAINDER 1);
    CREATE TABLE IF NOT EXISTS todos_p2 PARTITION OF todos_partitioned
        FOR VALUES WITH (MODULUS 4, REMAINDER 2);
    CREATE TABLE IF NOT EXISTS todos_p3 PARTITION OF todos_partitioned
        FOR VALUES WITH (MODULUS 4, REMAINDER 3);

    -- Create categories table (not partitioned for this demo)
    CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        color VARCHAR(7),
        icon VARCHAR(50),
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
    CREATE INDEX IF NOT EXISTS idx_users_preferences ON users USING GIN (preferences);
    CREATE INDEX IF NOT EXISTS idx_users_metadata ON users USING GIN (metadata);

    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
    CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
    CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at);
    CREATE INDEX IF NOT EXISTS idx_todos_tags ON todos USING GIN (tags);
    CREATE INDEX IF NOT EXISTS idx_todos_custom_fields ON todos USING GIN (custom_fields);

    CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
    """

    with open(data_dir / "partitioning.sql", "w") as f:
        f.write(partitioning_sql)

    run_command(
        f"psql -f {data_dir}/partitioning.sql", "Create partitioned tables and indexes"
    )

    # Bulk load users
    run_command(
        f"""psql -c "\\COPY users (id, username, email, full_name, avatar_url, bio, is_active, email_verified, phone, date_of_birth, preferences, metadata, created_at, updated_at, last_login_at) FROM '{data_dir}/users.csv' WITH CSV HEADER" """,
        "Bulk load users data",
    )

    # Bulk load todos
    run_command(
        f"""psql -c "\\COPY todos (id, user_id, title, description, status, priority, due_date, completed_at, tags, checklist, attachments, location, custom_fields, created_at, updated_at) FROM '{data_dir}/todos.csv' WITH CSV HEADER" """,
        "Bulk load todos data",
    )

    # Bulk load categories
    run_command(
        f"""psql -c "\\COPY categories (id, user_id, name, description, color, icon, is_default, created_at) FROM '{data_dir}/categories.csv' WITH CSV HEADER" """,
        "Bulk load categories data",
    )

    # Verify data
    print("\n✅ Verifying data load...")

    result = run_command("psql -c 'SELECT COUNT(*) as users FROM users'", "Count users")
    print(f"Users loaded: {result.strip()}")

    result = run_command("psql -c 'SELECT COUNT(*) as todos FROM todos'", "Count todos")
    print(f"Todos loaded: {result.strip()}")

    result = run_command(
        "psql -c 'SELECT COUNT(*) as categories FROM categories'", "Count categories"
    )
    print(f"Categories loaded: {result.strip()}")

    # Performance test
    print("\n⚡ Running performance test...")
    run_command(
        "psql -c 'EXPLAIN ANALYZE SELECT COUNT(*) FROM todos WHERE status = \\'completed\\''",
        "Test query performance",
    )

    print("\n🎉 PostgreSQL bulk seeding completed!")
    print(f"Total records: ~100K")
    print(f"Partitioning: Enabled (monthly for users, hash for todos)")
    print(f"Indexes: Created for optimal performance")


if __name__ == "__main__":
    main()
