export const PHYSICAL_TASK_TYPES = [
  "shell",
  "python_script",
  "health_check",
  "download_file",
  "upload_and_unpack",
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
export type PayloadShape = "command" | "script" | "json" | "none";

export type TaskTypeMeta = {
  label: string;
  shape: PayloadShape;
  description: string;
  defaultPayload: string;
};

const EXECUTION_OVERRIDES = new Set(["shell", "python_script", "pip_install"]);

const META: Record<string, TaskTypeMeta> = {
  shell: {
    label: "Shell 命令",
    shape: "command",
    description: "原始命令逃生口。Windows 走 PowerShell，Linux 走 bash。",
    defaultPayload: "Write-Output 'hello from GPUFleet'",
  },
  python_script: {
    label: "Python 脚本",
    shape: "script",
    description: "将内联 Python 写入临时脚本后执行。",
    defaultPayload: "import platform\nprint(platform.platform())",
  },
  health_check: {
    label: "健康检查",
    shape: "none",
    description: "回传 CPU / 内存 / 磁盘 / GPU / Python / Modal 运行时状态。",
    defaultPayload: "{}",
  },
  download_file: {
    label: "下载文件",
    shape: "json",
    description: "从 URL 下载文件到允许目录，并生成下载摘要产物。",
    defaultPayload: JSON.stringify(
      { url: "https://example.com/file.bin", target_path: "downloads/file.bin" },
      null,
      2,
    ),
  },
  upload_and_unpack: {
    label: "解压归档",
    shape: "json",
    description: "将现有 zip 归档解压到目标目录。",
    defaultPayload: JSON.stringify(
      { archive_path: "downloads/archive.zip", target_dir: "repos/extracted" },
      null,
      2,
    ),
  },
  git_pull: {
    label: "拉取仓库",
    shape: "json",
    description: "首次会 clone，已有仓库则 pull，可指定 branch。",
    defaultPayload: JSON.stringify(
      { repo_url: "https://github.com/example/repo", branch: "main", repo_dir: "repos/example" },
      null,
      2,
    ),
  },
  pip_install: {
    label: "安装依赖",
    shape: "json",
    description: "通过 pip 安装包，可附带 extra_args。",
    defaultPayload: JSON.stringify({ packages: ["requests"], extra_args: [] }, null, 2),
  },
  file_preview: {
    label: "文件预览",
    shape: "json",
    description: "预览文件内容或列出目录条目，结果作为产物回传。",
    defaultPayload: JSON.stringify({ path: "logs/example.log", max_chars: 4000 }, null, 2),
  },
  file_mkdir: {
    label: "创建目录",
    shape: "json",
    description: "在允许目录下创建文件夹。",
    defaultPayload: JSON.stringify({ path: "runs/new_dir" }, null, 2),
  },
  file_write: {
    label: "写文件",
    shape: "json",
    description: "向目标文件写入文本内容。",
    defaultPayload: JSON.stringify({ path: "runs/note.txt", content: "hello" }, null, 2),
  },
  file_patch_text: {
    label: "文本替换",
    shape: "json",
    description: "对文本文件做一次或全量替换。",
    defaultPayload: JSON.stringify(
      { path: "runs/note.txt", old_text: "old", new_text: "new", replace_all: false },
      null,
      2,
    ),
  },
  file_move: {
    label: "移动文件",
    shape: "json",
    description: "移动或重命名文件/目录。",
    defaultPayload: JSON.stringify({ source: "runs/a.txt", target: "runs/b.txt" }, null, 2),
  },
  file_delete: {
    label: "删除路径",
    shape: "json",
    description: "删除允许目录内的文件或目录。",
    defaultPayload: JSON.stringify({ path: "runs/a.txt" }, null, 2),
  },
  file_extract: {
    label: "解包文件",
    shape: "json",
    description: "解压 zip 文件到目标目录。",
    defaultPayload: JSON.stringify(
      { archive_path: "downloads/archive.zip", target_dir: "repos/extracted" },
      null,
      2,
    ),
  },
  modal_command: {
    label: "Modal 命令",
    shape: "json",
    description: "在 modal_runner 上执行结构化 Modal CLI 任务。",
    defaultPayload: JSON.stringify(
      {
        script_path: "train_job.py",
        entrypoint: "main",
        args: ["--epochs", "50"],
        timestamps: true,
      },
      null,
      2,
    ),
  },
};

export function allowedTaskTypes(nodeType: string | null | undefined): readonly string[] {
  return nodeType === "modal_runner" ? MODAL_TASK_TYPES : PHYSICAL_TASK_TYPES;
}

export function payloadShape(taskType: string): PayloadShape {
  return META[taskType]?.shape ?? "json";
}

export function defaultPayloadText(taskType: string): string {
  return META[taskType]?.defaultPayload ?? "{}";
}

export function taskTypeMeta(taskType: string): TaskTypeMeta {
  return (
    META[taskType] ?? {
      label: taskType,
      shape: "json",
      description: "未登记任务类型，按 JSON payload 发送。",
      defaultPayload: "{}",
    }
  );
}

export function supportsExecutionOverrides(taskType: string): boolean {
  return EXECUTION_OVERRIDES.has(taskType);
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
