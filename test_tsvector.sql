-- Test tsvector handling

-- Check if search_vector has data
SELECT 
    id, 
    title,
    description,
    search_vector,
    search_vector::text as search_vector_text,
    search_vector IS NULL as is_null
FROM todos 
LIMIT 5;

-- Update a row to trigger the search_vector update
UPDATE todos 
SET title = title || ' ' 
WHERE id = (SELECT id FROM todos LIMIT 1);

-- Check again after update
SELECT 
    id, 
    title,
    description,
    search_vector,
    search_vector::text as search_vector_text
FROM todos 
WHERE search_vector IS NOT NULL
LIMIT 5;

-- Manually set a tsvector value for testing
UPDATE todos 
SET search_vector = to_tsvector('english', 'test words for search vector display')
WHERE id = (SELECT id FROM todos LIMIT 1);

-- Verify the manual update
SELECT 
    id, 
    title,
    search_vector,
    search_vector::text as search_vector_text
FROM todos 
WHERE id = (SELECT id FROM todos LIMIT 1);