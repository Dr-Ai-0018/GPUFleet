import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { Card } from "../../ui/Card";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { formatRelative, formatTime } from "../../lib/format";
import page from "../../ui/page.module.css";
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
    (node) => node.is_enabled && node.connection_status === "online" && node.onboarding_status === "connected",
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
    <div className={page.page}>
      <header className={page.head}>
        <div className={page.titleBlock}>
          <div className={page.eyebrow}>TASKS</div>
          <h1 className={page.title}>任务中心</h1>
          <p className={page.lede}>选择一个已接入的节点下发任务，从这里追踪状态、日志与产物。</p>
        </div>
        {connectedNodes.length === 0 ? (
          <Button variant="accent" onClick={() => navigate({ name: "onboarding" })}>
            先去接入节点
          </Button>
        ) : null}
      </header>

      {connectedNodes.length === 0 ? (
        <Card>
          <EmptyState
            title="尚无可派发任务的节点"
            description="任务需要目标节点处于在线 + 已接入状态。请先在节点接入面板创建并连接节点。"
            action={
              <Button variant="accent" onClick={() => navigate({ name: "onboarding" })}>
                去节点接入
              </Button>
            }
          />
        </Card>
      ) : (
        <Card title="选择节点下发" subtitle="只有处于在线 + 已接入状态的节点可下发任务。" bodyFlush>
          <div className={styles.dispatchGrid}>
            {connectedNodes.map((node) => (
              <button
                key={node.node_id}
                type="button"
                className={styles.dispatchCard}
                onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
              >
                <div className={styles.dispatchHead}>
                  <span className={styles.dispatchName}>{node.display_name}</span>
                  <StatusPill tone="online" label="在线" pulse />
                </div>
                <code className={styles.dispatchId}>{node.node_id}</code>
                <span className={styles.dispatchMeta}>
                  {node.node_type} · {node.os_type ?? "—"} · {node.heartbeat_interval_sec}s
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Status</span>
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
        <span className={styles.filterDivider} aria-hidden />
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Node</span>
          <select
            className={forms.select}
            style={{ width: "auto", maxWidth: 240 }}
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
            placeholder="按 task_id、类型、节点查找"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className={styles.filterCount}>
          {filtered.length}<span className="muted"> / {store.tasks.length}</span>
        </span>
      </div>

      <Card title="任务列表" bodyFlush={filtered.length > 0}>
        {filtered.length === 0 ? (
          <EmptyState title="没有符合条件的任务" description="先在已接入节点上下发任务，或调整筛选。" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Node</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => (
                  <tr
                    key={task.task_id}
                    className={styles.rowClickable}
                    onClick={() => navigate({ name: "task-detail", taskId: task.task_id })}
                  >
                    <td className={styles.idCell}>{task.task_id}</td>
                    <td className={styles.nodeCell}>{task.node_id}</td>
                    <td>{task.type}</td>
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
                    <td title={task.finished_at ? formatTime(task.finished_at) : ""} className={styles.timeCell}>
                      {task.finished_at ? formatRelative(task.finished_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
