// Storage layer tests

use std::collections::HashMap;

#[test]
fn test_hashmap_storage() {
    let mut storage: HashMap<String, String> = HashMap::new();

    // Test insert
    storage.insert("key1".to_string(), "value1".to_string());
    assert_eq!(storage.len(), 1);

    // Test get
    assert_eq!(storage.get("key1"), Some(&"value1".to_string()));

    // Test update
    storage.insert("key1".to_string(), "updated_value".to_string());
    assert_eq!(storage.get("key1"), Some(&"updated_value".to_string()));

    // Test delete
    let removed = storage.remove("key1");
    assert_eq!(removed, Some("updated_value".to_string()));
    assert_eq!(storage.len(), 0);
}

#[test]
fn test_storage_contains_key() {
    let mut storage: HashMap<String, i32> = HashMap::new();

    storage.insert("age".to_string(), 25);
    storage.insert("count".to_string(), 100);

    assert!(storage.contains_key("age"));
    assert!(storage.contains_key("count"));
    assert!(!storage.contains_key("name"));
}

#[test]
fn test_storage_iteration() {
    let mut storage: HashMap<String, i32> = HashMap::new();
    storage.insert("a".to_string(), 1);
    storage.insert("b".to_string(), 2);
    storage.insert("c".to_string(), 3);

    let sum: i32 = storage.values().sum();
    assert_eq!(sum, 6);

    let keys: Vec<&String> = storage.keys().collect();
    assert_eq!(keys.len(), 3);
}

#[test]
fn test_storage_entry_api() {
    let mut storage: HashMap<String, i32> = HashMap::new();

    // Insert if not exists
    storage.entry("counter".to_string()).or_insert(0);
    assert_eq!(storage.get("counter"), Some(&0));

    // Modify existing entry
    *storage.entry("counter".to_string()).or_insert(0) += 1;
    assert_eq!(storage.get("counter"), Some(&1));
}

#[test]
fn test_storage_clear() {
    let mut storage: HashMap<String, String> = HashMap::new();
    storage.insert("key1".to_string(), "value1".to_string());
    storage.insert("key2".to_string(), "value2".to_string());

    assert_eq!(storage.len(), 2);

    storage.clear();
    assert_eq!(storage.len(), 0);
    assert!(storage.is_empty());
}

#[test]
fn test_storage_retain() {
    let mut storage: HashMap<String, i32> = HashMap::new();
    storage.insert("a".to_string(), 1);
    storage.insert("b".to_string(), 2);
    storage.insert("c".to_string(), 3);
    storage.insert("d".to_string(), 4);

    // Keep only values greater than 2
    storage.retain(|_, &mut v| v > 2);

    assert_eq!(storage.len(), 2);
    assert!(!storage.contains_key("a"));
    assert!(!storage.contains_key("b"));
    assert!(storage.contains_key("c"));
    assert!(storage.contains_key("d"));
}

#[test]
fn test_vec_storage() {
    let mut storage: Vec<String> = Vec::new();

    // Add items
    storage.push("item1".to_string());
    storage.push("item2".to_string());
    storage.push("item3".to_string());

    assert_eq!(storage.len(), 3);
    assert_eq!(storage[0], "item1");
    assert_eq!(storage[1], "item2");
    assert_eq!(storage[2], "item3");

    // Remove item
    let removed = storage.remove(1);
    assert_eq!(removed, "item2");
    assert_eq!(storage.len(), 2);
}

#[test]
fn test_vec_storage_search() {
    let storage = vec!["apple", "banana", "cherry", "date"];

    assert!(storage.contains(&"banana"));
    assert!(!storage.contains(&"grape"));

    let position = storage.iter().position(|&x| x == "cherry");
    assert_eq!(position, Some(2));
}

#[test]
fn test_storage_serialization() {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct StorageItem {
        id: String,
        data: String,
    }

    let item = StorageItem {
        id: "1".to_string(),
        data: "test data".to_string(),
    };

    // Serialize
    let json = serde_json::to_string(&item).unwrap();
    assert!(json.contains("test data"));

    // Deserialize
    let deserialized: StorageItem = serde_json::from_str(&json).unwrap();
    assert_eq!(item, deserialized);
}

#[test]
fn test_storage_batch_operations() {
    let mut storage: HashMap<String, i32> = HashMap::new();

    // Batch insert
    let items = vec![
        ("key1".to_string(), 1),
        ("key2".to_string(), 2),
        ("key3".to_string(), 3),
    ];

    for (k, v) in items {
        storage.insert(k, v);
    }

    assert_eq!(storage.len(), 3);

    // Batch update
    for value in storage.values_mut() {
        *value *= 2;
    }

    assert_eq!(storage.get("key1"), Some(&2));
    assert_eq!(storage.get("key2"), Some(&4));
    assert_eq!(storage.get("key3"), Some(&6));
}
