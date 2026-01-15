#!/usr/bin/env python3
"""
Bulk Data Generator for QueryPilot Test Environment
Generates realistic test data with Lorem content for all database types.

Usage:
    python generate_data.py --database postgres --count 100000 --output data/postgres/users.csv
    python generate_data.py --database mongodb --count 250000 --output data/mongodb/users.jsonl
"""

import argparse
import json
import csv
import uuid
import random
from datetime import datetime, timedelta
from typing import Dict, List, Any, Generator
import sys

try:
    from faker import Faker
except ImportError:
    print("ERROR: faker library required. Install with: pip install faker")
    sys.exit(1)

fake = Faker()

class DataGenerator:
    """Generate realistic test data for various database types."""

    def __init__(self, seed: int = 42):
        random.seed(seed)
        Faker.seed(seed)
        self.fake = Faker()

    def generate_user(self, user_id: int) -> Dict[str, Any]:
        """Generate a single user record."""
        created_at = self.fake.date_time_between(start_date='-1y', end_date='now')
        return {
            'id': user_id,
            'username': self.fake.user_name(),
            'email': self.fake.email(),
            'full_name': self.fake.name(),
            'avatar_url': f"https://avatar.example.com/user{user_id}.jpg",
            'bio': self.fake.paragraph(nb_sentences=3) if random.random() > 0.3 else None,
            'is_active': random.choice([True, False]),
            'email_verified': random.choice([True, False]),
            'phone': self.fake.phone_number() if random.random() > 0.5 else None,
            'date_of_birth': self.fake.date_of_birth(minimum_age=18, maximum_age=80).isoformat() if random.random() > 0.4 else None,
            'preferences': json.dumps({
                'theme': random.choice(['light', 'dark', 'auto']),
                'notifications': random.choice([True, False]),
                'language': random.choice(['en', 'es', 'fr', 'de'])
            }),
            'metadata': json.dumps({
                'signup_source': random.choice(['web', 'mobile', 'api']),
                'last_ip': self.fake.ipv4() if random.random() > 0.3 else None,
                'device_count': random.randint(1, 5)
            }),
            'created_at': created_at.isoformat(),
            'updated_at': created_at.isoformat(),
            'last_login_at': self.fake.date_time_between(start_date=created_at, end_date='now').isoformat() if random.random() > 0.2 else None
        }

    def generate_todo(self, todo_id: int, user_id: int) -> Dict[str, Any]:
        """Generate a single todo record."""
        created_at = self.fake.date_time_between(start_date='-1y', end_date='now')
        due_date = self.fake.date_time_between(start_date='now', end_date='+6M') if random.random() > 0.3 else None

        return {
            'id': todo_id,
            'user_id': user_id,
            'title': self.fake.sentence(nb_words=random.randint(3, 8)).rstrip('.'),
            'description': self.fake.paragraph(nb_sentences=random.randint(1, 3)) if random.random() > 0.4 else None,
            'status': random.choice(['pending', 'in_progress', 'completed', 'cancelled']),
            'priority': random.choice(['low', 'medium', 'high', 'urgent']),
            'due_date': due_date.isoformat() if due_date else None,
            'completed_at': self.fake.date_time_between(start_date=created_at, end_date='now').isoformat() if random.random() > 0.6 else None,
            'tags': json.dumps([self.fake.word() for _ in range(random.randint(0, 5))]),
            'checklist': json.dumps([
                {'item': self.fake.sentence(nb_words=4).rstrip('.'), 'completed': random.choice([True, False])}
                for _ in range(random.randint(0, 3))
            ]),
            'attachments': json.dumps([
                {'name': self.fake.file_name(), 'url': f"https://files.example.com/{uuid.uuid4()}", 'size': random.randint(1000, 1000000)}
                for _ in range(random.randint(0, 2))
            ]),
            'location': json.dumps({
                'latitude': float(self.fake.latitude()),
                'longitude': float(self.fake.longitude()),
                'address': self.fake.address().replace('\n', ', ')
            }) if random.random() > 0.7 else None,
            'custom_fields': json.dumps({
                'estimated_hours': random.randint(1, 40) if random.random() > 0.5 else None,
                'actual_hours': random.randint(1, 80) if random.random() > 0.6 else None,
                'difficulty': random.choice(['easy', 'medium', 'hard']) if random.random() > 0.4 else None
            }),
            'created_at': created_at.isoformat(),
            'updated_at': created_at.isoformat()
        }

    def generate_category(self, category_id: int, user_id: int) -> Dict[str, Any]:
        """Generate a single category record."""
        return {
            'id': category_id,
            'user_id': user_id,
            'name': self.fake.word().capitalize(),
            'description': self.fake.sentence(nb_words=6).rstrip('.') if random.random() > 0.3 else None,
            'color': f"#{random.randint(0, 0xFFFFFF):06x}",
            'icon': random.choice(['folder', 'star', 'heart', 'tag', 'flag', 'bookmark']),
            'is_default': random.choice([True, False]),
            'created_at': self.fake.date_time_between(start_date='-1y', end_date='now').isoformat()
        }

    def generate_users(self, count: int) -> Generator[Dict[str, Any], None, None]:
        """Generate users."""
        for i in range(1, count + 1):
            yield self.generate_user(i)

    def generate_todos_for_users(self, user_ids: List[int], todos_per_user: int = 50) -> Generator[Dict[str, Any], None, None]:
        """Generate todos for given users."""
        todo_id = 1
        for user_id in user_ids:
            todo_count = random.randint(todos_per_user // 2, todos_per_user * 2)
            for _ in range(todo_count):
                yield self.generate_todo(todo_id, user_id)
                todo_id += 1

    def generate_categories_for_users(self, user_ids: List[int], categories_per_user: int = 5) -> Generator[Dict[str, Any], None, None]:
        """Generate categories for given users."""
        category_id = 1
        for user_id in user_ids:
            cat_count = random.randint(1, categories_per_user)
            for _ in range(cat_count):
                yield self.generate_category(category_id, user_id)
                category_id += 1

    def save_to_csv(self, data: Generator[Dict[str, Any], None, None], filename: str, fields: List[str]):
        """Save data to CSV format."""
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for row in data:
                # Convert JSON fields to strings for CSV
                row_copy = row.copy()
                for field in fields:
                    if isinstance(row_copy.get(field), (dict, list)):
                        row_copy[field] = json.dumps(row_copy[field])
                writer.writerow(row_copy)

    def save_to_jsonl(self, data: Generator[Dict[str, Any], None, None], filename: str):
        """Save data to JSON Lines format."""
        with open(filename, 'w', encoding='utf-8') as f:
            for item in data:
                json.dump(item, f, ensure_ascii=False)
                f.write('\n')

    def save_to_sql_inserts(self, data: Generator[Dict[str, Any], None, None], filename: str, table: str, fields: List[str], batch_size: int = 1000):
        """Save data as SQL INSERT statements."""
        with open(filename, 'w', encoding='utf-8') as f:
            batch = []
            for item in data:
                batch.append(item)
                if len(batch) >= batch_size:
                    self._write_sql_batch(f, table, fields, batch)
                    batch = []
            if batch:
                self._write_sql_batch(f, table, fields, batch)

    def _write_sql_batch(self, f, table: str, fields: List[str], batch: List[Dict[str, Any]]):
        """Write a batch of SQL INSERT statements."""
        values_list = []
        for item in batch:
            values = []
            for field in fields:
                value = item.get(field)
                if value is None:
                    values.append('NULL')
                elif isinstance(value, str):
                    values.append(f"'{value.replace(\"'\", \"''\")}'")
                elif isinstance(value, bool):
                    values.append('TRUE' if value else 'FALSE')
                elif isinstance(value, (dict, list)):
                    values.append(f"'{json.dumps(value).replace(\"'\", \"''\")}'")
                else:
                    values.append(str(value))
            values_list.append(f"({', '.join(values)})")

        f.write(f"INSERT INTO {table} ({', '.join(fields)}) VALUES\n")
        f.write(',\n'.join(values_list))
        f.write(';\n\n')

def main():
    parser = argparse.ArgumentParser(description='Generate bulk test data for QueryPilot')
    parser.add_argument('--database', required=True, choices=['postgres', 'mysql', 'mariadb', 'mongodb', 'redis', 'sqlserver'],
                       help='Target database type')
    parser.add_argument('--table', required=True, choices=['users', 'todos', 'categories'],
                       help='Table/entity to generate')
    parser.add_argument('--count', type=int, required=True,
                       help='Number of records to generate')
    parser.add_argument('--output', required=True,
                       help='Output file path')
    parser.add_argument('--format', choices=['csv', 'jsonl', 'sql'], default='csv',
                       help='Output format (default: csv)')
    parser.add_argument('--users', type=int, default=1000,
                       help='Number of users to generate todos/categories for (when table=todos or categories)')
    parser.add_argument('--seed', type=int, default=42,
                       help='Random seed for reproducible data')

    args = parser.parse_args()

    generator = DataGenerator(seed=args.seed)

    # Define field mappings for each database/table combination
    field_mappings = {
        'postgres': {
            'users': ['id', 'username', 'email', 'full_name', 'avatar_url', 'bio', 'is_active', 'email_verified',
                     'phone', 'date_of_birth', 'preferences', 'metadata', 'created_at', 'updated_at', 'last_login_at'],
            'todos': ['id', 'user_id', 'title', 'description', 'status', 'priority', 'due_date', 'completed_at',
                     'tags', 'checklist', 'attachments', 'location', 'custom_fields', 'created_at', 'updated_at'],
            'categories': ['id', 'user_id', 'name', 'description', 'color', 'icon', 'is_default', 'created_at']
        },
        'mysql': {
            'users': ['id', 'username', 'email', 'full_name', 'avatar_url', 'bio', 'is_active', 'email_verified',
                     'phone', 'date_of_birth', 'preferences', 'metadata', 'created_at', 'updated_at', 'last_login_at'],
            'todos': ['id', 'user_id', 'title', 'description', 'status', 'priority', 'due_date', 'completed_at',
                     'tags', 'checklist', 'attachments', 'location', 'custom_fields', 'created_at', 'updated_at'],
            'categories': ['id', 'user_id', 'name', 'description', 'color', 'icon', 'is_default', 'created_at']
        },
        'mariadb': {
            'users': ['id', 'username', 'email', 'full_name', 'avatar_url', 'bio', 'is_active', 'email_verified',
                     'phone', 'date_of_birth', 'preferences', 'metadata', 'created_at', 'updated_at', 'last_login_at'],
            'todos': ['id', 'user_id', 'title', 'description', 'status', 'priority', 'due_date', 'completed_at',
                     'tags', 'checklist', 'attachments', 'location', 'custom_fields', 'created_at', 'updated_at'],
            'categories': ['id', 'user_id', 'name', 'description', 'color', 'icon', 'is_default', 'created_at']
        },
        'sqlserver': {
            'users': ['id', 'username', 'email', 'full_name', 'avatar_url', 'bio', 'is_active', 'email_verified',
                     'phone', 'date_of_birth', 'preferences', 'metadata', 'created_at', 'updated_at', 'last_login_at'],
            'todos': ['id', 'user_id', 'title', 'description', 'status', 'priority', 'due_date', 'completed_at',
                     'tags', 'checklist', 'attachments', 'location', 'custom_fields', 'created_at', 'updated_at'],
            'categories': ['id', 'user_id', 'name', 'description', 'color', 'icon', 'is_default', 'created_at']
        },
        'mongodb': {
            'users': ['_id', 'username', 'email', 'full_name', 'avatar_url', 'bio', 'is_active', 'email_verified',
                     'phone', 'date_of_birth', 'preferences', 'metadata', 'created_at', 'updated_at', 'last_login_at'],
            'todos': ['_id', 'user_id', 'title', 'description', 'status', 'priority', 'due_date', 'completed_at',
                     'tags', 'checklist', 'attachments', 'location', 'custom_fields', 'created_at', 'updated_at'],
            'categories': ['_id', 'user_id', 'name', 'description', 'color', 'icon', 'is_default', 'created_at']
        }
    }

    fields = field_mappings[args.database][args.table]

    print(f"Generating {args.count} {args.table} records for {args.database}...")

    if args.table == 'users':
        data = generator.generate_users(args.count)
    elif args.table == 'todos':
        user_ids = list(range(1, args.users + 1))
        data = generator.generate_todos_for_users(user_ids, args.count // args.users)
    elif args.table == 'categories':
        user_ids = list(range(1, args.users + 1))
        data = generator.generate_categories_for_users(user_ids, args.count // args.users)

    # Convert to list to allow multiple iterations if needed
    data_list = list(data)

    if args.format == 'csv':
        generator.save_to_csv(data_list, args.output, fields)
    elif args.format == 'jsonl':
        generator.save_to_jsonl(data_list, args.output)
    elif args.format == 'sql':
        generator.save_to_sql_inserts(data_list, args.output, args.table, fields)

    print(f"Generated {len(data_list)} records saved to {args.output}")

if __name__ == '__main__':
    main()