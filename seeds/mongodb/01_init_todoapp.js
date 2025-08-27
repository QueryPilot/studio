// MongoDB initialization script for todoapp database
// This script creates comprehensive test data with all BSON types

db = db.getSiblingDB('todoapp');

// Drop existing collections if they exist
db.users.drop();
db.todos.drop();
db.categories.drop();
db.complex_types.drop();
db.nested_documents.drop();
db.array_examples.drop();
db.edge_cases.drop();

// 1. Users collection - Basic document structure
db.users.insertMany([
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef0"),
    username: "john_doe",
    email: "john@example.com",
    age: 30,
    active: true,
    created_at: new Date("2023-01-15T10:30:00Z"),
    last_login: new Date(),
    profile: {
      firstName: "John",
      lastName: "Doe",
      bio: "Software developer",
      avatar_url: "https://example.com/avatar/john.jpg"
    },
    tags: ["developer", "javascript", "react"],
    settings: {
      theme: "dark",
      notifications: {
        email: true,
        push: false,
        sms: null
      }
    }
  },
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef1"),
    username: "jane_smith",
    email: "jane@example.com",
    age: 28,
    active: false,
    created_at: new Date("2023-02-20T14:45:00Z"),
    last_login: null,
    profile: {
      firstName: "Jane",
      lastName: "Smith",
      bio: null,
      avatar_url: ""
    },
    tags: [],
    settings: {
      theme: "light",
      notifications: {
        email: false,
        push: true
      }
    }
  }
]);

// 2. Todos collection - Mixed data types
db.todos.insertMany([
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef2"),
    title: "Complete MongoDB adapter",
    description: "Implement all BSON data types support",
    user_id: ObjectId("64a1b2c3d4e5f6789abcdef0"),
    priority: NumberInt(1),
    estimated_hours: NumberDecimal("8.5"),
    completed: false,
    due_date: new Date("2024-01-30T23:59:59Z"),
    created_at: ISODate("2024-01-15T09:00:00.000Z"),
    updated_at: new Timestamp(1705392000, 1),
    tags: ["mongodb", "rust", "backend"],
    metadata: {
      complexity: "high",
      category_id: ObjectId("64a1b2c3d4e5f6789abcdef3"),
      attachments: [
        {
          name: "spec.pdf",
          size: NumberLong("1048576"),
          mime_type: "application/pdf",
          uploaded_at: new Date()
        }
      ]
    }
  },
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef4"),
    title: "Write unit tests",
    description: "Create comprehensive test suite",
    user_id: ObjectId("64a1b2c3d4e5f6789abcdef1"),
    priority: NumberInt(2),
    estimated_hours: NumberDecimal("12.0"),
    completed: true,
    due_date: null,
    created_at: ISODate("2024-01-10T12:00:00.000Z"),
    updated_at: new Timestamp(1705478400, 2),
    tags: ["testing", "jest"],
    metadata: {
      complexity: "medium",
      category_id: null
    }
  }
]);

// 3. Categories collection - Simple reference data
db.categories.insertMany([
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef3"),
    name: "Development",
    color: "#3498db",
    created_at: new Date(),
    parent_id: null
  },
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef5"),
    name: "Testing",
    color: "#e74c3c",
    created_at: new Date(),
    parent_id: ObjectId("64a1b2c3d4e5f6789abcdef3")
  }
]);

// 4. Complex types collection - All BSON types demonstration
db.complex_types.insertMany([
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef6"),
    
    // String types
    regular_string: "Hello MongoDB",
    empty_string: "",
    unicode_string: "🚀 MongoDB with emojis 中文 العربية",
    multiline_string: "Line 1\nLine 2\nLine 3",
    
    // Numeric types
    int32_value: NumberInt(42),
    int64_value: NumberLong("9223372036854775807"),
    double_value: 3.14159265359,
    decimal128_value: NumberDecimal("123456789.123456789"),
    negative_int: NumberInt(-100),
    zero_value: NumberInt(0),
    infinity_value: Infinity,
    negative_infinity: -Infinity,
    
    // Boolean
    bool_true: true,
    bool_false: false,
    
    // Dates and Timestamps
    current_date: new Date(),
    specific_date: ISODate("2024-01-15T10:30:45.123Z"),
    timestamp_value: new Timestamp(1705392000, 5),
    min_date: ISODate("1970-01-01T00:00:00.000Z"),
    max_date: ISODate("2038-01-19T03:14:07.999Z"),
    
    // ObjectId variations
    object_id: ObjectId(),
    specific_object_id: ObjectId("507f1f77bcf86cd799439011"),
    
    // Binary data
    binary_data: BinData(0, "SGVsbG8gV29ybGQ="),
    uuid_binary: BinData(3, "c//SRK+4QlaXBcJNGHAkEA=="),
    
    // Regular expressions
    regex_pattern: /^[a-z]+$/i,
    email_regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    
    // JavaScript code
    js_code: Code("function() { return this.name; }"),
    js_with_scope: Code("function(x) { return x + offset; }", { offset: 10 }),
    
    // Special values
    null_value: null,
    undefined_value: undefined,
    min_key: MinKey(),
    max_key: MaxKey(),
    
    // Symbol (deprecated but still possible)
    symbol_value: Symbol("test_symbol")
  }
]);

// 5. Nested documents collection - Deep nesting examples
db.nested_documents.insertMany([
  {
    _id: ObjectId(),
    name: "Complex Organization",
    structure: {
      departments: {
        engineering: {
          teams: {
            backend: {
              members: [
                {
                  name: "Alice",
                  role: "Senior Engineer",
                  skills: ["rust", "mongodb", "docker"],
                  experience: {
                    years: NumberInt(5),
                    previous_companies: [
                      { name: "TechCorp", duration: "2 years" },
                      { name: "StartupInc", duration: "3 years" }
                    ]
                  }
                }
              ],
              budget: NumberDecimal("250000.00"),
              projects: {
                active: NumberInt(3),
                completed: NumberInt(12)
              }
            },
            frontend: {
              members: [],
              budget: NumberDecimal("180000.00"),
              projects: {
                active: NumberInt(2),
                completed: NumberInt(8)
              }
            }
          },
          total_budget: NumberDecimal("430000.00")
        },
        marketing: {
          budget: NumberDecimal("150000.00"),
          campaigns: {
            q1_2024: {
              budget: NumberDecimal("50000.00"),
              channels: ["social", "email", "ppc"],
              performance: {
                impressions: NumberLong("1500000"),
                clicks: NumberLong("45000"),
                conversions: NumberInt(1200)
              }
            }
          }
        }
      },
      metadata: {
        created_by: ObjectId("64a1b2c3d4e5f6789abcdef0"),
        created_at: new Date(),
        version: NumberInt(1),
        tags: ["organization", "structure", "nested"]
      }
    }
  }
]);

// 6. Array examples collection - Various array types
db.array_examples.insertMany([
  {
    _id: ObjectId(),
    name: "Array Type Examples",
    
    // Arrays of primitives
    string_array: ["apple", "banana", "cherry"],
    number_array: [NumberInt(1), NumberInt(2), NumberInt(3), NumberInt(4)],
    mixed_numbers: [NumberInt(42), NumberLong("9999999999"), 3.14, NumberDecimal("123.456")],
    boolean_array: [true, false, true],
    date_array: [new Date(), ISODate("2024-01-15T00:00:00.000Z")],
    objectid_array: [ObjectId(), ObjectId(), ObjectId()],
    
    // Empty and null arrays
    empty_array: [],
    array_with_nulls: [null, "value", null, NumberInt(42), null],
    
    // Arrays of objects
    object_array: [
      { name: "Item 1", value: NumberInt(10), active: true },
      { name: "Item 2", value: NumberInt(20), active: false },
      { name: "Item 3", value: NumberDecimal("15.5"), active: true }
    ],
    
    // Nested arrays
    nested_arrays: [
      [NumberInt(1), NumberInt(2)],
      [NumberInt(3), NumberInt(4)],
      []
    ],
    
    // Array of mixed types
    mixed_array: [
      "string",
      NumberInt(42),
      true,
      new Date(),
      ObjectId(),
      { nested: "object" },
      [NumberInt(1), NumberInt(2)],
      null,
      NumberDecimal("99.99")
    ],
    
    // Large array for performance testing
    large_array: Array.from({length: 1000}, (_, i) => ({
      index: NumberInt(i),
      value: `item_${i}`,
      timestamp: new Date()
    }))
  }
]);

// 7. Edge cases collection - Boundary conditions and special cases
db.edge_cases.insertMany([
  {
    _id: ObjectId(),
    name: "String Edge Cases",
    very_long_string: "A".repeat(1000),
    string_with_quotes: 'String with "quotes" and \'apostrophes\'',
    string_with_escapes: "Line 1\n\tTabbed line\n\"Quoted\"\n\\Backslash",
    json_like_string: '{"key": "value", "number": 123}',
    xml_like_string: '<root><item id="1">Value</item></root>',
    sql_like_string: "SELECT * FROM users WHERE name = 'John';"
  },
  {
    _id: ObjectId(),
    name: "Numeric Edge Cases",
    max_int32: NumberInt(2147483647),
    min_int32: NumberInt(-2147483648),
    max_int64: NumberLong("9223372036854775807"),
    min_int64: NumberLong("-9223372036854775808"),
    very_small_decimal: NumberDecimal("0.000000000000000001"),
    very_large_decimal: NumberDecimal("9999999999999999.999999999999"),
    scientific_notation: 1.23e10,
    negative_zero: -0.0
  },
  {
    _id: ObjectId(),
    name: "Date Edge Cases",
    epoch_start: ISODate("1970-01-01T00:00:00.000Z"),
    year_2038_problem: ISODate("2038-01-19T03:14:07.999Z"),
    leap_year_date: ISODate("2024-02-29T12:00:00.000Z"),
    end_of_year: ISODate("2023-12-31T23:59:59.999Z"),
    future_date: ISODate("2124-01-01T00:00:00.000Z")
  },
  {
    _id: ObjectId(),
    name: "Binary Edge Cases",
    empty_binary: BinData(0, ""),
    large_binary: BinData(0, btoa("X".repeat(1000))),
    uuid_v4: UUID("550e8400-e29b-41d4-a716-446655440000"),
    custom_binary: BinData(128, "Y3VzdG9tIGRhdGE=")
  },
  {
    _id: ObjectId(),
    name: "Special Character Cases",
    emoji_field: "🎉✨🚀💾🔧",
    chinese_text: "这是中文文本",
    arabic_text: "هذا نص عربي",
    japanese_text: "これは日本語のテキストです",
    russian_text: "Это русский текст",
    special_chars: "!@#$%^&*()_+-=[]{}|;:,.<>?",
    zero_width_chars: "Zero\u200Bwidth\u200Cchars"
  }
]);

// Create indexes for better query performance and testing
db.users.createIndex({ "username": 1 }, { unique: true });
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "created_at": -1 });
db.users.createIndex({ "profile.firstName": 1, "profile.lastName": 1 });

db.todos.createIndex({ "user_id": 1 });
db.todos.createIndex({ "due_date": 1 });
db.todos.createIndex({ "completed": 1, "priority": 1 });
db.todos.createIndex({ "tags": 1 });
db.todos.createIndex({ "$**": "text" }); // Text index for full-text search

db.categories.createIndex({ "parent_id": 1 });

db.nested_documents.createIndex({ "structure.departments.engineering.budget": 1 });
db.nested_documents.createIndex({ "structure.metadata.created_at": -1 });

db.array_examples.createIndex({ "object_array.name": 1 });
db.array_examples.createIndex({ "string_array": 1 });

// Sparse indexes for fields that may not exist in all documents
db.todos.createIndex({ "metadata.category_id": 1 }, { sparse: true });
db.users.createIndex({ "last_login": 1 }, { sparse: true });

// Compound indexes for complex queries
db.todos.createIndex({ "user_id": 1, "completed": 1, "priority": -1 });
db.users.createIndex({ "active": 1, "created_at": -1 });

print("MongoDB todoapp database initialized with comprehensive test data");
print("Collections created: users, todos, categories, complex_types, nested_documents, array_examples, edge_cases");
print("Indexes created for optimal query performance");

// Print collection counts for verification
print("Collection document counts:");
print("- users: " + db.users.countDocuments());
print("- todos: " + db.todos.countDocuments());
print("- categories: " + db.categories.countDocuments());
print("- complex_types: " + db.complex_types.countDocuments());
print("- nested_documents: " + db.nested_documents.countDocuments());
print("- array_examples: " + db.array_examples.countDocuments());
print("- edge_cases: " + db.edge_cases.countDocuments());