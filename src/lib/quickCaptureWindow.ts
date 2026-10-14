import { isAndroidRuntime } from "./platform";

export type FloatingCaptureMode = "note" | "mistake" | "lesson";

/**
 * Native desktop window exists hidden from app startup. The command reuses
 * the singleton; Android and ordinary browsers retain the inline capture.
 */
export async function showFloatingQuickCapture(mode: FloatingCaptureMode): Promise<boolean> {
  if (isAndroidRuntime() || !("__TAURI_INTERNALS__" in window)) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_quick_capture", { mode });
  return true;
}
