// Simple encryption/decryption for database credentials
// In production, you should use a more secure approach with proper key management

const ENCRYPTION_KEY = "devdb-studio-encryption-key-2024"; // This should be stored securely

export async function encryptCredentials(text: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("Encryption error:", error);
    // Fallback to base64 encoding if encryption fails
    return btoa(text);
  }
}

export async function decryptCredentials(encryptedText: string): Promise<string> {
  try {
    const combined = new Uint8Array(
      atob(encryptedText).split('').map(char => char.charCodeAt(0))
    );
    
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Decryption error:", error);
    // Fallback to base64 decoding if decryption fails
    try {
      return atob(encryptedText);
    } catch {
      return encryptedText;
    }
  }
}