-- Test script for tstzrange type parsing
-- This will test if the tstzrange type is properly displayed

-- First, let's check what values are in the valid_during column
SELECT 
    id,
    title,
    valid_during,
    valid_during::text as valid_during_text
FROM todos 
WHERE valid_during IS NOT NULL 
LIMIT 5;

-- Create a test with known tstzrange values
CREATE TEMPORARY TABLE test_ranges (
    id serial PRIMARY KEY,
    description text,
    date_range tstzrange
);

INSERT INTO test_ranges (description, date_range) VALUES
    ('Full year 2024', '[2024-01-01 00:00:00+00,2024-12-31 23:59:59+00]'),
    ('Q1 2024', '[2024-01-01 00:00:00+00,2024-03-31 23:59:59+00)'),
    ('Open ended from 2024', '[2024-01-01 00:00:00+00,)'),
    ('Up to 2024', '(,2024-01-01 00:00:00+00)'),
    ('Empty range', 'empty');

SELECT * FROM test_ranges;