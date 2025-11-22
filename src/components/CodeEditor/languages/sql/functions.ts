/**
 * SQL Function Signatures Database
 *
 * Provides function signatures with parameter info for autocomplete.
 */

export interface SqlFunction {
  name: string;
  signature: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    optional?: boolean;
  }>;
  returnType: string;
  category: 'aggregate' | 'string' | 'numeric' | 'date' | 'window' | 'json' | 'array' | 'conditional' | 'type' | 'other';
}

// Common SQL functions (PostgreSQL-focused with cross-dialect support)
export const SQL_FUNCTIONS: SqlFunction[] = [
  // Aggregate Functions
  {
    name: 'COUNT',
    signature: 'COUNT(expression)',
    description: 'Returns the number of rows',
    parameters: [{ name: 'expression', type: 'any' }],
    returnType: 'bigint',
    category: 'aggregate',
  },
  {
    name: 'SUM',
    signature: 'SUM(expression)',
    description: 'Returns the sum of values',
    parameters: [{ name: 'expression', type: 'numeric' }],
    returnType: 'numeric',
    category: 'aggregate',
  },
  {
    name: 'AVG',
    signature: 'AVG(expression)',
    description: 'Returns the average of values',
    parameters: [{ name: 'expression', type: 'numeric' }],
    returnType: 'numeric',
    category: 'aggregate',
  },
  {
    name: 'MIN',
    signature: 'MIN(expression)',
    description: 'Returns the minimum value',
    parameters: [{ name: 'expression', type: 'any' }],
    returnType: 'same as input',
    category: 'aggregate',
  },
  {
    name: 'MAX',
    signature: 'MAX(expression)',
    description: 'Returns the maximum value',
    parameters: [{ name: 'expression', type: 'any' }],
    returnType: 'same as input',
    category: 'aggregate',
  },
  {
    name: 'ARRAY_AGG',
    signature: 'ARRAY_AGG(expression [ORDER BY ...])',
    description: 'Aggregates values into an array',
    parameters: [{ name: 'expression', type: 'any' }],
    returnType: 'array',
    category: 'aggregate',
  },
  {
    name: 'STRING_AGG',
    signature: 'STRING_AGG(expression, delimiter)',
    description: 'Concatenates values with a delimiter',
    parameters: [
      { name: 'expression', type: 'text' },
      { name: 'delimiter', type: 'text' },
    ],
    returnType: 'text',
    category: 'aggregate',
  },
  {
    name: 'JSON_AGG',
    signature: 'JSON_AGG(expression)',
    description: 'Aggregates values as a JSON array',
    parameters: [{ name: 'expression', type: 'any' }],
    returnType: 'json',
    category: 'aggregate',
  },
  {
    name: 'JSONB_AGG',
    signature: 'JSONB_AGG(expression)',
    description: 'Aggregates values as a JSONB array',
    parameters: [{ name: 'expression', type: 'any' }],
    returnType: 'jsonb',
    category: 'aggregate',
  },

  // String Functions
  {
    name: 'CONCAT',
    signature: 'CONCAT(str1, str2, ...)',
    description: 'Concatenates strings',
    parameters: [
      { name: 'str1', type: 'text' },
      { name: 'str2', type: 'text' },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'CONCAT_WS',
    signature: 'CONCAT_WS(separator, str1, str2, ...)',
    description: 'Concatenates strings with separator',
    parameters: [
      { name: 'separator', type: 'text' },
      { name: 'str1', type: 'text' },
      { name: 'str2', type: 'text' },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'LENGTH',
    signature: 'LENGTH(string)',
    description: 'Returns the length of a string',
    parameters: [{ name: 'string', type: 'text' }],
    returnType: 'integer',
    category: 'string',
  },
  {
    name: 'UPPER',
    signature: 'UPPER(string)',
    description: 'Converts string to uppercase',
    parameters: [{ name: 'string', type: 'text' }],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'LOWER',
    signature: 'LOWER(string)',
    description: 'Converts string to lowercase',
    parameters: [{ name: 'string', type: 'text' }],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'TRIM',
    signature: 'TRIM([LEADING|TRAILING|BOTH] [characters] FROM string)',
    description: 'Removes characters from string ends',
    parameters: [{ name: 'string', type: 'text' }],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'LTRIM',
    signature: 'LTRIM(string [, characters])',
    description: 'Removes characters from string start',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'characters', type: 'text', optional: true },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'RTRIM',
    signature: 'RTRIM(string [, characters])',
    description: 'Removes characters from string end',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'characters', type: 'text', optional: true },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'SUBSTRING',
    signature: 'SUBSTRING(string FROM start [FOR length])',
    description: 'Extracts a substring',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'start', type: 'integer' },
      { name: 'length', type: 'integer', optional: true },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'REPLACE',
    signature: 'REPLACE(string, from, to)',
    description: 'Replaces occurrences of a substring',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'from', type: 'text' },
      { name: 'to', type: 'text' },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'SPLIT_PART',
    signature: 'SPLIT_PART(string, delimiter, position)',
    description: 'Splits string and returns nth part',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'delimiter', type: 'text' },
      { name: 'position', type: 'integer' },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'REGEXP_REPLACE',
    signature: 'REGEXP_REPLACE(string, pattern, replacement [, flags])',
    description: 'Replaces using regular expression',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'pattern', type: 'text' },
      { name: 'replacement', type: 'text' },
      { name: 'flags', type: 'text', optional: true },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'REGEXP_MATCH',
    signature: 'REGEXP_MATCH(string, pattern [, flags])',
    description: 'Returns captured groups from regex match',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'pattern', type: 'text' },
      { name: 'flags', type: 'text', optional: true },
    ],
    returnType: 'text[]',
    category: 'string',
  },
  {
    name: 'LEFT',
    signature: 'LEFT(string, n)',
    description: 'Returns first n characters',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'n', type: 'integer' },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'RIGHT',
    signature: 'RIGHT(string, n)',
    description: 'Returns last n characters',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'n', type: 'integer' },
    ],
    returnType: 'text',
    category: 'string',
  },
  {
    name: 'POSITION',
    signature: 'POSITION(substring IN string)',
    description: 'Returns position of substring',
    parameters: [
      { name: 'substring', type: 'text' },
      { name: 'string', type: 'text' },
    ],
    returnType: 'integer',
    category: 'string',
  },

  // Numeric Functions
  {
    name: 'ABS',
    signature: 'ABS(number)',
    description: 'Returns absolute value',
    parameters: [{ name: 'number', type: 'numeric' }],
    returnType: 'numeric',
    category: 'numeric',
  },
  {
    name: 'ROUND',
    signature: 'ROUND(number [, precision])',
    description: 'Rounds to specified precision',
    parameters: [
      { name: 'number', type: 'numeric' },
      { name: 'precision', type: 'integer', optional: true },
    ],
    returnType: 'numeric',
    category: 'numeric',
  },
  {
    name: 'CEIL',
    signature: 'CEIL(number)',
    description: 'Rounds up to nearest integer',
    parameters: [{ name: 'number', type: 'numeric' }],
    returnType: 'numeric',
    category: 'numeric',
  },
  {
    name: 'FLOOR',
    signature: 'FLOOR(number)',
    description: 'Rounds down to nearest integer',
    parameters: [{ name: 'number', type: 'numeric' }],
    returnType: 'numeric',
    category: 'numeric',
  },
  {
    name: 'TRUNC',
    signature: 'TRUNC(number [, precision])',
    description: 'Truncates to specified precision',
    parameters: [
      { name: 'number', type: 'numeric' },
      { name: 'precision', type: 'integer', optional: true },
    ],
    returnType: 'numeric',
    category: 'numeric',
  },
  {
    name: 'MOD',
    signature: 'MOD(dividend, divisor)',
    description: 'Returns remainder of division',
    parameters: [
      { name: 'dividend', type: 'numeric' },
      { name: 'divisor', type: 'numeric' },
    ],
    returnType: 'numeric',
    category: 'numeric',
  },
  {
    name: 'POWER',
    signature: 'POWER(base, exponent)',
    description: 'Returns base raised to exponent',
    parameters: [
      { name: 'base', type: 'numeric' },
      { name: 'exponent', type: 'numeric' },
    ],
    returnType: 'numeric',
    category: 'numeric',
  },
  {
    name: 'SQRT',
    signature: 'SQRT(number)',
    description: 'Returns square root',
    parameters: [{ name: 'number', type: 'numeric' }],
    returnType: 'numeric',
    category: 'numeric',
  },
  {
    name: 'RANDOM',
    signature: 'RANDOM()',
    description: 'Returns random value between 0 and 1',
    parameters: [],
    returnType: 'double precision',
    category: 'numeric',
  },
  {
    name: 'GREATEST',
    signature: 'GREATEST(value1, value2, ...)',
    description: 'Returns the largest value',
    parameters: [
      { name: 'value1', type: 'any' },
      { name: 'value2', type: 'any' },
    ],
    returnType: 'same as input',
    category: 'numeric',
  },
  {
    name: 'LEAST',
    signature: 'LEAST(value1, value2, ...)',
    description: 'Returns the smallest value',
    parameters: [
      { name: 'value1', type: 'any' },
      { name: 'value2', type: 'any' },
    ],
    returnType: 'same as input',
    category: 'numeric',
  },

  // Date/Time Functions
  {
    name: 'NOW',
    signature: 'NOW()',
    description: 'Returns current timestamp',
    parameters: [],
    returnType: 'timestamp with time zone',
    category: 'date',
  },
  {
    name: 'CURRENT_DATE',
    signature: 'CURRENT_DATE',
    description: 'Returns current date',
    parameters: [],
    returnType: 'date',
    category: 'date',
  },
  {
    name: 'CURRENT_TIME',
    signature: 'CURRENT_TIME',
    description: 'Returns current time',
    parameters: [],
    returnType: 'time with time zone',
    category: 'date',
  },
  {
    name: 'CURRENT_TIMESTAMP',
    signature: 'CURRENT_TIMESTAMP',
    description: 'Returns current timestamp',
    parameters: [],
    returnType: 'timestamp with time zone',
    category: 'date',
  },
  {
    name: 'DATE_TRUNC',
    signature: 'DATE_TRUNC(precision, timestamp)',
    description: 'Truncates timestamp to precision',
    parameters: [
      { name: 'precision', type: 'text' },
      { name: 'timestamp', type: 'timestamp' },
    ],
    returnType: 'timestamp',
    category: 'date',
  },
  {
    name: 'EXTRACT',
    signature: 'EXTRACT(field FROM source)',
    description: 'Extracts date/time field',
    parameters: [
      { name: 'field', type: 'text' },
      { name: 'source', type: 'timestamp' },
    ],
    returnType: 'numeric',
    category: 'date',
  },
  {
    name: 'DATE_PART',
    signature: 'DATE_PART(field, source)',
    description: 'Gets date/time field value',
    parameters: [
      { name: 'field', type: 'text' },
      { name: 'source', type: 'timestamp' },
    ],
    returnType: 'double precision',
    category: 'date',
  },
  {
    name: 'AGE',
    signature: 'AGE(timestamp [, timestamp])',
    description: 'Calculates age between timestamps',
    parameters: [
      { name: 'timestamp1', type: 'timestamp' },
      { name: 'timestamp2', type: 'timestamp', optional: true },
    ],
    returnType: 'interval',
    category: 'date',
  },
  {
    name: 'TO_CHAR',
    signature: 'TO_CHAR(value, format)',
    description: 'Formats value as string',
    parameters: [
      { name: 'value', type: 'timestamp|numeric' },
      { name: 'format', type: 'text' },
    ],
    returnType: 'text',
    category: 'date',
  },
  {
    name: 'TO_DATE',
    signature: 'TO_DATE(string, format)',
    description: 'Parses string as date',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'format', type: 'text' },
    ],
    returnType: 'date',
    category: 'date',
  },
  {
    name: 'TO_TIMESTAMP',
    signature: 'TO_TIMESTAMP(string, format)',
    description: 'Parses string as timestamp',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'format', type: 'text' },
    ],
    returnType: 'timestamp',
    category: 'date',
  },

  // Window Functions
  {
    name: 'ROW_NUMBER',
    signature: 'ROW_NUMBER() OVER (ORDER BY ...)',
    description: 'Assigns sequential row numbers',
    parameters: [],
    returnType: 'bigint',
    category: 'window',
  },
  {
    name: 'RANK',
    signature: 'RANK() OVER (ORDER BY ...)',
    description: 'Assigns rank with gaps',
    parameters: [],
    returnType: 'bigint',
    category: 'window',
  },
  {
    name: 'DENSE_RANK',
    signature: 'DENSE_RANK() OVER (ORDER BY ...)',
    description: 'Assigns rank without gaps',
    parameters: [],
    returnType: 'bigint',
    category: 'window',
  },
  {
    name: 'NTILE',
    signature: 'NTILE(num_buckets) OVER (ORDER BY ...)',
    description: 'Divides rows into buckets',
    parameters: [{ name: 'num_buckets', type: 'integer' }],
    returnType: 'integer',
    category: 'window',
  },
  {
    name: 'LAG',
    signature: 'LAG(value [, offset [, default]]) OVER (...)',
    description: 'Gets value from previous row',
    parameters: [
      { name: 'value', type: 'any' },
      { name: 'offset', type: 'integer', optional: true },
      { name: 'default', type: 'any', optional: true },
    ],
    returnType: 'same as value',
    category: 'window',
  },
  {
    name: 'LEAD',
    signature: 'LEAD(value [, offset [, default]]) OVER (...)',
    description: 'Gets value from following row',
    parameters: [
      { name: 'value', type: 'any' },
      { name: 'offset', type: 'integer', optional: true },
      { name: 'default', type: 'any', optional: true },
    ],
    returnType: 'same as value',
    category: 'window',
  },
  {
    name: 'FIRST_VALUE',
    signature: 'FIRST_VALUE(value) OVER (...)',
    description: 'Gets first value in window',
    parameters: [{ name: 'value', type: 'any' }],
    returnType: 'same as value',
    category: 'window',
  },
  {
    name: 'LAST_VALUE',
    signature: 'LAST_VALUE(value) OVER (...)',
    description: 'Gets last value in window',
    parameters: [{ name: 'value', type: 'any' }],
    returnType: 'same as value',
    category: 'window',
  },
  {
    name: 'NTH_VALUE',
    signature: 'NTH_VALUE(value, n) OVER (...)',
    description: 'Gets nth value in window',
    parameters: [
      { name: 'value', type: 'any' },
      { name: 'n', type: 'integer' },
    ],
    returnType: 'same as value',
    category: 'window',
  },

  // JSON Functions
  {
    name: 'JSON_BUILD_OBJECT',
    signature: 'JSON_BUILD_OBJECT(key1, value1, ...)',
    description: 'Builds JSON object from key-value pairs',
    parameters: [
      { name: 'key1', type: 'text' },
      { name: 'value1', type: 'any' },
    ],
    returnType: 'json',
    category: 'json',
  },
  {
    name: 'JSONB_BUILD_OBJECT',
    signature: 'JSONB_BUILD_OBJECT(key1, value1, ...)',
    description: 'Builds JSONB object from key-value pairs',
    parameters: [
      { name: 'key1', type: 'text' },
      { name: 'value1', type: 'any' },
    ],
    returnType: 'jsonb',
    category: 'json',
  },
  {
    name: 'JSON_BUILD_ARRAY',
    signature: 'JSON_BUILD_ARRAY(value1, ...)',
    description: 'Builds JSON array from values',
    parameters: [{ name: 'value1', type: 'any' }],
    returnType: 'json',
    category: 'json',
  },
  {
    name: 'JSONB_BUILD_ARRAY',
    signature: 'JSONB_BUILD_ARRAY(value1, ...)',
    description: 'Builds JSONB array from values',
    parameters: [{ name: 'value1', type: 'any' }],
    returnType: 'jsonb',
    category: 'json',
  },
  {
    name: 'JSONB_SET',
    signature: 'JSONB_SET(target, path, new_value [, create_if_missing])',
    description: 'Sets value at path in JSONB',
    parameters: [
      { name: 'target', type: 'jsonb' },
      { name: 'path', type: 'text[]' },
      { name: 'new_value', type: 'jsonb' },
      { name: 'create_if_missing', type: 'boolean', optional: true },
    ],
    returnType: 'jsonb',
    category: 'json',
  },
  {
    name: 'JSONB_EXTRACT_PATH',
    signature: 'JSONB_EXTRACT_PATH(from_json, path_elem1, ...)',
    description: 'Extracts value at path',
    parameters: [
      { name: 'from_json', type: 'jsonb' },
      { name: 'path_elem1', type: 'text' },
    ],
    returnType: 'jsonb',
    category: 'json',
  },
  {
    name: 'JSONB_EXTRACT_PATH_TEXT',
    signature: 'JSONB_EXTRACT_PATH_TEXT(from_json, path_elem1, ...)',
    description: 'Extracts value at path as text',
    parameters: [
      { name: 'from_json', type: 'jsonb' },
      { name: 'path_elem1', type: 'text' },
    ],
    returnType: 'text',
    category: 'json',
  },
  {
    name: 'TO_JSON',
    signature: 'TO_JSON(value)',
    description: 'Converts value to JSON',
    parameters: [{ name: 'value', type: 'any' }],
    returnType: 'json',
    category: 'json',
  },
  {
    name: 'TO_JSONB',
    signature: 'TO_JSONB(value)',
    description: 'Converts value to JSONB',
    parameters: [{ name: 'value', type: 'any' }],
    returnType: 'jsonb',
    category: 'json',
  },
  {
    name: 'JSONB_ARRAY_ELEMENTS',
    signature: 'JSONB_ARRAY_ELEMENTS(array)',
    description: 'Expands JSONB array to set of elements',
    parameters: [{ name: 'array', type: 'jsonb' }],
    returnType: 'setof jsonb',
    category: 'json',
  },
  {
    name: 'JSONB_ARRAY_ELEMENTS_TEXT',
    signature: 'JSONB_ARRAY_ELEMENTS_TEXT(array)',
    description: 'Expands JSONB array to set of text',
    parameters: [{ name: 'array', type: 'jsonb' }],
    returnType: 'setof text',
    category: 'json',
  },
  {
    name: 'JSONB_OBJECT_KEYS',
    signature: 'JSONB_OBJECT_KEYS(object)',
    description: 'Returns set of keys in object',
    parameters: [{ name: 'object', type: 'jsonb' }],
    returnType: 'setof text',
    category: 'json',
  },
  {
    name: 'JSONB_PRETTY',
    signature: 'JSONB_PRETTY(jsonb)',
    description: 'Returns pretty-printed JSON text',
    parameters: [{ name: 'jsonb', type: 'jsonb' }],
    returnType: 'text',
    category: 'json',
  },
  {
    name: 'JSONB_TYPEOF',
    signature: 'JSONB_TYPEOF(jsonb)',
    description: 'Returns type of JSONB value',
    parameters: [{ name: 'jsonb', type: 'jsonb' }],
    returnType: 'text',
    category: 'json',
  },

  // Array Functions
  {
    name: 'ARRAY_LENGTH',
    signature: 'ARRAY_LENGTH(array, dimension)',
    description: 'Returns length of array dimension',
    parameters: [
      { name: 'array', type: 'anyarray' },
      { name: 'dimension', type: 'integer' },
    ],
    returnType: 'integer',
    category: 'array',
  },
  {
    name: 'ARRAY_APPEND',
    signature: 'ARRAY_APPEND(array, element)',
    description: 'Appends element to array',
    parameters: [
      { name: 'array', type: 'anyarray' },
      { name: 'element', type: 'any' },
    ],
    returnType: 'anyarray',
    category: 'array',
  },
  {
    name: 'ARRAY_PREPEND',
    signature: 'ARRAY_PREPEND(element, array)',
    description: 'Prepends element to array',
    parameters: [
      { name: 'element', type: 'any' },
      { name: 'array', type: 'anyarray' },
    ],
    returnType: 'anyarray',
    category: 'array',
  },
  {
    name: 'ARRAY_CAT',
    signature: 'ARRAY_CAT(array1, array2)',
    description: 'Concatenates arrays',
    parameters: [
      { name: 'array1', type: 'anyarray' },
      { name: 'array2', type: 'anyarray' },
    ],
    returnType: 'anyarray',
    category: 'array',
  },
  {
    name: 'ARRAY_REMOVE',
    signature: 'ARRAY_REMOVE(array, element)',
    description: 'Removes all occurrences of element',
    parameters: [
      { name: 'array', type: 'anyarray' },
      { name: 'element', type: 'any' },
    ],
    returnType: 'anyarray',
    category: 'array',
  },
  {
    name: 'ARRAY_POSITION',
    signature: 'ARRAY_POSITION(array, element [, start])',
    description: 'Returns position of element in array',
    parameters: [
      { name: 'array', type: 'anyarray' },
      { name: 'element', type: 'any' },
      { name: 'start', type: 'integer', optional: true },
    ],
    returnType: 'integer',
    category: 'array',
  },
  {
    name: 'UNNEST',
    signature: 'UNNEST(array)',
    description: 'Expands array to set of rows',
    parameters: [{ name: 'array', type: 'anyarray' }],
    returnType: 'setof element',
    category: 'array',
  },

  // Conditional Functions
  {
    name: 'COALESCE',
    signature: 'COALESCE(value1, value2, ...)',
    description: 'Returns first non-null value',
    parameters: [
      { name: 'value1', type: 'any' },
      { name: 'value2', type: 'any' },
    ],
    returnType: 'same as input',
    category: 'conditional',
  },
  {
    name: 'NULLIF',
    signature: 'NULLIF(value1, value2)',
    description: 'Returns null if values are equal',
    parameters: [
      { name: 'value1', type: 'any' },
      { name: 'value2', type: 'any' },
    ],
    returnType: 'same as value1',
    category: 'conditional',
  },
  {
    name: 'CASE',
    signature: 'CASE WHEN condition THEN result [ELSE default] END',
    description: 'Conditional expression',
    parameters: [
      { name: 'condition', type: 'boolean' },
      { name: 'result', type: 'any' },
    ],
    returnType: 'any',
    category: 'conditional',
  },

  // Type Casting Functions
  {
    name: 'CAST',
    signature: 'CAST(value AS type)',
    description: 'Converts value to specified type',
    parameters: [
      { name: 'value', type: 'any' },
      { name: 'type', type: 'type' },
    ],
    returnType: 'specified type',
    category: 'type',
  },
  {
    name: 'TO_NUMBER',
    signature: 'TO_NUMBER(string, format)',
    description: 'Converts string to number',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'format', type: 'text' },
    ],
    returnType: 'numeric',
    category: 'type',
  },

  // Other Functions
  {
    name: 'GEN_RANDOM_UUID',
    signature: 'GEN_RANDOM_UUID()',
    description: 'Generates random UUID v4',
    parameters: [],
    returnType: 'uuid',
    category: 'other',
  },
  {
    name: 'UUID_GENERATE_V4',
    signature: 'UUID_GENERATE_V4()',
    description: 'Generates random UUID v4 (uuid-ossp)',
    parameters: [],
    returnType: 'uuid',
    category: 'other',
  },
  {
    name: 'MD5',
    signature: 'MD5(string)',
    description: 'Calculates MD5 hash',
    parameters: [{ name: 'string', type: 'text' }],
    returnType: 'text',
    category: 'other',
  },
  {
    name: 'ENCODE',
    signature: 'ENCODE(data, format)',
    description: 'Encodes binary data as text',
    parameters: [
      { name: 'data', type: 'bytea' },
      { name: 'format', type: 'text' },
    ],
    returnType: 'text',
    category: 'other',
  },
  {
    name: 'DECODE',
    signature: 'DECODE(string, format)',
    description: 'Decodes text to binary data',
    parameters: [
      { name: 'string', type: 'text' },
      { name: 'format', type: 'text' },
    ],
    returnType: 'bytea',
    category: 'other',
  },
];

// Create lookup map for fast access
const FUNCTION_MAP = new Map<string, SqlFunction>();
for (const fn of SQL_FUNCTIONS) {
  FUNCTION_MAP.set(fn.name.toUpperCase(), fn);
}

/**
 * Get function by name
 */
export function getFunction(name: string): SqlFunction | undefined {
  return FUNCTION_MAP.get(name.toUpperCase());
}

/**
 * Search functions by prefix
 */
export function searchFunctions(prefix: string): SqlFunction[] {
  const upper = prefix.toUpperCase();
  return SQL_FUNCTIONS.filter(fn => fn.name.startsWith(upper));
}

/**
 * Get functions by category
 */
export function getFunctionsByCategory(category: SqlFunction['category']): SqlFunction[] {
  return SQL_FUNCTIONS.filter(fn => fn.category === category);
}

/**
 * Get all function names for quick completion
 */
export function getAllFunctionNames(): string[] {
  return SQL_FUNCTIONS.map(fn => fn.name);
}
