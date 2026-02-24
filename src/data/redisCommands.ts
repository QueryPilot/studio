export interface RedisCommand {
  name: string;
  args: string;
  description: string;
  category: RedisCommandCategory;
  dangerous?: boolean;
}

export type RedisCommandCategory =
  | "string"
  | "hash"
  | "list"
  | "set"
  | "sortedset"
  | "key"
  | "connection"
  | "server"
  | "pubsub"
  | "transaction"
  | "scripting"
  | "stream"
  | "json"
  | "search";

export const REDIS_COMMANDS: RedisCommand[] = [
  // String commands
  { name: "APPEND", args: "key value", description: "Append a value to a key", category: "string" },
  { name: "DECR", args: "key", description: "Decrement the integer value of a key by one", category: "string" },
  { name: "DECRBY", args: "key decrement", description: "Decrement the integer value of a key by the given number", category: "string" },
  { name: "GET", args: "key", description: "Get the value of a key", category: "string" },
  { name: "GETDEL", args: "key", description: "Get the value of a key and delete the key", category: "string" },
  { name: "GETEX", args: "key [EX seconds|PX milliseconds|EXAT timestamp|PXAT milliseconds-timestamp|PERSIST]", description: "Get the value of a key and optionally set its expiration", category: "string" },
  { name: "GETRANGE", args: "key start end", description: "Get a substring of the string stored at a key", category: "string" },
  { name: "GETSET", args: "key value", description: "Set the string value of a key and return its old value", category: "string" },
  { name: "INCR", args: "key", description: "Increment the integer value of a key by one", category: "string" },
  { name: "INCRBY", args: "key increment", description: "Increment the integer value of a key by the given amount", category: "string" },
  { name: "INCRBYFLOAT", args: "key increment", description: "Increment the float value of a key by the given amount", category: "string" },
  { name: "MGET", args: "key [key ...]", description: "Get the values of all the given keys", category: "string" },
  { name: "MSET", args: "key value [key value ...]", description: "Set multiple keys to multiple values", category: "string" },
  { name: "MSETNX", args: "key value [key value ...]", description: "Set multiple keys to multiple values, only if none of the keys exist", category: "string" },
  { name: "PSETEX", args: "key milliseconds value", description: "Set the value and expiration in milliseconds of a key", category: "string" },
  { name: "SET", args: "key value [NX|XX] [GET] [EX seconds|PX milliseconds|EXAT timestamp|PXAT milliseconds-timestamp|KEEPTTL]", description: "Set the string value of a key", category: "string" },
  { name: "SETEX", args: "key seconds value", description: "Set the value and expiration of a key", category: "string" },
  { name: "SETNX", args: "key value", description: "Set the value of a key, only if the key does not exist", category: "string" },
  { name: "SETRANGE", args: "key offset value", description: "Overwrite part of a string at key starting at the specified offset", category: "string" },
  { name: "STRLEN", args: "key", description: "Get the length of the value stored in a key", category: "string" },
  { name: "SUBSTR", args: "key start end", description: "Get a substring of the string stored at a key (deprecated)", category: "string" },

  // Hash commands
  { name: "HDEL", args: "key field [field ...]", description: "Delete one or more hash fields", category: "hash" },
  { name: "HEXISTS", args: "key field", description: "Determine if a hash field exists", category: "hash" },
  { name: "HGET", args: "key field", description: "Get the value of a hash field", category: "hash" },
  { name: "HGETALL", args: "key", description: "Get all the fields and values in a hash", category: "hash" },
  { name: "HINCRBY", args: "key field increment", description: "Increment the integer value of a hash field by the given number", category: "hash" },
  { name: "HINCRBYFLOAT", args: "key field increment", description: "Increment the float value of a hash field by the given amount", category: "hash" },
  { name: "HKEYS", args: "key", description: "Get all the fields in a hash", category: "hash" },
  { name: "HLEN", args: "key", description: "Get the number of fields in a hash", category: "hash" },
  { name: "HMGET", args: "key field [field ...]", description: "Get the values of all the given hash fields", category: "hash" },
  { name: "HMSET", args: "key field value [field value ...]", description: "Set multiple hash fields to multiple values", category: "hash" },
  { name: "HRANDFIELD", args: "key [count [WITHVALUES]]", description: "Get one or multiple random fields from a hash", category: "hash" },
  { name: "HSCAN", args: "key cursor [MATCH pattern] [COUNT count]", description: "Incrementally iterate hash fields and associated values", category: "hash" },
  { name: "HSET", args: "key field value [field value ...]", description: "Set the string value of a hash field", category: "hash" },
  { name: "HSETNX", args: "key field value", description: "Set the value of a hash field, only if the field does not exist", category: "hash" },
  { name: "HSTRLEN", args: "key field", description: "Get the length of the value of a hash field", category: "hash" },
  { name: "HVALS", args: "key", description: "Get all the values in a hash", category: "hash" },

  // List commands
  { name: "BLMOVE", args: "source destination LEFT|RIGHT LEFT|RIGHT timeout", description: "Pop an element from a list, push it to another list and return it; or block until one is available", category: "list" },
  { name: "BLPOP", args: "key [key ...] timeout", description: "Remove and get the first element in a list, or block until one is available", category: "list" },
  { name: "BRPOP", args: "key [key ...] timeout", description: "Remove and get the last element in a list, or block until one is available", category: "list" },
  { name: "BRPOPLPUSH", args: "source destination timeout", description: "Pop a value from a list, push it to another list and return it; or block until one is available (deprecated)", category: "list" },
  { name: "LINDEX", args: "key index", description: "Get an element from a list by its index", category: "list" },
  { name: "LINSERT", args: "key BEFORE|AFTER pivot element", description: "Insert an element before or after another element in a list", category: "list" },
  { name: "LLEN", args: "key", description: "Get the length of a list", category: "list" },
  { name: "LMOVE", args: "source destination LEFT|RIGHT LEFT|RIGHT", description: "Pop an element from a list, push it to another list and return it", category: "list" },
  { name: "LPOP", args: "key [count]", description: "Remove and get the first elements in a list", category: "list" },
  { name: "LPOS", args: "key element [RANK rank] [COUNT num-matches] [MAXLEN len]", description: "Return the index of matching elements on a list", category: "list" },
  { name: "LPUSH", args: "key element [element ...]", description: "Prepend one or multiple elements to a list", category: "list" },
  { name: "LPUSHX", args: "key element [element ...]", description: "Prepend an element to a list, only if the list exists", category: "list" },
  { name: "LRANGE", args: "key start stop", description: "Get a range of elements from a list", category: "list" },
  { name: "LREM", args: "key count element", description: "Remove elements from a list", category: "list" },
  { name: "LSET", args: "key index element", description: "Set the value of an element in a list by its index", category: "list" },
  { name: "LTRIM", args: "key start stop", description: "Trim a list to the specified range", category: "list" },
  { name: "RPOP", args: "key [count]", description: "Remove and get the last elements in a list", category: "list" },
  { name: "RPOPLPUSH", args: "source destination", description: "Remove the last element in a list, prepend it to another list and return it", category: "list" },
  { name: "RPUSH", args: "key element [element ...]", description: "Append one or multiple elements to a list", category: "list" },
  { name: "RPUSHX", args: "key element [element ...]", description: "Append an element to a list, only if the list exists", category: "list" },

  // Set commands
  { name: "SADD", args: "key member [member ...]", description: "Add one or more members to a set", category: "set" },
  { name: "SCARD", args: "key", description: "Get the number of members in a set", category: "set" },
  { name: "SDIFF", args: "key [key ...]", description: "Subtract multiple sets", category: "set" },
  { name: "SDIFFSTORE", args: "destination key [key ...]", description: "Subtract multiple sets and store the resulting set in a key", category: "set" },
  { name: "SINTER", args: "key [key ...]", description: "Intersect multiple sets", category: "set" },
  { name: "SINTERCARD", args: "numkeys key [key ...] [LIMIT limit]", description: "Intersect multiple sets and return the cardinality of the result", category: "set" },
  { name: "SINTERSTORE", args: "destination key [key ...]", description: "Intersect multiple sets and store the resulting set in a key", category: "set" },
  { name: "SISMEMBER", args: "key member", description: "Determine if a given value is a member of a set", category: "set" },
  { name: "SMEMBERS", args: "key", description: "Get all the members in a set", category: "set" },
  { name: "SMISMEMBER", args: "key member [member ...]", description: "Returns the membership associated with the given elements for a set", category: "set" },
  { name: "SMOVE", args: "source destination member", description: "Move a member from one set to another", category: "set" },
  { name: "SPOP", args: "key [count]", description: "Remove and return one or multiple random members from a set", category: "set" },
  { name: "SRANDMEMBER", args: "key [count]", description: "Get one or multiple random members from a set", category: "set" },
  { name: "SREM", args: "key member [member ...]", description: "Remove one or more members from a set", category: "set" },
  { name: "SSCAN", args: "key cursor [MATCH pattern] [COUNT count]", description: "Incrementally iterate Set elements", category: "set" },
  { name: "SUNION", args: "key [key ...]", description: "Add multiple sets", category: "set" },
  { name: "SUNIONSTORE", args: "destination key [key ...]", description: "Add multiple sets and store the resulting set in a key", category: "set" },

  // Sorted Set commands
  { name: "BZPOPMAX", args: "key [key ...] timeout", description: "Remove and return the member with the highest score from one or more sorted sets, or block until one is available", category: "sortedset" },
  { name: "BZPOPMIN", args: "key [key ...] timeout", description: "Remove and return the member with the lowest score from one or more sorted sets, or block until one is available", category: "sortedset" },
  { name: "ZADD", args: "key [NX|XX] [GT|LT] [CH] [INCR] score member [score member ...]", description: "Add one or more members to a sorted set, or update its score if it already exists", category: "sortedset" },
  { name: "ZCARD", args: "key", description: "Get the number of members in a sorted set", category: "sortedset" },
  { name: "ZCOUNT", args: "key min max", description: "Count the members in a sorted set with scores within the given values", category: "sortedset" },
  { name: "ZDIFF", args: "numkeys key [key ...] [WITHSCORES]", description: "Subtract multiple sorted sets", category: "sortedset" },
  { name: "ZDIFFSTORE", args: "destination numkeys key [key ...]", description: "Subtract multiple sorted sets and store the resulting sorted set in a new key", category: "sortedset" },
  { name: "ZINCRBY", args: "key increment member", description: "Increment the score of a member in a sorted set", category: "sortedset" },
  { name: "ZINTER", args: "numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE SUM|MIN|MAX] [WITHSCORES]", description: "Intersect multiple sorted sets", category: "sortedset" },
  { name: "ZINTERCARD", args: "numkeys key [key ...] [LIMIT limit]", description: "Intersect multiple sorted sets and return the cardinality of the result", category: "sortedset" },
  { name: "ZINTERSTORE", args: "destination numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE SUM|MIN|MAX]", description: "Intersect multiple sorted sets and store the resulting sorted set in a new key", category: "sortedset" },
  { name: "ZLEXCOUNT", args: "key min max", description: "Count the number of members in a sorted set between a given lexicographical range", category: "sortedset" },
  { name: "ZMPOP", args: "numkeys key [key ...] MIN|MAX [COUNT count]", description: "Remove and return members with scores in a sorted set", category: "sortedset" },
  { name: "ZMSCORE", args: "key member [member ...]", description: "Get the score associated with the given members in a sorted set", category: "sortedset" },
  { name: "ZPOPMAX", args: "key [count]", description: "Remove and return members with the highest scores in a sorted set", category: "sortedset" },
  { name: "ZPOPMIN", args: "key [count]", description: "Remove and return members with the lowest scores in a sorted set", category: "sortedset" },
  { name: "ZRANGE", args: "key start stop [BYSCORE|BYLEX] [REV] [LIMIT offset count] [WITHSCORES]", description: "Return a range of members in a sorted set", category: "sortedset" },
  { name: "ZRANGEBYLEX", args: "key min max [LIMIT offset count]", description: "Return a range of members in a sorted set, by lexicographical range", category: "sortedset" },
  { name: "ZRANGEBYSCORE", args: "key min max [WITHSCORES] [LIMIT offset count]", description: "Return a range of members in a sorted set, by score", category: "sortedset" },
  { name: "ZRANGESTORE", args: "dst src min max [BYSCORE|BYLEX] [REV] [LIMIT offset count]", description: "Store a range of members from sorted set into another key", category: "sortedset" },
  { name: "ZRANK", args: "key member [WITHSCORE]", description: "Determine the index of a member in a sorted set", category: "sortedset" },
  { name: "ZREM", args: "key member [member ...]", description: "Remove one or more members from a sorted set", category: "sortedset" },
  { name: "ZREMRANGEBYLEX", args: "key min max", description: "Remove all members in a sorted set between the given lexicographical range", category: "sortedset" },
  { name: "ZREMRANGEBYRANK", args: "key start stop", description: "Remove all members in a sorted set within the given indexes", category: "sortedset" },
  { name: "ZREMRANGEBYSCORE", args: "key min max", description: "Remove all members in a sorted set within the given scores", category: "sortedset" },
  { name: "ZREVRANGE", args: "key start stop [WITHSCORES]", description: "Return a range of members in a sorted set, by index, with scores ordered from high to low", category: "sortedset" },
  { name: "ZREVRANGEBYLEX", args: "key max min [LIMIT offset count]", description: "Return a range of members in a sorted set, by lexicographical range, ordered from higher to lower strings", category: "sortedset" },
  { name: "ZREVRANGEBYSCORE", args: "key max min [WITHSCORES] [LIMIT offset count]", description: "Return a range of members in a sorted set, by score, with scores ordered from high to low", category: "sortedset" },
  { name: "ZREVRANK", args: "key member", description: "Determine the index of a member in a sorted set, with scores ordered from high to low", category: "sortedset" },
  { name: "ZSCAN", args: "key cursor [MATCH pattern] [COUNT count]", description: "Incrementally iterate sorted sets elements and associated scores", category: "sortedset" },
  { name: "ZSCORE", args: "key member", description: "Get the score associated with the given member in a sorted set", category: "sortedset" },
  { name: "ZUNION", args: "numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE SUM|MIN|MAX] [WITHSCORES]", description: "Add multiple sorted sets", category: "sortedset" },
  { name: "ZUNIONSTORE", args: "destination numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE SUM|MIN|MAX]", description: "Add multiple sorted sets and store the resulting sorted set in a new key", category: "sortedset" },

  // Key commands
  { name: "COPY", args: "source destination [DB destination-db] [REPLACE]", description: "Copy a key", category: "key" },
  { name: "DEL", args: "key [key ...]", description: "Delete a key", category: "key" },
  { name: "DUMP", args: "key", description: "Return a serialized version of the value stored at the specified key", category: "key" },
  { name: "EXISTS", args: "key [key ...]", description: "Determine if a key exists", category: "key" },
  { name: "EXPIRE", args: "key seconds [NX|XX|GT|LT]", description: "Set a key's time to live in seconds", category: "key" },
  { name: "EXPIREAT", args: "key timestamp [NX|XX|GT|LT]", description: "Set the expiration for a key as a UNIX timestamp", category: "key" },
  { name: "EXPIRETIME", args: "key", description: "Get the expiration Unix timestamp for a key", category: "key" },
  { name: "FLUSHALL", args: "[ASYNC|SYNC]", description: "Remove all keys from all databases", category: "key", dangerous: true },
  { name: "FLUSHDB", args: "[ASYNC|SYNC]", description: "Remove all keys from the current database", category: "key", dangerous: true },
  { name: "KEYS", args: "pattern", description: "Find all keys matching the given pattern", category: "key" },
  { name: "MIGRATE", args: "host port key destination-db timeout [COPY] [REPLACE] [AUTH password] [AUTH2 username password] [KEYS key ...]", description: "Atomically transfer a key from a Redis instance to another one", category: "key" },
  { name: "MOVE", args: "key db", description: "Move a key to another database", category: "key" },
  { name: "OBJECT", args: "subcommand [arguments [arguments ...]]", description: "Inspect the internals of Redis objects", category: "key" },
  { name: "PERSIST", args: "key", description: "Remove the expiration from a key", category: "key" },
  { name: "PEXPIRE", args: "key milliseconds [NX|XX|GT|LT]", description: "Set a key's time to live in milliseconds", category: "key" },
  { name: "PEXPIREAT", args: "key milliseconds-timestamp [NX|XX|GT|LT]", description: "Set the expiration for a key as a UNIX timestamp specified in milliseconds", category: "key" },
  { name: "PEXPIRETIME", args: "key", description: "Get the expiration Unix timestamp for a key in milliseconds", category: "key" },
  { name: "PTTL", args: "key", description: "Get the time to live for a key in milliseconds", category: "key" },
  { name: "RANDOMKEY", args: "", description: "Return a random key from the keyspace", category: "key" },
  { name: "RENAME", args: "key newkey", description: "Rename a key", category: "key" },
  { name: "RENAMENX", args: "key newkey", description: "Rename a key, only if the new key does not exist", category: "key" },
  { name: "RESTORE", args: "key ttl serialized-value [REPLACE] [ABSTTL] [IDLETIME seconds] [FREQ frequency]", description: "Create a key using the provided serialized value, previously obtained using DUMP", category: "key" },
  { name: "SCAN", args: "cursor [MATCH pattern] [COUNT count] [TYPE type]", description: "Incrementally iterate the keys space", category: "key" },
  { name: "SORT", args: "key [BY pattern] [LIMIT offset count] [GET pattern [GET pattern ...]] [ASC|DESC] [ALPHA] [STORE destination]", description: "Sort the elements in a list, set or sorted set", category: "key" },
  { name: "SORT_RO", args: "key [BY pattern] [LIMIT offset count] [GET pattern [GET pattern ...]] [ASC|DESC] [ALPHA]", description: "Sort the elements in a list, set or sorted set. Read-only variant of SORT", category: "key" },
  { name: "TOUCH", args: "key [key ...]", description: "Alters the last access time of a key(s). Returns the number of existing keys specified", category: "key" },
  { name: "TTL", args: "key", description: "Get the time to live for a key", category: "key" },
  { name: "TYPE", args: "key", description: "Determine the type stored at key", category: "key" },
  { name: "UNLINK", args: "key [key ...]", description: "Delete a key asynchronously in another thread. Otherwise it is just as DEL, but non blocking", category: "key" },
  { name: "WAIT", args: "numreplicas timeout", description: "Wait for the synchronous replication of all the write commands sent in the context of the current connection", category: "key" },

  // Connection commands
  { name: "AUTH", args: "[username] password", description: "Authenticate to the server", category: "connection" },
  { name: "CLIENT", args: "subcommand [argument [argument ...]]", description: "Client connection subcommands", category: "connection" },
  { name: "ECHO", args: "message", description: "Echo the given string", category: "connection" },
  { name: "HELLO", args: "[protover [AUTH username password] [SETNAME clientname]]", description: "Handshake with Redis server", category: "connection" },
  { name: "PING", args: "[message]", description: "Ping the server", category: "connection" },
  { name: "QUIT", args: "", description: "Close the connection", category: "connection" },
  { name: "RESET", args: "", description: "Reset the connection", category: "connection" },
  { name: "SELECT", args: "index", description: "Change the selected database for the current connection", category: "connection" },

  // Server commands
  { name: "ACL", args: "subcommand [argument [argument ...]]", description: "ACL security rules", category: "server" },
  { name: "BGREWRITEAOF", args: "", description: "Asynchronously rewrite the append-only file", category: "server" },
  { name: "BGSAVE", args: "[SCHEDULE]", description: "Asynchronously save the dataset to disk", category: "server" },
  { name: "COMMAND", args: "", description: "Get Redis command details", category: "server" },
  { name: "CONFIG", args: "subcommand [argument [argument ...]]", description: "Get or set Redis server configuration parameters", category: "server" },
  { name: "DBSIZE", args: "", description: "Return the number of keys in the selected database", category: "server" },
  { name: "DEBUG", args: "subcommand [argument [argument ...]]", description: "Debugging subcommands", category: "server" },
  { name: "FAILOVER", args: "[TO host port [FORCE]] [ABORT] [TIMEOUT milliseconds]", description: "Start a coordinated failover between this server and another one", category: "server" },
  { name: "INFO", args: "[section]", description: "Get information and statistics about the server", category: "server" },
  { name: "LASTSAVE", args: "", description: "Get the UNIX time stamp of the last successful save to disk", category: "server" },
  { name: "LATENCY", args: "subcommand [argument [argument ...]]", description: "Latency monitoring subcommands", category: "server" },
  { name: "LCS", args: "key1 key2 [LEN] [IDX] [MINMATCHLEN min-match-len] [WITHMATCHLEN]", description: "Find longest common substring", category: "server" },
  { name: "MEMORY", args: "subcommand [argument [argument ...]]", description: "Memory usage diagnostic subcommands", category: "server" },
  { name: "MODULE", args: "subcommand [argument [argument ...]]", description: "Module commands", category: "server" },
  { name: "MONITOR", args: "", description: "Listen for all requests received by the server in real time", category: "server" },
  { name: "PSYNC", args: "replicationid offset", description: "Internal command used for replication", category: "server" },
  { name: "REPLCONF", args: "argument [argument ...]", description: "Internal command used for replication", category: "server" },
  { name: "REPLICAOF", args: "host port", description: "Make the server a replica of another instance, or promote it as master", category: "server" },
  { name: "RESTORE-ASKING", args: "", description: "Internal command related to Redis Cluster", category: "server" },
  { name: "ROLE", args: "", description: "Return the role of the instance in the context of replication", category: "server" },
  { name: "SAVE", args: "", description: "Synchronously save the dataset to disk", category: "server" },
  { name: "SHUTDOWN", args: "[NOSAVE|SAVE] [NOW] [FORCE] [ABORT]", description: "Synchronously save the dataset to disk and then shut down the server", category: "server", dangerous: true },
  { name: "SLAVEOF", args: "host port", description: "Make the server a slave of another instance, or promote it as master (deprecated)", category: "server" },
  { name: "SLOWLOG", args: "subcommand [argument]", description: "Manages the Redis slow queries log", category: "server" },
  { name: "SWAPDB", args: "index index", description: "Swaps two Redis databases", category: "server" },
  { name: "SYNC", args: "", description: "Internal command used for replication", category: "server" },
  { name: "TIME", args: "", description: "Return the current server time", category: "server" },
];

export const REDIS_COMMANDS_BY_CATEGORY: Record<RedisCommandCategory, RedisCommand[]> = {
  string: REDIS_COMMANDS.filter((cmd) => cmd.category === "string"),
  hash: REDIS_COMMANDS.filter((cmd) => cmd.category === "hash"),
  list: REDIS_COMMANDS.filter((cmd) => cmd.category === "list"),
  set: REDIS_COMMANDS.filter((cmd) => cmd.category === "set"),
  sortedset: REDIS_COMMANDS.filter((cmd) => cmd.category === "sortedset"),
  key: REDIS_COMMANDS.filter((cmd) => cmd.category === "key"),
  connection: REDIS_COMMANDS.filter((cmd) => cmd.category === "connection"),
  server: REDIS_COMMANDS.filter((cmd) => cmd.category === "server"),
  pubsub: REDIS_COMMANDS.filter((cmd) => cmd.category === "pubsub"),
  transaction: REDIS_COMMANDS.filter((cmd) => cmd.category === "transaction"),
  scripting: REDIS_COMMANDS.filter((cmd) => cmd.category === "scripting"),
  stream: REDIS_COMMANDS.filter((cmd) => cmd.category === "stream"),
  json: REDIS_COMMANDS.filter((cmd) => cmd.category === "json"),
  search: REDIS_COMMANDS.filter((cmd) => cmd.category === "search"),
};

export const DANGEROUS_COMMANDS = REDIS_COMMANDS.filter((cmd) => cmd.dangerous);

export function isDangerousCommand(commandName: string): boolean {
  return DANGEROUS_COMMANDS.some(
    (cmd) => cmd.name.toUpperCase() === commandName.toUpperCase()
  );
}

export const CATEGORY_LABELS: Record<RedisCommandCategory, string> = {
  string: "String",
  hash: "Hash",
  list: "List",
  set: "Set",
  sortedset: "Sorted Set",
  key: "Key",
  connection: "Connection",
  server: "Server",
  pubsub: "Pub/Sub",
  transaction: "Transaction",
  scripting: "Scripting",
  stream: "Stream",
  json: "JSON",
  search: "Search",
};

export const CATEGORY_COLORS: Record<RedisCommandCategory, string> = {
  string: "text-blue-500",
  hash: "text-green-500",
  list: "text-purple-500",
  set: "text-orange-500",
  sortedset: "text-pink-500",
  key: "text-red-500",
  connection: "text-cyan-500",
  server: "text-yellow-500",
  pubsub: "text-indigo-500",
  transaction: "text-teal-500",
  scripting: "text-lime-500",
  stream: "text-amber-500",
  json: "text-emerald-500",
  search: "text-violet-500",
};
