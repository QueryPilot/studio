-- Populate search_vector for existing todos
-- This will trigger the update_search_vector function for all rows

-- First, check current state
SELECT COUNT(*) as total_todos, 
       COUNT(search_vector) as with_search_vector,
       COUNT(*) - COUNT(search_vector) as null_search_vector
FROM todos;

-- Force update of search_vector for all rows by updating title
-- This will trigger the update_search_vector() function
UPDATE todos 
SET title = title
WHERE search_vector IS NULL;

-- Verify the update
SELECT COUNT(*) as total_todos, 
       COUNT(search_vector) as with_search_vector,
       COUNT(*) - COUNT(search_vector) as null_search_vector
FROM todos;

-- Show sample of populated search_vector data
SELECT 
    id, 
    title,
    search_vector::text as search_vector_display
FROM todos 
WHERE search_vector IS NOT NULL
LIMIT 10;