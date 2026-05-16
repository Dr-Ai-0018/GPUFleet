import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  cancelTask,
  createNode,
  createTask,
  getAuditEvents,
  getOverview,
  getSecurityWarnings,
  getTaskDetail,
  getNodes,
  login,
} from "./api";
import type {
  AdminTaskDetail,
  AuditEventView,
  DashboardOverview,
  DashboardTaskSummary,
  NodeCreateResponse,
  NodeResponse,
  SecurityWarningView,
} from "./types";

const tokenStorageKey = "gpufleet-console-token";

function formatTime(value: string | null | undefined): string {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function statusTone(status: string): string {
  switch (status) {
    case "online":
    case "connected":
    case "succeeded":
      return "good";
    case "running":
    case "claimed":
      return "work";
    case "offline":
    case "failed":
    case "timeout":
    case "cancelled":
      return "bad";
    case "awaiting_first_heartbeat":
    case "never_seen":
      return "fleet";
    default:
      return "idle";
  }
}

const PHYSICAL_TASK_TYPES = [
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

const MODAL_TASK_TYPES = ["health_check", "modal_command"] as const;

function getAllowedTaskTypes(nodeType: string | null | undefined): readonly string[] {
  return nodeType === "modal_runner" ? MODAL_TASK_TYPES : PHYSICAL_TASK_TYPES;
}

function defaultAllowedWorkdir(nodeType: string, osType: string): string {
  if (nodeType === "modal_runner") return "/opt/gpufleet-modal-runner";
  if (osType === "linux") return "/opt/gpufleet-node";
  return "E:/GPUFleetNode";
}

export default function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(tokenStorageKey) ?? "");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123456");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [nodes, setNodes] = useState<NodeResponse[]>([]);
  const [selectedTask, setSelectedTask] = useState<AdminTaskDetail | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [securityWarnings, setSecurityWarnings] = useState<SecurityWarningView[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [latestOnboarding, setLatestOnboarding] = useState<NodeCreateResponse | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [newNodeId, setNewNodeId] = useState("node-");
  const [newNodeName, setNewNodeName] = useState("");
  const [newNodeType, setNewNodeType] = useState<"physical" | "modal_runner" | "control_plane">("physical");
  const [newNodeOs, setNewNodeOs] = useState<"windows" | "linux">("windows");
  const [newNodeHeartbeat, setNewNodeHeartbeat] = useState("5");
  const [newNodeWorkdirs, setNewNodeWorkdirs] = useState("E:/GPUFleetNode");
  const [newNodeTags, setNewNodeTags] = useState("desktop");

  const [taskNodeId, setTaskNodeId] = useState("");
  const [taskType, setTaskType] = useState("shell");
  const [taskWorkdir, setTaskWorkdir] = useState("");
  const [taskTimeout, setTaskTimeout] = useState("3600");
  const [taskCommand, setTaskCommand] = useState("Write-Output 'hello from GPUFleet'");
  const [taskEnv, setTaskEnv] = useState("{\n  \"EXAMPLE\": \"1\"\n}");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load() {
      try {
        const [overviewData, nodeData, auditData, warningData] = await Promise.all([
          getOverview(token),
          getNodes(token),
          getAuditEvents(token, 30),
          getSecurityWarnings(token, 30),
        ]);
        if (cancelled) return;
        setOverview(overviewData);
        setNodes(nodeData);
        setAuditEvents(auditData);
        setSecurityWarnings(warningData);
        if (!selectedNodeId) {
          const preferred = nodeData[0]?.node_id ?? "";
          setSelectedNodeId(preferred);
        }
        if (!taskNodeId) {
          const preferred = nodeData[0]?.node_id ?? "";
          setTaskNodeId(preferred);
          if (nodeData[0]) setTaskWorkdir(nodeData[0].allowed_workdirs[0] ?? "");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载控制台数据失败");
        }
      }
    }
    void load();
    const timer = window.setInterval(() => setRefreshTick((value) => value + 1), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function refresh() {
      try {
        const [overviewData, nodeData, auditData, warningData] = await Promise.all([
          getOverview(token),
          getNodes(token),
          getAuditEvents(token, 30),
          getSecurityWarnings(token, 30),
        ]);
        if (cancelled) return;
        setOverview(overviewData);
        setNodes(nodeData);
        setAuditEvents(auditData);
        setSecurityWarnings(warningData);
        if (selectedTaskId) {
          const detail = await getTaskDetail(token, selectedTaskId);
          if (!cancelled) setSelectedTask(detail);
        }
      } catch {
        // quiet refresh
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, token, selectedTaskId]);

  useEffect(() => {
    if (newNodeType === "modal_runner") {
      setNewNodeOs("linux");
    }
  }, [newNodeType]);

  useEffect(() => {
    if (!newNodeName.trim()) return;
    setNewNodeWorkdirs(defaultAllowedWorkdir(newNodeType, newNodeOs));
  }, [newNodeType, newNodeOs, newNodeName]);

  useEffect(() => {
    const current = nodes.find((node) => node.node_id === taskNodeId);
    if (current && !current.allowed_workdirs.includes(taskWorkdir)) {
      setTaskWorkdir(current.allowed_workdirs[0] ?? "");
    }
  }, [nodes, taskNodeId, taskWorkdir]);

  const selectedNode = useMemo(
    () => overview?.nodes.find((node) => node.node_id === selectedNodeId) ?? null,
    [overview, selectedNodeId],
  );
  const selectedNodeRecord = useMemo(
    () => nodes.find((node) => node.node_id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const taskTargetNode = useMemo(
    () => nodes.find((node) => node.node_id === taskNodeId) ?? null,
    [nodes, taskNodeId],
  );
  const allowedTaskTypes = getAllowedTaskTypes(taskTargetNode?.node_type);
  const canDispatchTask =
    !!taskTargetNode &&
    taskTargetNode.connection_status === "online" &&
    taskTargetNode.onboarding_status === "connected" &&
    taskTargetNode.is_enabled;

  useEffect(() => {
    if (!allowedTaskTypes.includes(taskType)) {
      setTaskType(allowedTaskTypes[0] ?? "shell");
      setTaskCommand(taskTargetNode?.node_type === "modal_runner" ? "modal run app.py" : "Write-Output 'hello from GPUFleet'");
      setTaskEnv("{}");
    }
  }, [allowedTaskTypes, taskTargetNode?.node_type, taskType]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const pair = await login(username, password);
      localStorage.setItem(tokenStorageKey, pair.access_token);
      setToken(pair.access_token);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateNode(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const payload = await createNode(token, {
        node_id: newNodeId.trim(),
        display_name: newNodeName.trim(),
        node_type: newNodeType,
        os_type: newNodeOs,
        heartbeat_interval_sec: Number(newNodeHeartbeat),
        allowed_workdirs: newNodeWorkdirs
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
        tags: newNodeTags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setLatestOnboarding(payload);
      setSelectedNodeId(payload.node_id);
      setTaskNodeId(payload.node_id);
      setTaskWorkdir(payload.allowed_workdirs[0] ?? "");
      setRefreshTick((value) => value + 1);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建节点失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectTask(task: DashboardTaskSummary) {
    if (!token) return;
    setError("");
    setSelectedTaskId(task.task_id);
    try {
      setSelectedTask(await getTaskDetail(token, task.task_id));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "加载任务详情失败");
    }
  }

  async function handleCreateTask(event: FormEvent) {
    event.preventDefault();
    if (!token || !canDispatchTask) return;
    setLoading(true);
    setError("");
    try {
      const parsedEnv = taskEnv.trim() ? (JSON.parse(taskEnv) as Record<string, string>) : {};
      const payload =
        taskType === "python_script"
          ? { script: taskCommand }
          : taskType === "shell" || taskType === "modal_command"
            ? { command: taskCommand }
            : taskType === "health_check"
              ? {}
              : (JSON.parse(taskCommand) as Record<string, unknown>);
      const created = await createTask(token, {
        node_id: taskNodeId,
        type: taskType,
        payload,
        workdir: taskWorkdir || null,
        env: parsedEnv,
        timeout_sec: Number(taskTimeout),
      });
      setSelectedTaskId(created.task_id);
      setSelectedTask(created);
      setRefreshTick((value) => value + 1);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建任务失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelTask() {
    if (!token || !selectedTask) return;
    setLoading(true);
    try {
      const updated = await cancelTask(token, selectedTask.task_id);
      setSelectedTask(updated);
      setRefreshTick((value) => value + 1);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "取消任务失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("复制失败，请手动复制。");
    }
  }

  function handleLogout() {
    localStorage.removeItem(tokenStorageKey);
    setToken("");
    setOverview(null);
    setSelectedTask(null);
    setSelectedTaskId("");
    setLatestOnboarding(null);
  }

  function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setTaskNodeId(nodeId);
    const matched = nodes.find((node) => node.node_id === nodeId);
    if (matched) {
      setTaskWorkdir(matched.allowed_workdirs[0] ?? "");
    }
  }

  if (!token) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="eyebrow">GPUFleet Console</div>
          <h1>节点接入主控台</h1>
          <p>先登录主控，再创建节点、发放接入密钥，并等待首个签名心跳完成接入。</p>
          <form onSubmit={handleLogin} className="form-stack">
            <label>
              <span>管理员账号</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              <span>密码</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "登录中..." : "进入控制台"}
            </button>
          </form>
          {error ? <pre className="error-box">{error}</pre> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="console-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">GPUFleet v0.1</div>
          <h1>节点接入与 GPU 舰队总控台</h1>
          <p>第一优先级是让节点接入成功。先创建节点、发放接入包、确认首心跳，再做任务派发。</p>
        </div>
        <div className="hero-actions">
          <div className="meta-chip">上次刷新 {overview ? formatTime(overview.server_time) : "等待中"}</div>
          <button className="ghost" onClick={() => setRefreshTick((value) => value + 1)}>
            手动刷新
          </button>
          <button className="ghost" onClick={handleLogout}>
            退出
          </button>
        </div>
      </header>

      {error ? <pre className="error-box">{error}</pre> : null}

      <section className="stats-grid">
        {overview
          ? [
              ["节点总数", String(overview.node_counts.total ?? 0), "fleet"],
              ["等待首心跳", String(overview.node_counts.never_seen ?? 0), "fleet"],
              ["在线节点", String(overview.node_counts.online ?? 0), "good"],
              ["离线节点", String(overview.node_counts.offline ?? 0), "bad"],
            ].map(([label, value, tone]) => (
              <article key={label} className={`stat-card tone-${tone}`}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))
          : null}
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>新建节点</h2>
            <span>Provision</span>
          </div>
          <form className="form-stack" onSubmit={handleCreateNode}>
            <label>
              <span>节点名称</span>
              <input value={newNodeName} onChange={(event) => setNewNodeName(event.target.value)} placeholder="例如：台式机 RTX5080" />
            </label>
            <label>
              <span>node_id</span>
              <input value={newNodeId} onChange={(event) => setNewNodeId(event.target.value)} placeholder="例如：node-desktop-5080" />
            </label>
            <label>
              <span>节点类型</span>
              <select value={newNodeType} onChange={(event) => setNewNodeType(event.target.value as "physical" | "modal_runner" | "control_plane")}>
                <option value="physical">physical</option>
                <option value="modal_runner">modal_runner</option>
                <option value="control_plane">control_plane</option>
              </select>
            </label>
            <label>
              <span>操作系统</span>
              <select value={newNodeOs} onChange={(event) => setNewNodeOs(event.target.value as "windows" | "linux")} disabled={newNodeType === "modal_runner"}>
                <option value="windows">windows</option>
                <option value="linux">linux</option>
              </select>
            </label>
            <label>
              <span>心跳间隔（秒）</span>
              <input value={newNodeHeartbeat} onChange={(event) => setNewNodeHeartbeat(event.target.value)} />
            </label>
            <label>
              <span>允许工作目录（每行一个）</span>
              <textarea rows={4} value={newNodeWorkdirs} onChange={(event) => setNewNodeWorkdirs(event.target.value)} />
            </label>
            <label>
              <span>标签（逗号分隔）</span>
              <input value={newNodeTags} onChange={(event) => setNewNodeTags(event.target.value)} placeholder="desktop, 24x7, l40s" />
            </label>
            <button type="submit" disabled={loading || !newNodeName.trim() || !newNodeId.trim()}>
              {loading ? "创建中..." : "创建节点并生成接入包"}
            </button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>接入包</h2>
            <span>{latestOnboarding?.node_id ?? selectedNodeRecord?.node_id ?? "未生成"}</span>
          </div>
          {latestOnboarding ? (
            <div className="detail-stack">
              <div className="detail-grid">
                <div>
                  <label>节点状态</label>
                  <strong>{latestOnboarding.onboarding_status}</strong>
                </div>
                <div>
                  <label>连接状态</label>
                  <strong>{latestOnboarding.connection_status}</strong>
                </div>
                <div>
                  <label>node_id</label>
                  <strong>{latestOnboarding.node_id}</strong>
                </div>
                <div>
                  <label>node_secret</label>
                  <strong>{latestOnboarding.node_secret}</strong>
                </div>
              </div>
              <div className="quick-actions">
                <button className="ghost small" type="button" onClick={() => void copyText(latestOnboarding.node_secret)}>
                  复制 node_secret
                </button>
                <button className="ghost small" type="button" onClick={() => void copyText(latestOnboarding.onboarding.env_template)}>
                  复制 .env 模板
                </button>
                <button className="ghost small" type="button" onClick={() => void copyText(latestOnboarding.onboarding.startup_command)}>
                  复制启动命令
                </button>
              </div>
              <div className="code-box">
                <span>control_plane_url</span>
                <pre>{latestOnboarding.onboarding.control_plane_url}</pre>
              </div>
              <div className="code-box">
                <span>.env 模板</span>
                <pre>{latestOnboarding.onboarding.env_template}</pre>
              </div>
              <div className="code-box">
                <span>启动命令</span>
                <pre>{latestOnboarding.onboarding.startup_command}</pre>
              </div>
              <div className="steps-box">
                <span>接入步骤</span>
                <ol>
                  {latestOnboarding.onboarding.onboarding_steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>创建节点后，这里会立即显示专属接入密钥、.env 模板和启动命令。</p>
            </div>
          )}
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>节点舰队</h2>
            <span>{overview?.nodes.length ?? 0} 台</span>
          </div>
          <div className="node-list">
            {overview?.nodes.map((node) => {
              const gpuList = node.latest_status?.gpus ?? [];
              const cpu = node.latest_status?.cpu ?? {};
              return (
                <article key={node.node_id} className="node-card">
                  <button
                    type="button"
                    className={`node-select-hit ${selectedNodeId === node.node_id ? "selected" : ""}`}
                    onClick={() => selectNode(node.node_id)}
                  >
                    {selectedNodeId === node.node_id ? "当前节点" : "选中节点"}
                  </button>
                  <div className="node-title-row">
                    <div>
                      <h3>{node.display_name}</h3>
                      <p>{node.node_id}</p>
                    </div>
                    <span className={`pill tone-${statusTone(node.online_status)}`}>{node.online_status}</span>
                  </div>
                  <div className="node-meta">
                    <span>{node.node_type}</span>
                    <span>{node.os_type ?? "unknown"}</span>
                    <span>{node.hostname ?? "no-hostname"}</span>
                  </div>
                  <div className="node-metrics">
                    <div>
                      <label>接入状态</label>
                      <strong>{node.onboarding_status}</strong>
                    </div>
                    <div>
                      <label>最近心跳</label>
                      <strong>{formatTime(node.last_seen_at)}</strong>
                    </div>
                    <div>
                      <label>首次接入</label>
                      <strong>{formatTime(node.first_seen_at)}</strong>
                    </div>
                  </div>
                  <div className="tag-row">
                    {node.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {gpuList.length > 0 ? (
                    <div className="gpu-box">
                      {gpuList.map((gpu, index) => (
                        <div key={index} className="gpu-line">
                          <span>{String(gpu.model ?? `GPU ${index}`)}</span>
                          <strong>
                            {String(gpu.used_vram_mb ?? 0)} / {String(gpu.total_vram_mb ?? 0)} MB
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-inline">首心跳前不会有硬件快照。</div>
                  )}
                  {node.active_task ? (
                    <div className="active-task-box">
                      <span>活跃任务</span>
                      <strong>
                        {node.active_task.type} · {node.active_task.status}
                      </strong>
                    </div>
                  ) : null}
                  {typeof cpu.usage_percent === "number" ? (
                    <div className="meta-note">CPU 当前利用率：{String(cpu.usage_percent)}%</div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>节点接入详情</h2>
            <span>{selectedNode ? selectedNode.node_id : "未选中"}</span>
          </div>
          {selectedNode && selectedNodeRecord ? (
            <div className="detail-stack">
              <div className="detail-grid">
                <div>
                  <label>接入状态</label>
                  <strong>{selectedNode.onboarding_status}</strong>
                </div>
                <div>
                  <label>连接状态</label>
                  <strong>{selectedNode.online_status}</strong>
                </div>
                <div>
                  <label>首次心跳</label>
                  <strong>{formatTime(selectedNode.first_seen_at)}</strong>
                </div>
                <div>
                  <label>最近心跳</label>
                  <strong>{formatTime(selectedNode.last_seen_at)}</strong>
                </div>
              </div>
              <div className="code-box">
                <span>allowed_workdirs</span>
                <pre>{prettyJson(selectedNodeRecord.allowed_workdirs)}</pre>
              </div>
              <div className="code-box">
                <span>latest_status</span>
                <pre>{prettyJson(selectedNode.latest_status)}</pre>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>先在左侧选一个节点，这里会显示它当前是否还在等待首心跳、是否在线、允许哪些工作目录。</p>
            </div>
          )}
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>节点任务台</h2>
            <span>{taskTargetNode?.node_id ?? "未选中"}</span>
          </div>
          <form className="form-stack" onSubmit={handleCreateTask}>
            <label>
              <span>目标节点</span>
              <select value={taskNodeId} onChange={(event) => setTaskNodeId(event.target.value)}>
                {nodes.map((node) => (
                  <option key={node.node_id} value={node.node_id}>
                    {node.display_name} ({node.node_id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>任务类型</span>
              <select value={taskType} onChange={(event) => setTaskType(event.target.value)}>
                {allowedTaskTypes.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            {taskTargetNode ? (
              <div className="meta-note">
                当前目标节点：
                <strong>{taskTargetNode.display_name}</strong>
                {" · "}
                接入状态 <strong>{taskTargetNode.onboarding_status}</strong>
                {" · "}
                连接状态 <strong>{taskTargetNode.connection_status}</strong>
                {!canDispatchTask ? "。该节点尚未完成接入或当前不在线，任务提交已禁用。" : "。节点已接入且在线，可下发任务。"}
              </div>
            ) : null}
            <label>
              <span>工作目录</span>
              <input value={taskWorkdir} onChange={(event) => setTaskWorkdir(event.target.value)} />
            </label>
            <label>
              <span>超时秒数</span>
              <input value={taskTimeout} onChange={(event) => setTaskTimeout(event.target.value)} />
            </label>
            <label>
              <span>
                {taskType === "python_script"
                  ? "脚本文本"
                  : taskType === "shell" || taskType === "modal_command"
                    ? "命令文本"
                    : taskType === "health_check"
                      ? "该任务无需 payload，可留空 {}"
                      : "payload JSON"}
              </span>
              <textarea rows={8} value={taskCommand} onChange={(event) => setTaskCommand(event.target.value)} />
            </label>
            <label>
              <span>环境变量 JSON</span>
              <textarea rows={5} value={taskEnv} onChange={(event) => setTaskEnv(event.target.value)} />
            </label>
            <button type="submit" disabled={loading || !canDispatchTask}>
              {loading ? "提交中..." : "创建任务"}
            </button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>最近任务</h2>
            <span>{overview?.recent_tasks.length ?? 0} 条</span>
          </div>
          <div className="task-list">
            {overview?.recent_tasks.map((task) => (
              <button key={task.task_id} className="task-item" onClick={() => void handleSelectTask(task)}>
                <div>
                  <strong>{task.type}</strong>
                  <p>
                    {task.task_id} · {task.node_id}
                  </p>
                </div>
                <span className={`pill tone-${statusTone(task.status)}`}>{task.status}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>任务详情</h2>
            {selectedTask ? (
              <button className="ghost" onClick={() => void handleCancelTask()} disabled={loading}>
                请求取消
              </button>
            ) : null}
          </div>
          {selectedTask ? (
            <div className="detail-stack">
              <div className="detail-head">
                <div>
                  <h3>{selectedTask.type}</h3>
                  <p>{selectedTask.task_id}</p>
                </div>
                <span className={`pill tone-${statusTone(selectedTask.status)}`}>{selectedTask.status}</span>
              </div>
              <div className="detail-grid">
                <div>
                  <label>节点</label>
                  <strong>{selectedTask.node_id}</strong>
                </div>
                <div>
                  <label>工作目录</label>
                  <strong>{selectedTask.workdir ?? "run_dir 默认目录"}</strong>
                </div>
                <div>
                  <label>创建时间</label>
                  <strong>{formatTime(selectedTask.created_at)}</strong>
                </div>
                <div>
                  <label>完成时间</label>
                  <strong>{formatTime(selectedTask.finished_at)}</strong>
                </div>
              </div>
              <div className="code-box">
                <span>payload</span>
                <pre>{prettyJson(selectedTask.payload)}</pre>
              </div>
              <div className="log-grid">
                {selectedTask.logs.map((log) => (
                  <div key={log.stream} className="code-box">
                    <span>
                      {log.stream} · {log.last_offset} bytes
                    </span>
                    <pre>{log.preview_text || "(empty)"}</pre>
                  </div>
                ))}
              </div>
              <div className="code-box">
                <span>result</span>
                <pre>{prettyJson(selectedTask.result)}</pre>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>任务现在是次级功能。等节点接入后，再从上面的任务台创建任务并点击这里查看执行详情。</p>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>安全与审计</h2>
            <span>{auditEvents.length + securityWarnings.length} 条</span>
          </div>
          <div className="event-list">
            {securityWarnings.slice(0, 4).map((warning) => (
              <article key={warning.id} className="event-card warning-card">
                <div className="event-head">
                  <strong>{warning.warning_type}</strong>
                  <span className="pill tone-bad">{warning.command_excerpt ?? "warning"}</span>
                </div>
                <p>
                  {warning.source_type} · {warning.source_id ?? "unknown"} · {formatTime(warning.created_at)}
                </p>
              </article>
            ))}
            {auditEvents.slice(0, 6).map((event) => (
              <article key={event.id} className="event-card">
                <div className="event-head">
                  <strong>{event.action}</strong>
                  <span className="pill tone-idle">{event.target_type}</span>
                </div>
                <p>
                  {event.actor_type} · {event.actor_id ?? "unknown"} · {formatTime(event.created_at)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
