import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { NodeResponse, OnboardingStatus, OnlineStatus } from "../../types";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import {
  connectionLabel,
  connectionTone,
  nodeTypeLabel,
  onboardingLabel,
  onboardingTone,
  osLabel,
} from "../../lib/labels";
import { formatRelative } from "../../lib/format";
import styles from "./FleetView.module.css";

type ConnectionFilter = "all" | OnlineStatus;
type OnboardingFilter = "all" | OnboardingStatus;
type ViewMode = "table" | "grid";

export function FleetView(): JSX.Element {
  const store = useConsoleStore();
  const [query, setQuery] = useState("");
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>("all");
  const [onboardingFilter, setOnboardingFilter] = useState<OnboardingFilter>("all");
  const [view, setView] = useState<ViewMode>("table");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.nodes.filter((node) => {
      if (connectionFilter !== "all" && node.connection_status !== connectionFilter) return false;
      if (onboardingFilter !== "all" && node.onboarding_status !== onboardingFilter) return false;
      if (!q) return true;
      const haystack = [node.node_id, node.display_name, node.hostname ?? "", ...node.tags]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [store.nodes, connectionFilter, onboardingFilter, query]);

  return (
    <div className={styles.page}>
      {/* Page header — title + primary action, nothing else */}
      <header className={styles.header}>
        <h1 className={styles.title}>节点舰队</h1>
        <Button variant="ghost" onClick={() => navigate({ name: "onboarding" })}>
          登记新节点
        </Button>
      </header>

      {/* Filter strip */}
      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <FilterSelect
            value={connectionFilter}
            onChange={(v) => setConnectionFilter(v as ConnectionFilter)}
            options={[
              { value: "all", label: "全部状态" },
              { value: "online", label: "在线" },
              { value: "offline", label: "离线" },
              { value: "never_seen", label: "未上线" },
              { value: "disabled", label: "停用" },
            ]}
          />
          <FilterSelect
            value={onboardingFilter}
            onChange={(v) => setOnboardingFilter(v as OnboardingFilter)}
            options={[
              { value: "all", label: "全部接入" },
              { value: "awaiting_first_heartbeat", label: "待接入" },
              { value: "connected", label: "已接入" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </div>

        <div className={styles.filterRight}>
          <div className={styles.searchWrap}>
            <SearchIcon />
            <input
              className={styles.searchInput}
              placeholder="搜索名称、ID、主机名、标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className={styles.count}>
            {filtered.length} / {store.nodes.length}
          </span>
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.viewBtn}${view === "table" ? ` ${styles.viewBtnActive}` : ""}`}
              onClick={() => setView("table")}
              aria-label="列表视图"
            >
              <RowsIcon />
            </button>
            <button
              type="button"
              className={`${styles.viewBtn}${view === "grid" ? ` ${styles.viewBtnActive}` : ""}`}
              onClick={() => setView("grid")}
              aria-label="卡片视图"
            >
              <GridIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        store.loading === "loading" && store.nodes.length === 0 ? (
          <div className={styles.grid}>
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className={styles.skeletonCard}>
                <Skeleton className={styles.skeletonTitle} />
                <Skeleton className={styles.skeletonMeta} />
                <Skeleton className={styles.skeletonMeta} />
                <Skeleton className={styles.skeletonMeta} />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyText}>
              {store.nodes.length === 0 ? "舰队为空" : "无匹配结果"}
            </span>
            {store.nodes.length === 0 ? (
              <Button variant="accent" onClick={() => navigate({ name: "onboarding" })}>
                去登记节点
              </Button>
            ) : null}
          </div>
        )
      ) : view === "table" ? (
        <FleetTable nodes={filtered} />
      ) : (
        <div className={styles.grid}>
          {filtered.map((node) => (
            <FleetCard key={node.node_id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Table ─── */

function FleetTable({ nodes }: { nodes: NodeResponse[] }): JSX.Element {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>节点</th>
            <th>状态</th>
            <th>类型</th>
            <th>主机名</th>
            <th>心跳</th>
            <th>最近活动</th>
            <th>标签</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr
              key={node.node_id}
              className={styles.row}
              onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
            >
              <td>
                <div className={styles.cellNode}>
                  <span className={styles.nodeName}>{node.display_name}</span>
                  <code className={styles.nodeId}>{node.node_id}</code>
                </div>
              </td>
              <td>
                <StatusPill
                  tone={connectionTone[node.connection_status]}
                  label={connectionLabel[node.connection_status]}
                  pulse={node.connection_status === "online"}
                />
              </td>
              <td className={styles.cellMeta}>
                {nodeTypeLabel[node.node_type] ?? node.node_type}
                {node.os_type ? <span className={styles.cellSub}>{osLabel[node.os_type] ?? node.os_type}</span> : null}
              </td>
              <td className={styles.cellMono}>{node.hostname ?? "—"}</td>
              <td className={styles.cellMono}>{node.heartbeat_interval_sec}s</td>
              <td className={styles.cellTime}>
                {node.last_seen_at ? formatRelative(node.last_seen_at) : "尚未"}
              </td>
              <td>
                <div className={styles.tags}>
                  {node.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                  {node.tags.length > 3 ? <span className={styles.tag}>+{node.tags.length - 3}</span> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Grid ─── */

function FleetCard({ node }: { node: NodeResponse }): JSX.Element {
  return (
    <article
      className={styles.card}
      onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate({ name: "node-detail", nodeId: node.node_id }); } }}
    >
      <div className={styles.cardTop}>
        <div className={styles.cardTitle}>
          <h3>{node.display_name}</h3>
          <code>{node.node_id}</code>
        </div>
        <StatusPill
          tone={connectionTone[node.connection_status]}
          label={connectionLabel[node.connection_status]}
          pulse={node.connection_status === "online"}
        />
      </div>
      <div className={styles.cardBody}>
        <span>{nodeTypeLabel[node.node_type] ?? node.node_type}</span>
        <span>{node.os_type ? osLabel[node.os_type] ?? node.os_type : "—"}</span>
        <span>{node.hostname ?? "—"}</span>
        <span>{node.last_seen_at ? formatRelative(node.last_seen_at) : "尚未"}</span>
      </div>
    </article>
  );
}

/* ─── Helpers ─── */

function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}): JSX.Element {
  return (
    <select
      className={styles.filterSelect}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
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

function RowsIcon(): JSX.Element {
  return <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"><path d="M2 4h12M2 8h12M2 12h12" /></svg>;
}

function GridIcon(): JSX.Element {
  return <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="2" y="2" width="5" height="5" rx="0.5" /><rect x="9" y="2" width="5" height="5" rx="0.5" /><rect x="2" y="9" width="5" height="5" rx="0.5" /><rect x="9" y="9" width="5" height="5" rx="0.5" /></svg>;
}
