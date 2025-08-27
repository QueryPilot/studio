// Create user for todoapp database
// This script runs in the admin database context

db = db.getSiblingDB('admin');

// Authenticate as root first (using environment variables)
db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);

// Switch to todoapp database
db = db.getSiblingDB('todoapp');

// Create user with readWrite permissions on todoapp database
db.createUser({
  user: "devuser",
  pwd: "devpass123",
  roles: [
    { role: "readWrite", db: "todoapp" },
    { role: "dbAdmin", db: "todoapp" }
  ]
});

print("User 'devuser' created for todoapp database");