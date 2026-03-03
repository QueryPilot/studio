import { invoke } from "@tauri-apps/api/core";

/**
 * Write a UTF-8 string to a file using Tauri's fs plugin.
 *
 * The plugin expects the file path as an IPC header and the content
 * as raw bytes in the request body.
 */
export async function writeTextFile(
  path: string,
  contents: string,
): Promise<void> {
  await invoke(
    "plugin:fs|write_text_file",
    new TextEncoder().encode(contents),
    {
      headers: {
        path: encodeURIComponent(path),
      },
    },
  );
}

/**
 * Write binary data to a file using Tauri's fs plugin.
 *
 * The plugin expects the file path as an IPC header and the raw
 * bytes in the request body.
 */
export async function writeBinaryFile(
  path: string,
  data: Uint8Array,
): Promise<void> {
  await invoke("plugin:fs|write_file", data, {
    headers: {
      path: encodeURIComponent(path),
    },
  });
}
