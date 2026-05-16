import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { formatRelative, formatTime } from "../../lib/format";
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
      <header className={styles.header}>
        <h1 className={styles.title}>任务中心</h1>
        <div className={styles.headerRight}>
          <span className={styles.readyBadge}>
            <span className={styles.readyDot} />
            {connectedNodes.length} 可下发
          </span>
        </div>
      </header>

      {/* Dispatch-ready nodes strip */}
      {connectedNodes.length === 0 ? (
        <div className={styles.gateNotice}>
          <LockIcon />
          <span>当前无在线已接入节点，任务下发不可用</span>
          <Button size="sm" variant="ghost" onClick={() => navigate({ name: "onboarding" })}>
            去节点接入
          </Button>
        </div>
      ) : (
        <div className={styles.nodeStrip}>
          {connectedNodes.map((node) => (
            <button
              key={node.node_id}
              type="button"
              className={styles.nodeChip}
              onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
            >
              <span className={styles.nodeChipDot} />
              <span className={styles.nodeChipName}>{node.display_name}</span>
              <span className={styles.nodeChipMeta}>{node.node_type}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filter strip */}
      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          {STATUS_GROUPS.map((g) => (
            <button
              key={g.value}
              type="button"
              className={`${styles.filterChip}${filter === g.value ? ` ${styles.filterChipActive}` : ""}`}
              onClick={() => setFilter(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <select
          className={styles.filterSelect}
          value={nodeFilter}
          onChange={(e) => setNodeFilter(e.target.value)}
        >
          <option value="all">全部节点</option>
          {store.nodes.map((node) => (
            <option key={node.node_id} value={node.node_id}>{node.display_name}</option>
          ))}
        </select>

        <div className={styles.searchWrap}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            placeholder="搜索 task_id / type / node…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <span className={styles.count}>{filtered.length} / {store.tasks.length}</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>无匹配任务</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>任务 ID</th>
                <th>节点</th>
                <th>类型</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>完成时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr
                  key={task.task_id}
                  className={styles.row}
                  onClick={() => navigate({ name: "task-detail", taskId: task.task_id })}
                >
                  <td className={styles.cellId}>{task.task_id}</td>
                  <td className={styles.cellMono}>{task.node_id}</td>
                  <td className={styles.cellMono}>{task.type}</td>
                  <td>
                    <StatusPill
                      tone={taskStatusTone[task.status] ?? "muted"}
                      label={taskStatusLabel[task.status] ?? task.status}
                      pulse={task.status === "running" || task.status === "claimed"}
                    />
                  </td>
                  <td className={styles.cellTime} title={formatTime(task.created_at)}>
                    {formatRelative(task.created_at)}
                  </td>
                  <td className={styles.cellTime} title={task.finished_at ? formatTime(task.finished_at) : ""}>
                    {task.finished_at ? formatRelative(task.finished_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg className={styles.searchIcon} width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M11 11l3 3" />
    </svg>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}
