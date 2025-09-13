// Test script to verify the new connection API works
// Run this in the browser console when the app is running

async function testConnectionAPI() {
  console.log("Testing new connection management API...");
  
  try {
    // Test 1: List connections
    console.log("\n1. Listing all connections:");
    const connections = await window.__TAURI__.core.invoke('list_connections');
    console.log("Current connections:", connections);
    
    // Test 2: Add a test connection
    console.log("\n2. Adding test PostgreSQL connection:");
    const testConnection = {
      id: "",
      name: "Test PostgreSQL",
      db_type: "PostgreSQL",
      host: "localhost",
      port: 5432,
      database: "testdb",
      username: "testuser",
      password: "testpass",
      ssl_mode: "Disable",
      options: {}
    };
    
    const id = await window.__TAURI__.core.invoke('store_connection_with_event', { 
      connection: testConnection 
    });
    console.log("Created connection with ID:", id);
    
    // Test 3: Set active connection for window
    console.log("\n3. Setting active connection for current window:");
    await window.__TAURI__.core.invoke('set_active_connection', { 
      connectionId: id 
    });
    console.log("Active connection set");
    
    // Test 4: Get active connection
    console.log("\n4. Getting active connection for current window:");
    const activeId = await window.__TAURI__.core.invoke('get_active_connection');
    console.log("Active connection ID:", activeId);
    
    // Test 5: Get window states
    console.log("\n5. Getting all window states:");
    const states = await window.__TAURI__.core.invoke('get_window_states');
    console.log("Window states:", states);
    
    console.log("\n✅ All tests passed!");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the test
testConnectionAPI();