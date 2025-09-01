// Test script to verify the connection flow
// Run this in the browser console after loading the app

async function testConnectionFlow() {
  console.log("=== Testing Connection Flow ===");
  
  // 1. Clear existing data
  console.log("Step 1: Clearing existing data...");
  localStorage.clear();
  
  // 2. Create a test connection
  console.log("Step 2: Creating test connection...");
  const testConnection = {
    id: "test-postgres-" + Date.now(),
    name: "Test PostgreSQL",
    type: "postgresql",
    host: "localhost",
    port: 15432,
    database: "todoapp",
    username: "devuser",
    password: "devpass123",
    workspace: "Development",
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  // 3. Save to localStorage (simulating what the UI does)
  console.log("Step 3: Saving to localStorage...");
  const connections = [testConnection];
  localStorage.setItem("connections", JSON.stringify(connections));
  
  // 4. Test the connectById method
  console.log("Step 4: Testing connectById...");
  try {
    const { databaseService } = await import('/src/services/databaseService.ts');
    const result = await databaseService.connectById(testConnection.id);
    console.log("✅ Connection successful:", result);
    return result;
  } catch (error) {
    console.error("❌ Connection failed:", error);
    throw error;
  }
}

// Run the test
testConnectionFlow().then(
  result => console.log("=== Test Completed Successfully ===", result),
  error => console.error("=== Test Failed ===", error)
);