import type { NodeType, OsType } from "../../types";

export type NodeFormShape = {
  node_id: string;
  display_name: string;
  node_type: NodeType;
  os_type: OsType;
  heartbeat_interval_sec: number;
  allowed_workdirs: string;
  tags: string;
};

export function defaultWorkdir(nodeType: NodeType, osType: OsType): string {
  if (nodeType === "modal_runner") return "/opt/gpufleet-modal-runner";
  if (osType === "linux") return "/opt/gpufleet-node";
  return "E:/GPUFleetNode";
}

export function defaultTags(nodeType: NodeType, osType: OsType): string {
  if (nodeType === "modal_runner") return "modal, runner";
  if (osType === "linux") return "linux";
  return "windows";
}

export function buildInitialForm(): NodeFormShape {
  return {
    node_id: "",
    display_name: "",
    node_type: "physical",
    os_type: "windows",
    heartbeat_interval_sec: 5,
    allowed_workdirs: defaultWorkdir("physical", "windows"),
    tags: defaultTags("physical", "windows"),
  };
}

export function suggestedNodeId(displayName: string, nodeType: NodeType): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  if (!base) return "";
  return nodeType === "modal_runner" ? `node-modal-${base}` : `node-${base}`;
}
