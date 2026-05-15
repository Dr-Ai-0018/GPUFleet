import { FormEvent, useEffect, useState } from "react";
import { cancelTask, createTask, getOverview, getTaskDetail, getNodes, login } from "./api";
import type { AdminTaskDetail, DashboardOverview, DashboardTaskSummary, NodeResponse } from "./types";

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
    default:
      return "idle";
  }
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
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [refreshTick, setRefreshTick] = useState(0);

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
        const [overviewData, nodeData] = await Promise.all([getOverview(token), getNodes(token)]);
        if (cancelled) return;
        setOverview(overviewData);
        setNodes(nodeData);
        if (!taskNodeId && nodeData.length > 0) {
          setTaskNodeId(nodeData[0].node_id);
          setTaskWorkdir(nodeData[0].allowed_workdirs[0] ?? "");
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
  }, [token, taskNodeId]);

  useEffect(() => {
    const current = nodes.find((node) => node.node_id === taskNodeId);
    if (current && !current.allowed_workdirs.includes(taskWorkdir)) {
      setTaskWorkdir(current.allowed_workdirs[0] ?? "");
    }
  }, [nodes, taskNodeId, taskWorkdir]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function refresh() {
      try {
        const data = await getOverview(token);
        if (!cancelled) setOverview(data);
        if (selectedTaskId) {
          const detail = await getTaskDetail(token, selectedTaskId);
          if (!cancelled) setSelectedTask(detail);
        }
      } catch {
        // quiet background refresh
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, token, selectedTaskId]);

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
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const parsedEnv = taskEnv.trim() ? (JSON.parse(taskEnv) as Record<string, string>) : {};
      const payload =
        taskType === "python_script"
          ? { script: taskCommand }
          : taskType === "shell"
            ? { command: taskCommand }
            : {};
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

  function handleLogout() {
    localStorage.removeItem(tokenStorageKey);
    setToken("");
    setOverview(null);
    setSelectedTask(null);
    setSelectedTaskId("");
  }

  if (!token) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="eyebrow">GPUFleet Console</div>
          <h1>异构 GPU 控制台</h1>
          <p>先登录主控，再统一盯住所有节点、心跳、任务和日志闭环。</p>
          <form onSubmit={handleLogin} className="form-stack">
            <label>
              <span>管理员账号</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
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
          <h1>内网 GPU 控制台</h1>
          <p>面向异构节点的心跳、任务、日志与产物总览。当前默认按 5 秒心跳轮询。</p>
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
              ["在线节点", String(overview.node_counts.online ?? 0), "good"],
              ["离线节点", String(overview.node_counts.offline ?? 0), "bad"],
              ["运行中任务", String(overview.task_counts.running ?? 0), "work"],
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
            <h2>节点舰队</h2>
            <span>{overview?.nodes.length ?? 0} 台</span>
          </div>
          <div className="node-list">
            {overview?.nodes.map((node) => {
              const gpuList = node.latest_status?.gpus ?? [];
              const cpu = node.latest_status?.cpu ?? {};
              return (
                <article key={node.node_id} className="node-card">
                  <div className="node-title-row">
                    <div>
                      <h3>{node.display_name}</h3>
                      <p>{node.node_id}</p>
                    </div>
                    <span className={`pill tone-${statusTone(node.online_status)}`}>{node.online_status}</span>
                  </div>
                  <div className="node-meta">
                    <span>{node.os_type ?? "unknown"}</span>
                    <span>{node.hostname ?? "no-hostname"}</span>
                    <span>{node.heartbeat_interval_sec}s heartbeat</span>
                  </div>
                  <div className="node-metrics">
                    <div>
                      <label>CPU</label>
                      <strong>{String(cpu.usage_percent ?? "--")}%</strong>
                    </div>
                    <div>
                      <label>GPU</label>
                      <strong>{gpuList.length > 0 ? String(gpuList.length) : "0"} 张</strong>
                    </div>
                    <div>
                      <label>最近心跳</label>
                      <strong>{formatTime(node.last_seen_at)}</strong>
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
                  ) : null}
                  {node.active_task ? (
                    <div className="active-task-box">
                      <span>活跃任务</span>
                      <strong>
                        {node.active_task.type} · {node.active_task.status}
                      </strong>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>手工发任务</h2>
            <span>MVP</span>
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
                <option value="shell">shell</option>
                <option value="python_script">python_script</option>
                <option value="health_check">health_check</option>
              </select>
            </label>
            <label>
              <span>工作目录</span>
              <input value={taskWorkdir} onChange={(event) => setTaskWorkdir(event.target.value)} />
            </label>
            <label>
              <span>超时秒数</span>
              <input value={taskTimeout} onChange={(event) => setTaskTimeout(event.target.value)} />
            </label>
            <label>
              <span>{taskType === "python_script" ? "脚本文本" : "命令文本"}</span>
              <textarea rows={9} value={taskCommand} onChange={(event) => setTaskCommand(event.target.value)} />
            </label>
            <label>
              <span>环境变量 JSON</span>
              <textarea rows={6} value={taskEnv} onChange={(event) => setTaskEnv(event.target.value)} />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "提交中..." : "创建任务"}
            </button>
          </form>
        </div>
      </section>

      <section className="content-grid">
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
              <div className="artifact-list">
                {selectedTask.artifacts.map((artifact) => (
                  <article key={artifact.artifact_name} className="artifact-item">
                    <strong>{artifact.artifact_name}</strong>
                    <p>
                      {artifact.artifact_type} · {artifact.size_bytes} bytes
                    </p>
                    <code>{artifact.storage_path}</code>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>从左侧点开一条任务，就能看日志、结果和产物摘要。</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
