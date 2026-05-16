export const PHYSICAL_TASK_TYPES = [
  "shell",
  "python_script",
  "health_check",
  "download_file",
  "git_pull",
  "pip_install",
  "file_preview",
  "file_mkdir",
  "file_write",
  "file_patch_text",
  "file_move",
  "file_delete",
  "file_extract",
] as const;

export const MODAL_TASK_TYPES = ["health_check", "modal_command"] as const;

export type TaskTypeName = (typeof PHYSICAL_TASK_TYPES)[number] | (typeof MODAL_TASK_TYPES)[number];

export function allowedTaskTypes(nodeType: string | null | undefined): readonly string[] {
  return nodeType === "modal_runner" ? MODAL_TASK_TYPES : PHYSICAL_TASK_TYPES;
}

export type PayloadShape = "command" | "script" | "json" | "none";

export function payloadShape(taskType: string): PayloadShape {
  if (taskType === "shell" || taskType === "modal_command") return "command";
  if (taskType === "python_script") return "script";
  if (taskType === "health_check") return "none";
  return "json";
}

export function defaultPayloadText(taskType: string): string {
  switch (taskType) {
    case "shell":
      return "Write-Output 'hello from GPUFleet'";
    case "modal_command":
      return "modal run app.py";
    case "python_script":
      return "import platform\nprint(platform.platform())";
    case "git_pull":
      return JSON.stringify({ repo_url: "https://github.com/example/repo", branch: "main", repo_dir: "repos/example" }, null, 2);
    case "pip_install":
      return JSON.stringify({ packages: ["requests"], use_uv: false }, null, 2);
    case "download_file":
      return JSON.stringify({ url: "https://example.com/file.bin", target_path: "downloads/file.bin" }, null, 2);
    case "file_preview":
      return JSON.stringify({ target_path: "logs/example.log", max_bytes: 4096 }, null, 2);
    case "file_mkdir":
      return JSON.stringify({ target_path: "runs/new_dir" }, null, 2);
    case "file_write":
      return JSON.stringify({ target_path: "runs/note.txt", content: "hello" }, null, 2);
    case "file_patch_text":
      return JSON.stringify({ target_path: "runs/note.txt", anchor: "old", replacement: "new" }, null, 2);
    case "file_move":
      return JSON.stringify({ source_path: "runs/a.txt", target_path: "runs/b.txt" }, null, 2);
    case "file_delete":
      return JSON.stringify({ target_path: "runs/a.txt" }, null, 2);
    case "file_extract":
      return JSON.stringify({ archive_path: "downloads/archive.zip", target_path: "repos/extracted" }, null, 2);
    case "health_check":
      return "{}";
    default:
      return "{}";
  }
}

export function buildPayload(taskType: string, raw: string): Record<string, unknown> {
  const shape = payloadShape(taskType);
  if (shape === "command") return { command: raw };
  if (shape === "script") return { script: raw };
  if (shape === "none") return {};
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error("payload 必须是 JSON 对象");
}
