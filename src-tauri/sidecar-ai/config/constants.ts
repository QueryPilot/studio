// Hardcoded port - do not change unless you also update the frontend
export const PORT = 47856;

// Allowed CORS origins - only allow requests from Tauri webview and localhost dev server
export const ALLOWED_ORIGINS = [
  "tauri://localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
];

export const MAX_TOOL_STEPS = 25;

// Tauri HTTP API server for AI tools (different from frontend port)
export const TAURI_API_URL = "http://localhost:14420";
