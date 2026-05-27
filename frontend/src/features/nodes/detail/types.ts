import type { NodeStatusPreview, OsType } from "../../../types";

export type NodeDetailTabKey = "monitor" | "config" | "tasks";

export type NodeEditForm = {
  display_name: string;
  hostname: string;
  os_type: OsType;
  heartbeat_interval_sec: number;
  allowed_workdirs: string;
  tags: string;
};

export type CpuSnapshot = {
  model?: string;
  logical_cores?: number;
  physical_cores?: number;
  usage_percent?: number;
  current_clock_mhz?: number;
  max_clock_mhz?: number;
  per_core_percent?: number[];
};

export type MemorySnapshot = {
  total_bytes?: number;
  used_bytes?: number;
  usage_percent?: number;
  available_bytes?: number;
  cached_bytes?: number;
  commit_used_bytes?: number;
  commit_limit_bytes?: number;
  paged_pool_bytes?: number;
  nonpaged_pool_bytes?: number;
  speed_mtps?: number;
  slots_used?: number;
  slots_total?: number;
  form_factor?: string;
  memory_type?: string;
  installed_bytes?: number;
  hardware_reserved_bytes?: number;
};

export type GpuSnapshot = {
  index?: number;
  model?: string;
  total_vram_mb?: number;
  used_vram_mb?: number;
  utilization_percent?: number;
  encoder_utilization_percent?: number;
  decoder_utilization_percent?: number;
  temperature_c?: number;
  power_draw_w?: number;
  power_limit_w?: number;
  clock_graphics_mhz?: number;
  clock_max_graphics_mhz?: number;
  clock_video_mhz?: number;
  fan_speed_percent?: number;
  pcie_gen?: number;
  pcie_width?: number;
  encoder_sessions?: number;
  decoder_sessions?: number;
};

export type NvidiaSnapshot = {
  driver_version?: string;
  cuda_version?: string;
  nvcc_version?: string;
  nvidia_smi_path?: string;
};

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

export type PythonEnvSnapshot = {
  python_version?: string;
  active_environment_kind?: string;
  active_environment_name?: string;
  supported_backends?: string[];
};

export type MonitorPanelProps = {
  nodeId: string;
  cpu: CpuSnapshot | undefined;
  memory: MemorySnapshot | undefined;
  pythonEnv: PythonEnvSnapshot | undefined;
  gpus: Array<Record<string, unknown>>;
  cpuUse: number;
  memUse: number;
  latestStatus: NodeStatusPreview | null;
  showJson: boolean;
  setShowJson: (next: boolean) => void;
};
