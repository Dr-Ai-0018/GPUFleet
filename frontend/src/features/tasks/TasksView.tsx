import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { formatRelative, formatTime } from "../../lib/format";
import forms from "../../ui/forms.module.css";
import styles from "./TasksView.module.css";

const STATUS_GROUPS = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "succeeded", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "取消" },
] as const;

type StatusFilter = (typeof STATUS_GROUPS)[number]["value"];

const ACTIVE_SET = new Set(["pending", "claimed", "running", "cancel_requested"]);
const FAIL_SET = new Set(["failed", "timeout", "lost"]);
const CANCEL_SET = new Set(["cancelled", "cancel_requested"]);

export function TasksView(): JSX.Element {
  const store = useConsoleStore();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [nodeFilter, setNodeFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const connectedNodes = store.nodes.filter(
    (node) =>
      node.is_enabled &&
      node.connection_status === "online" &&
      node.onboarding_status === "connected",
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.tasks.filter((task) => {
      if (nodeFilter !== "all" && task.node_id !== nodeFilter) return false;
      if (filter === "active" && !ACTIVE_SET.has(task.status)) return false;
      if (filter === "succeeded" && task.status !== "succeeded") return false;
      if (filter === "failed" && !FAIL_SET.has(task.status)) return false;
      if (filter === "cancelled" && !CANCEL_SET.has(task.status)) return false;
      if (!q) return true;
      const haystack = [task.task_id, task.node_id, task.type].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [store.tasks, nodeFilter, filter, query]);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroLeft}>
          <span className={styles.heroEyebrow}>
            <span className={styles.heroEyebrowDot} aria-hidden />
            TASKS
          </span>
          <h1 className={styles.heroTitle}>任务</h1>
        </div>
      </header>

      {/* Node dispatch rail — slim, subordinate to fleet state */}
      <div className={styles.railWrap}>
        <div className={styles.railHead}>
          <span className={styles.railLabel}>可下发节点</span>
          <span className={styles.railCount}>{connectedNodes.length} ready</span>
        </div>
        {connectedNodes.length === 0 ? (
          <div className={styles.gateNote}>
            <GateIcon />
            <span>当前无在线 + 已接入节点 · 任务下发不可用</span>
            <Button size="sm" variant="ghost" onClick={() => navigate({ name: "onboarding" })}>
              去节点接入
            </Button>
          </div>
        ) : (
          <div className={styles.rail}>
            {connectedNodes.map((node) => (
              <button
                key={node.node_id}
                type="button"
                className={styles.railCard}
                onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
              >
                <div className={styles.railHead2}>
                  <span className={styles.railName}>{node.display_name}</span>
                  <StatusPill tone="online" label="在线" pulse />
                </div>
                <code className={styles.railId}>{node.node_id}</code>
                <span className={styles.railMeta}>
                  {node.node_type} · {node.os_type ?? "—"} · {node.heartbeat_interval_sec}s
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filter strip */}
      <div className={styles.strip}>
        <div className={styles.stripGroup}>
          <span className={styles.stripLabel}>STATUS</span>
          <div className={forms.segmented}>
            {STATUS_GROUPS.map((group) => (
              <button
                key={group.value}
                type="button"
                className={`${forms.segItem}${filter === group.value ? ` ${forms.segItemActive}` : ""}`}
                onClick={() => setFilter(group.value)}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.stripGroup}>
          <span className={styles.stripLabel}>NODE</span>
          <select
            className={forms.select}
            style={{ width: "auto", maxWidth: 240, height: 32 }}
            value={nodeFilter}
            onChange={(event) => setNodeFilter(event.target.value)}
          >
            <option value="all">全部节点</option>
            {store.nodes.map((node) => (
              <option key={node.node_id} value={node.node_id}>
                {node.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.searchWrap}>
          <SearchIcon className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="按 task_id / type / node 检索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className={styles.stripCount}>
          <strong>{filtered.length}</strong> / {store.tasks.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyMeta}>NO MATCHING TASKS</span>
          <span className={styles.emptyTitle}>—</span>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <div style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>TASK</th>
                  <th>NODE</th>
                  <th>TYPE</th>
                  <th>STATUS</th>
                  <th>CREATED</th>
                  <th>FINISHED</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => (
                  <tr
                    key={task.task_id}
                    className={styles.row}
                    onClick={() => navigate({ name: "task-detail", taskId: task.task_id })}
                  >
                    <td className={styles.idCell}>{task.task_id}</td>
                    <td className={styles.nodeCell}>{task.node_id}</td>
                    <td className={styles.typeCell}>{task.type}</td>
                    <td>
                      <StatusPill
                        tone={taskStatusTone[task.status] ?? "muted"}
                        label={taskStatusLabel[task.status] ?? task.status}
                        pulse={task.status === "running" || task.status === "claimed"}
                      />
                    </td>
                    <td title={formatTime(task.created_at)} className={styles.timeCell}>
                      {formatRelative(task.created_at)}
                    </td>
                    <td
                      title={task.finished_at ? formatTime(task.finished_at) : ""}
                      className={styles.timeCell}
                    >
                      {task.finished_at ? formatRelative(task.finished_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M11 11l3 3" />
    </svg>
  );
}

function GateIcon(): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="7" width="10" height="6.5" rx="1" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}
