/**
 * Image utilities for AI chat paste/drop support.
 *
 * Handles image validation, resizing, and format conversion
 * for sending images alongside chat prompts.
 */

import { nanoid } from "nanoid";

// ============================================================================
// Constants
// ============================================================================

/** Maximum raw file size (5 MB) */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Maximum number of images per message */
export const MAX_IMAGES = 3;

/** Maximum dimension (longest side) before resizing */
export const MAX_DIMENSION = 1568;

/** Accepted MIME types */
const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

// ============================================================================
// Types
// ============================================================================

export interface PreparedImage {
  id: string;
  /** Base64 data without data-URL prefix */
  data: string;
  mimeType: string;
  /** Object URL for preview rendering (must be revoked on cleanup) */
  previewUrl: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate a single image file.
 * @returns Error message string, or null if valid.
 */
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return `Unsupported format: ${file.type || "unknown"}. Use PNG, JPEG, GIF, or WebP.`;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `File too large (${sizeMB} MB). Maximum is 5 MB.`;
  }
  return null;
}

/**
 * Resize an image file if needed and convert to PreparedImage.
 * - If any dimension exceeds MAX_DIMENSION, scales down proportionally.
 * - Resized images are output as JPEG 0.85; originals keep their format.
 */
export async function resizeImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;

  let blob: Blob;
  let mimeType: string;

  if (needsResize) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);

    const canvas = new OffscreenCanvas(newW, newH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas 2d context");
    ctx.drawImage(bitmap, 0, 0, newW, newH);

    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    mimeType = "image/jpeg";
  } else {
    blob = file;
    mimeType = file.type;
  }

  bitmap.close();

  const data = await blobToBase64(blob);
  const previewUrl = URL.createObjectURL(blob === file ? file : blob);

  return { id: nanoid(), data, mimeType, previewUrl };
}

/**
 * Extract image files from a ClipboardEvent (paste).
 */
export function extractImagesFromPaste(e: ClipboardEvent): File[] {
  const files: File[] = [];
  const items = e.clipboardData?.items;
  if (!items) return files;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

/**
 * Extract image files from a DragEvent (drop).
 */
export function extractImagesFromDrop(e: DragEvent): File[] {
  const files: File[] = [];
  const dt = e.dataTransfer;
  if (!dt) return files;

  for (let i = 0; i < dt.files.length; i++) {
    const file = dt.files[i];
    if (file && file.type.startsWith("image/")) {
      files.push(file);
    }
  }
  return files;
}

/**
 * Revoke object URLs for cleanup.
 */
export function revokeImagePreviews(images: PreparedImage[]): void {
  for (const img of images) {
    URL.revokeObjectURL(img.previewUrl);
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix ("data:image/png;base64,...")
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => {
      reject(new Error("Failed to read image"));
    };
    reader.readAsDataURL(blob);
  });
}
