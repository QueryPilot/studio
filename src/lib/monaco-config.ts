import * as monaco from 'monaco-editor';

// Create a custom clipboard implementation that doesn't throw errors
class SafeClipboard {
  private fallbackElement: HTMLTextAreaElement | null = null;

  async writeText(text: string): Promise<void> {
    try {
      // Try Tauri clipboard first if available
      if (window.__TAURI__) {
        try {
          const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
          await writeText(text);
          return;
        } catch (e) {
          // Fall through to browser API
        }
      }

      // Try native clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) {
      // Use fallback method
      this.fallbackCopy(text);
    }
  }

  async readText(): Promise<string> {
    try {
      // Try Tauri clipboard first if available
      if (window.__TAURI__) {
        try {
          const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
          const text = await readText();
          return text || '';
        } catch (e) {
          // Fall through to browser API
        }
      }

      // Try native clipboard API
      if (navigator.clipboard && navigator.clipboard.readText) {
        return await navigator.clipboard.readText();
      }
    } catch (e) {
      // Return empty string if all methods fail
      return '';
    }
    return '';
  }

  private fallbackCopy(text: string): void {
    // Create a textarea element for fallback copy
    if (!this.fallbackElement) {
      this.fallbackElement = document.createElement('textarea');
      this.fallbackElement.style.position = 'fixed';
      this.fallbackElement.style.top = '-9999px';
      this.fallbackElement.style.left = '-9999px';
      document.body.appendChild(this.fallbackElement);
    }

    this.fallbackElement.value = text;
    this.fallbackElement.select();
    
    try {
      document.execCommand('copy');
    } catch (e) {
      console.warn('Fallback copy failed');
    }
  }
}

// Disable clipboard operations that might fail in Tauri context
export function configureMonaco() {
  // Create safe clipboard instance
  const safeClipboard = new SafeClipboard();

  // Override navigator.clipboard with our safe implementation
  if (typeof window !== 'undefined') {
    // Store original clipboard
    const originalClipboard = navigator.clipboard;

    // Create proxy that intercepts clipboard calls
    Object.defineProperty(navigator, 'clipboard', {
      get() {
        return {
          writeText: (text: string) => safeClipboard.writeText(text),
          readText: () => safeClipboard.readText(),
          // Keep other methods if they exist
          write: originalClipboard?.write?.bind(originalClipboard),
          read: originalClipboard?.read?.bind(originalClipboard),
        };
      },
      configurable: true,
    });
  }
}

// Initialize Monaco configuration
configureMonaco();