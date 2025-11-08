// Utility function tests

#[test]
fn test_basic_math() {
    assert_eq!(2 + 2, 4);
    assert_eq!(10 - 5, 5);
    assert_eq!(3 * 4, 12);
    assert_eq!(15 / 3, 5);
}

#[test]
fn test_string_operations() {
    let s = "hello world";
    assert_eq!(s.to_uppercase(), "HELLO WORLD");
    assert_eq!(s.to_lowercase(), "hello world");
    assert_eq!(s.len(), 11);
    assert!(s.contains("world"));
}

#[test]
fn test_vec_operations() {
    let mut v = vec![1, 2, 3];
    assert_eq!(v.len(), 3);

    v.push(4);
    assert_eq!(v.len(), 4);
    assert_eq!(v[3], 4);

    let popped = v.pop();
    assert_eq!(popped, Some(4));
    assert_eq!(v.len(), 3);
}

#[test]
fn test_option_handling() {
    let some_value: Option<i32> = Some(42);
    let none_value: Option<i32> = None;

    assert!(some_value.is_some());
    assert!(!some_value.is_none());
    assert_eq!(some_value.unwrap(), 42);

    assert!(none_value.is_none());
    assert!(!none_value.is_some());
    assert_eq!(none_value.unwrap_or(0), 0);
}

#[test]
fn test_result_handling() {
    fn divide(a: i32, b: i32) -> Result<i32, String> {
        if b == 0 {
            Err("Division by zero".to_string())
        } else {
            Ok(a / b)
        }
    }

    assert_eq!(divide(10, 2), Ok(5));
    assert!(divide(10, 0).is_err());
}

#[test]
fn test_hashmap_operations() {
    use std::collections::HashMap;

    let mut map = HashMap::new();
    map.insert("key1", "value1");
    map.insert("key2", "value2");

    assert_eq!(map.len(), 2);
    assert_eq!(map.get("key1"), Some(&"value1"));
    assert_eq!(map.get("nonexistent"), None);
    assert!(map.contains_key("key1"));
    assert!(!map.contains_key("key3"));
}

#[test]
fn test_iterator_operations() {
    let numbers = vec![1, 2, 3, 4, 5];

    let sum: i32 = numbers.iter().sum();
    assert_eq!(sum, 15);

    let doubled: Vec<i32> = numbers.iter().map(|x| x * 2).collect();
    assert_eq!(doubled, vec![2, 4, 6, 8, 10]);

    let evens: Vec<&i32> = numbers.iter().filter(|x| *x % 2 == 0).collect();
    assert_eq!(evens, vec![&2, &4]);
}

#[test]
fn test_slice_operations() {
    let array = [1, 2, 3, 4, 5];
    let slice = &array[1..4];

    assert_eq!(slice.len(), 3);
    assert_eq!(slice, &[2, 3, 4]);
}

#[test]
fn test_string_split() {
    let text = "one,two,three";
    let parts: Vec<&str> = text.split(',').collect();

    assert_eq!(parts.len(), 3);
    assert_eq!(parts[0], "one");
    assert_eq!(parts[1], "two");
    assert_eq!(parts[2], "three");
}

#[test]
fn test_formatting() {
    let formatted = format!("Hello, {}!", "world");
    assert_eq!(formatted, "Hello, world!");

    let num_formatted = format!("The answer is {}", 42);
    assert_eq!(num_formatted, "The answer is 42");
}
