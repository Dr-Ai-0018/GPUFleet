import type { components } from "../../../types.generated";
import type { NodeStatusPreview, OsType } from "../../../types";

type Schemas = components["schemas"];

export type NodeDetailTabKey = "monitor" | "config" | "tasks";

export type NodeEditForm = {
  display_name: string;
  hostname: string;
  os_type: OsType;
  heartbeat_interval_sec: number;
  allowed_workdirs: string;
  tags: string;
};

export type CpuSnapshot = Schemas["HeartbeatCpu"];
export type MemorySnapshot = Schemas["HeartbeatMemory"];
export type GpuSnapshot = Schemas["HeartbeatGpu"];
export type NvidiaSnapshot = Schemas["HeartbeatNvidia"];
export type PythonEnvSnapshot = Schemas["HeartbeatPythonEnv"];

export type NetworkSnapshot = {
  adapter_name?: string;
  interface_description?: string;
  link_speed?: string;
  mac_address?: string;
  ipv4_address?: string;
  ipv6_address?: string;
  ssid?: string;
  signal?: string;
  radio_type?: string;
  tx_bytes_per_sec?: number;
  rx_bytes_per_sec?: number;
};

export type MonitorPanelProps = {
  nodeId: string;
  cpu: CpuSnapshot | undefined;
  memory: MemorySnapshot | undefined;
  pythonEnv: PythonEnvSnapshot | undefined;
  gpus: GpuSnapshot[];
  cpuUse: number;
  memUse: number;
  latestStatus: NodeStatusPreview | null;
  showJson: boolean;
  setShowJson: (next: boolean) => void;
};
