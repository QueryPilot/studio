use crate::types::CellValueType;
use crate::error::{AppError, Result};
use serde_json::{json, Value as JsonValue};
use std::collections::HashMap;

pub struct PostgresTypeParser;

impl PostgresTypeParser {
    /// Parse PostgreSQL range type string like "[1,10)" or "(2020-01-01,2020-12-31]"
    pub fn parse_range(input: &str, base_type: &CellValueType) -> Result<JsonValue> {
        let trimmed = input.trim();
        if trimmed == "empty" {
            return Ok(json!({
                "empty": true
            }));
        }
        
        // Check bounds - first char is lower bound, last is upper bound
        let lower_inclusive = trimmed.starts_with('[');
        let upper_inclusive = trimmed.ends_with(']');
        
        // Remove bounds characters
        let content = &trimmed[1..trimmed.len()-1];
        
        // Split by comma, handling quoted values
        let parts: Vec<&str> = split_pg_tuple(content);
        
        if parts.len() != 2 {
            return Err(AppError::ParseError(format!("Invalid range format: {}", input)));
        }
        
        Ok(json!({
            "lower": if parts[0].is_empty() { JsonValue::Null } else { JsonValue::String(parts[0].to_string()) },
            "upper": if parts[1].is_empty() { JsonValue::Null } else { JsonValue::String(parts[1].to_string()) },
            "lower_inclusive": lower_inclusive,
            "upper_inclusive": upper_inclusive,
            "type": format!("{:?}", base_type)
        }))
    }
    
    /// Parse PostgreSQL multirange type string like "{[1,2),[5,10]}"
    pub fn parse_multirange(input: &str, base_type: &CellValueType) -> Result<JsonValue> {
        let trimmed = input.trim();
        if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
            return Err(AppError::ParseError(format!("Invalid multirange format: {}", input)));
        }
        
        let content = &trimmed[1..trimmed.len()-1];
        if content.is_empty() {
            return Ok(json!({ "ranges": [] }));
        }
        
        // Parse each range
        let mut ranges = Vec::new();
        let mut current = String::new();
        let mut depth = 0;
        
        for ch in content.chars() {
            match ch {
                '[' | '(' => {
                    depth += 1;
                    current.push(ch);
                },
                ']' | ')' => {
                    depth -= 1;
                    current.push(ch);
                    if depth == 0 && !current.is_empty() {
                        ranges.push(Self::parse_range(&current, base_type)?);
                        current.clear();
                    }
                },
                ',' if depth == 0 => {
                    // Skip commas between ranges
                },
                _ => current.push(ch),
            }
        }
        
        Ok(json!({ "ranges": ranges }))
    }
    
    /// Parse PostgreSQL composite type string like "(value1,value2,value3)"
    pub fn parse_composite(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
            return Err(AppError::ParseError(format!("Invalid composite format: {}", input)));
        }
        
        let content = &trimmed[1..trimmed.len()-1];
        let fields = split_pg_tuple(content);
        
        Ok(json!({ "fields": fields }))
    }
    
    /// Parse PostgreSQL multi-dimensional array like "{{1,2},{3,4}}" or "{a,b,c}"
    pub fn parse_array(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
            return Err(AppError::ParseError(format!("Invalid array format: {}", input)));
        }
        
        // Parse recursively for multi-dimensional arrays
        parse_array_recursive(&trimmed[1..trimmed.len()-1])
    }
    
    /// Parse PostgreSQL point type "(x,y)"
    pub fn parse_point(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
            return Err(AppError::ParseError(format!("Invalid point format: {}", input)));
        }
        
        let content = &trimmed[1..trimmed.len()-1];
        let parts: Vec<&str> = content.split(',').map(|s| s.trim()).collect();
        
        if parts.len() != 2 {
            return Err(AppError::ParseError(format!("Invalid point format: {}", input)));
        }
        
        Ok(json!({
            "x": parts[0].parse::<f64>().unwrap_or(0.0),
            "y": parts[1].parse::<f64>().unwrap_or(0.0)
        }))
    }
    
    /// Parse PostgreSQL line segment "[(x1,y1),(x2,y2)]"
    pub fn parse_lseg(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
            return Err(AppError::ParseError(format!("Invalid lseg format: {}", input)));
        }
        
        let content = &trimmed[1..trimmed.len()-1];
        let points = parse_point_list(content)?;
        
        if points.len() != 2 {
            return Err(AppError::ParseError(format!("Invalid lseg format: {}", input)));
        }
        
        Ok(json!({
            "start": points[0],
            "end": points[1]
        }))
    }
    
    /// Parse PostgreSQL box "((x1,y1),(x2,y2))"
    pub fn parse_box(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
            return Err(AppError::ParseError(format!("Invalid box format: {}", input)));
        }
        
        let content = &trimmed[1..trimmed.len()-1];
        let points = parse_point_list(content)?;
        
        if points.len() != 2 {
            return Err(AppError::ParseError(format!("Invalid box format: {}", input)));
        }
        
        Ok(json!({
            "upper_right": points[0],
            "lower_left": points[1]
        }))
    }
    
    /// Parse PostgreSQL path "[(x1,y1),(x2,y2),...]" or "((x1,y1),(x2,y2),...)"
    pub fn parse_path(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        let (is_closed, content) = if trimmed.starts_with('[') && trimmed.ends_with(']') {
            (false, &trimmed[1..trimmed.len()-1])
        } else if trimmed.starts_with('(') && trimmed.ends_with(')') {
            (true, &trimmed[1..trimmed.len()-1])
        } else {
            return Err(AppError::ParseError(format!("Invalid path format: {}", input)));
        };
        
        let points = parse_point_list(content)?;
        
        Ok(json!({
            "closed": is_closed,
            "points": points
        }))
    }
    
    /// Parse PostgreSQL polygon "((x1,y1),(x2,y2),...)"
    pub fn parse_polygon(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
            return Err(AppError::ParseError(format!("Invalid polygon format: {}", input)));
        }
        
        let content = &trimmed[1..trimmed.len()-1];
        let points = parse_point_list(content)?;
        
        Ok(json!({
            "points": points
        }))
    }
    
    /// Parse PostgreSQL circle "<(x,y),r>"
    pub fn parse_circle(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        if !trimmed.starts_with('<') || !trimmed.ends_with('>') {
            return Err(AppError::ParseError(format!("Invalid circle format: {}", input)));
        }
        
        let content = &trimmed[1..trimmed.len()-1];
        
        // Find the last comma that separates center from radius
        if let Some(radius_pos) = content.rfind(',') {
            let center_str = &content[..radius_pos];
            let radius_str = &content[radius_pos+1..];
            
            let center = Self::parse_point(center_str)?;
            let radius = radius_str.trim().parse::<f64>()
                .map_err(|_| AppError::ParseError(format!("Invalid radius in circle: {}", input)))?;
            
            return Ok(json!({
                "center": center,
                "radius": radius
            }));
        }
        
        Err(AppError::ParseError(format!("Invalid circle format: {}", input)))
    }
    
    /// Parse PostgreSQL money type "$1,234.56" or "-$1,234.56"
    pub fn parse_money(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        
        // Remove currency symbol and commas
        let cleaned = trimmed
            .replace('$', "")
            .replace(',', "");
        
        let amount = cleaned.parse::<f64>()
            .map_err(|_| AppError::ParseError(format!("Invalid money format: {}", input)))?;
        
        Ok(json!({
            "amount": amount,
            "formatted": trimmed
        }))
    }
    
    /// Parse PostgreSQL hstore "key1=>value1,key2=>value2"
    pub fn parse_hstore(input: &str) -> Result<JsonValue> {
        let mut map = HashMap::new();
        
        if input.trim().is_empty() {
            return Ok(json!(map));
        }
        
        // Parse key-value pairs
        let pairs = split_hstore_pairs(input);
        
        for pair in pairs {
            if let Some(arrow_pos) = pair.find("=>") {
                let key = unquote_hstore_value(&pair[..arrow_pos].trim());
                let value = &pair[arrow_pos+2..].trim();
                
                if *value == "NULL" {
                    map.insert(key, JsonValue::Null);
                } else {
                    map.insert(key, JsonValue::String(unquote_hstore_value(value)));
                }
            }
        }
        
        Ok(json!(map))
    }
    
    /// Parse PostgreSQL ltree "Top.Countries.Europe.Russia"
    pub fn parse_ltree(input: &str) -> Result<JsonValue> {
        let labels: Vec<&str> = input.split('.').collect();
        Ok(json!({
            "labels": labels,
            "path": input
        }))
    }
    
    /// Parse PostgreSQL cube "(x1,x2,...)" or "(x1,x2,...),(y1,y2,...)"
    pub fn parse_cube(input: &str) -> Result<JsonValue> {
        let trimmed = input.trim();
        
        // Check if it's a point or a box
        let parts = split_cube_parts(trimmed);
        
        if parts.len() == 1 {
            // It's a point
            let coords = parse_coordinates(&parts[0])?;
            Ok(json!({
                "type": "point",
                "coordinates": coords
            }))
        } else if parts.len() == 2 {
            // It's a box
            let lower = parse_coordinates(&parts[0])?;
            let upper = parse_coordinates(&parts[1])?;
            Ok(json!({
                "type": "box",
                "lower": lower,
                "upper": upper
            }))
        } else {
            Err(AppError::ParseError(format!("Invalid cube format: {}", input)))
        }
    }
    
    /// Parse PostgreSQL interval "1 year 2 months 3 days 04:05:06"
    pub fn parse_interval(input: &str) -> Result<JsonValue> {
        let mut years = 0;
        let mut months = 0;
        let mut days = 0;
        let mut hours = 0;
        let mut minutes = 0;
        let mut seconds = 0.0;
        
        let parts: Vec<&str> = input.split_whitespace().collect();
        let mut i = 0;
        
        while i < parts.len() {
            if let Ok(num) = parts[i].parse::<i32>() {
                if i + 1 < parts.len() {
                    match parts[i + 1] {
                        s if s.starts_with("year") => years = num,
                        s if s.starts_with("mon") => months = num,
                        s if s.starts_with("day") => days = num,
                        _ => {}
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            } else if parts[i].contains(':') {
                // Time part
                let time_parts: Vec<&str> = parts[i].split(':').collect();
                if time_parts.len() >= 2 {
                    hours = time_parts[0].parse().unwrap_or(0);
                    minutes = time_parts[1].parse().unwrap_or(0);
                    if time_parts.len() >= 3 {
                        seconds = time_parts[2].parse().unwrap_or(0.0);
                    }
                }
                i += 1;
            } else {
                i += 1;
            }
        }
        
        Ok(json!({
            "years": years,
            "months": months,
            "days": days,
            "hours": hours,
            "minutes": minutes,
            "seconds": seconds,
            "iso8601": format!("P{}Y{}M{}DT{}H{}M{}S", years, months, days, hours, minutes, seconds)
        }))
    }
    
    /// Parse PostgreSQL tsvector "'word1':1,2 'word2':3"
    pub fn parse_tsvector(input: &str) -> Result<JsonValue> {
        let mut lexemes = Vec::new();
        let mut current_word = String::new();
        let mut in_word = false;
        let mut positions = Vec::new();
        
        for ch in input.chars() {
            match ch {
                '\'' if !in_word => {
                    in_word = true;
                    current_word.clear();
                },
                '\'' if in_word => {
                    in_word = false;
                },
                ':' if !in_word && !current_word.is_empty() => {
                    // Positions follow
                    positions.clear();
                },
                ',' | ' ' if !in_word => {
                    if !current_word.is_empty() {
                        lexemes.push(json!({
                            "word": current_word.clone(),
                            "positions": positions.clone()
                        }));
                        current_word.clear();
                        positions.clear();
                    }
                },
                c if in_word => {
                    current_word.push(c);
                },
                c if c.is_ascii_digit() => {
                    // Collecting position numbers
                    let mut num_str = String::new();
                    num_str.push(c);
                    positions.push(num_str.parse::<i32>().unwrap_or(0));
                },
                _ => {}
            }
        }
        
        // Add last lexeme if any
        if !current_word.is_empty() {
            lexemes.push(json!({
                "word": current_word,
                "positions": positions
            }));
        }
        
        Ok(json!({
            "lexemes": lexemes
        }))
    }
    
    /// Parse PostgreSQL tsquery "'fat' & 'rat'"
    pub fn parse_tsquery(input: &str) -> Result<JsonValue> {
        // Simple parsing - just extract the structure
        Ok(json!({
            "query": input,
            "tokens": input.split_whitespace()
                .filter(|s| !s.is_empty() && *s != "&" && *s != "|" && *s != "!")
                .map(|s| s.trim_matches('\''))
                .collect::<Vec<_>>()
        }))
    }
}

// Helper functions

fn split_pg_tuple(input: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escape_next = false;
    
    for ch in input.chars() {
        if escape_next {
            current.push(ch);
            escape_next = false;
        } else if ch == '\\' {
            escape_next = true;
        } else if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == ',' && !in_quotes {
            result.push(input[0..current.len()].trim());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    
    if !current.is_empty() || input.ends_with(',') {
        result.push(input[input.len() - current.len()..].trim());
    }
    
    result
}

fn parse_array_recursive(input: &str) -> Result<JsonValue> {
    let trimmed = input.trim();
    
    if trimmed.is_empty() {
        return Ok(json!([]));
    }
    
    // Check if this is a nested array
    if trimmed.starts_with('{') {
        // Multi-dimensional array
        let mut elements = Vec::new();
        let mut current = String::new();
        let mut depth = 0;
        
        for ch in trimmed.chars() {
            match ch {
                '{' => {
                    if depth > 0 {
                        current.push(ch);
                    }
                    depth += 1;
                },
                '}' => {
                    depth -= 1;
                    if depth > 0 {
                        current.push(ch);
                    } else if depth == 0 {
                        if !current.is_empty() {
                            elements.push(parse_array_recursive(&current)?);
                            current.clear();
                        }
                    }
                },
                ',' if depth == 1 => {
                    // Separator at current level
                    if !current.is_empty() {
                        elements.push(parse_array_recursive(&current)?);
                        current.clear();
                    }
                },
                _ => current.push(ch),
            }
        }
        
        Ok(json!(elements))
    } else {
        // Simple array - parse elements
        let elements = split_pg_array_elements(trimmed);
        Ok(json!(elements))
    }
}

fn split_pg_array_elements(input: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escape_next = false;
    
    for ch in input.chars() {
        if escape_next {
            current.push(ch);
            escape_next = false;
        } else if ch == '\\' && in_quotes {
            escape_next = true;
        } else if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == ',' && !in_quotes {
            if in_quotes || !current.is_empty() {
                result.push(current.trim().trim_matches('"').to_string());
            }
            current.clear();
        } else {
            current.push(ch);
        }
    }
    
    if !current.is_empty() {
        result.push(current.trim().trim_matches('"').to_string());
    }
    
    result
}

fn parse_point_list(input: &str) -> Result<Vec<JsonValue>> {
    let mut points = Vec::new();
    let mut current = String::new();
    let mut depth = 0;
    
    for ch in input.chars() {
        match ch {
            '(' => {
                depth += 1;
                current.push(ch);
            },
            ')' => {
                depth -= 1;
                current.push(ch);
                if depth == 0 && !current.is_empty() {
                    points.push(PostgresTypeParser::parse_point(&current)?);
                    current.clear();
                }
            },
            ',' if depth == 0 => {
                // Skip commas between points
            },
            _ => current.push(ch),
        }
    }
    
    Ok(points)
}

fn split_hstore_pairs(input: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escape_next = false;
    
    for ch in input.chars() {
        if escape_next {
            current.push(ch);
            escape_next = false;
        } else if ch == '\\' {
            escape_next = true;
            current.push(ch);
        } else if ch == '"' {
            in_quotes = !in_quotes;
            current.push(ch);
        } else if ch == ',' && !in_quotes {
            if !current.trim().is_empty() {
                result.push(current.trim().to_string());
            }
            current.clear();
        } else {
            current.push(ch);
        }
    }
    
    if !current.trim().is_empty() {
        result.push(current.trim().to_string());
    }
    
    result
}

fn unquote_hstore_value(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len()-1]
            .replace("\\\\", "\\")
            .replace("\\\"", "\"")
    } else {
        trimmed.to_string()
    }
}

fn split_cube_parts(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut paren_depth = 0;
    
    for ch in input.chars() {
        match ch {
            '(' => {
                paren_depth += 1;
                current.push(ch);
            },
            ')' => {
                paren_depth -= 1;
                current.push(ch);
                if paren_depth == 0 {
                    parts.push(current.clone());
                    current.clear();
                }
            },
            ',' if paren_depth == 0 => {
                // Skip commas between parts
            },
            _ => current.push(ch),
        }
    }
    
    if !current.is_empty() {
        parts.push(current);
    }
    
    parts
}

fn parse_coordinates(input: &str) -> Result<Vec<f64>> {
    let trimmed = input.trim();
    let content = if trimmed.starts_with('(') && trimmed.ends_with(')') {
        &trimmed[1..trimmed.len()-1]
    } else {
        trimmed
    };
    
    content.split(',')
        .map(|s| s.trim().parse::<f64>()
            .map_err(|_| AppError::ParseError(format!("Invalid coordinate: {}", s))))
        .collect()
}