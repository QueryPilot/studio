/**
 * ACP Permission Request Store
 *
 * Manages pending ACP permission requests from AI agents.
 * Listens for `acp-permission-request` events from the backend
 * and shows inline toast notifications for user approval.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type { AcpPermissionRequest } from "@/types/acp";
import { AcpService } from "@/services/acpService";

// Track responded requests to prevent double-response from Sonner's onDismiss
const respondedRequests = new Set<string>();

async function respondToPermission(requestId: string, optionId: string): Promise<void> {
  if (respondedRequests.has(requestId)) return;
  respondedRequests.add(requestId);
  // Clean up after backend timeout window passes
  setTimeout(() => respondedRequests.delete(requestId), 70_000);

  try {
    await AcpService.respondPermission(requestId, optionId);
  } catch (err) {
    console.warn("Failed to respond to permission request:", err);
  }
}

function showPermissionToast(request: AcpPermissionRequest): void {
  const allowOption = request.options.find(
    (o) => o.kind === "allowonce" || o.kind === "allowalways",
  );
  const rejectOption = request.options.find(
    (o) => o.kind === "rejectonce" || o.kind === "rejectalways",
  );

  // Extract command text for display
  const rawInput = request.rawInput;
  let commandText: string | undefined;
  if (rawInput) {
    const val = rawInput.command ?? rawInput.cmd ?? rawInput.input;
    if (typeof val === "string") {
      commandText = val;
    }
  }

  const description = commandText
    ? `${request.title}\n${commandText.slice(0, 200)}`
    : request.title;

  toast.warning("Agent Permission Request", {
    id: `acp-perm-${request.requestId}`,
    description,
    duration: 55_000, // slightly under the 60s backend timeout
    action: allowOption
      ? {
          label: allowOption.name,
          onClick: () => {
            void respondToPermission(request.requestId, allowOption.optionId);
          },
        }
      : undefined,
    cancel: rejectOption
      ? {
          label: rejectOption.name,
          onClick: () => {
            void respondToPermission(request.requestId, rejectOption.optionId);
          },
        }
      : undefined,
    onDismiss: () => {
      // If dismissed without action, reject
      if (rejectOption) {
        void respondToPermission(request.requestId, rejectOption.optionId);
      }
    },
    onAutoClose: () => {
      // Toast expired — reject so backend doesn't wait the full 60s timeout
      if (rejectOption) {
        void respondToPermission(request.requestId, rejectOption.optionId);
      }
    },
  });
}

// Global listener setup (called once at app startup)
let listenerCleanup: UnlistenFn | null = null;

export async function initAcpPermissionListener(): Promise<void> {
  if (listenerCleanup) return;

  listenerCleanup = await listen<AcpPermissionRequest>(
    "acp-permission-request",
    (event) => {
      const request = event.payload;
      console.log("[ACP] Permission request received:", request.requestId, request.title);
      showPermissionToast(request);
    },
  );
}

export function cleanupAcpPermissionListener(): void {
  listenerCleanup?.();
  listenerCleanup = null;
}
