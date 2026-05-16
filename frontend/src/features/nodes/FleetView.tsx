import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { NodeResponse, OnboardingStatus, OnlineStatus } from "../../types";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import {
  connectionLabel,
  connectionTone,
  nodeTypeLabel,
  onboardingLabel,
  onboardingTone,
  osLabel,
} from "../../lib/labels";
import { formatRelative } from "../../lib/format";
import forms from "../../ui/forms.module.css";
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
      <header className={styles.hero}>
        <div className={styles.heroLeft}>
          <span className={styles.heroEyebrow}>
            <span className={styles.heroEyebrowDot} aria-hidden />
            FLEET
          </span>
          <h1 className={styles.heroTitle}>节点舰队</h1>
        </div>
        <div className={styles.heroActions}>
          <Button variant="ghost" onClick={() => navigate({ name: "onboarding" })}>
            登记新节点
          </Button>
        </div>
      </header>

      <div className={styles.strip}>
        <div className={styles.stripGroup}>
          <span className={styles.stripLabel}>CONN</span>
          <SegmentedControl<ConnectionFilter>
            value={connectionFilter}
            onChange={setConnectionFilter}
            options={[
              { value: "all", label: "全部" },
              { value: "online", label: "在线" },
              { value: "offline", label: "离线" },
              { value: "never_seen", label: "未上线" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </div>
        <div className={styles.stripGroup}>
          <span className={styles.stripLabel}>ONBOARD</span>
          <SegmentedControl<OnboardingFilter>
            value={onboardingFilter}
            onChange={setOnboardingFilter}
            options={[
              { value: "all", label: "全部" },
              { value: "awaiting_first_heartbeat", label: "待接入" },
              { value: "connected", label: "已接入" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </div>
        <div className={styles.searchWrap}>
          <SearchIcon className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="按 名称 / node_id / 主机名 / 标签 检索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className={styles.stripCount}>
          <strong>{filtered.length}</strong> / {store.nodes.length}
        </span>
        <div className={styles.viewToggle} role="tablist" aria-label="view">
          <button
            type="button"
            className={`${styles.viewBtn}${view === "table" ? ` ${styles.viewBtnActive}` : ""}`}
            onClick={() => setView("table")}
          >
            <RowsIcon /> TABLE
          </button>
          <button
            type="button"
            className={`${styles.viewBtn}${view === "grid" ? ` ${styles.viewBtnActive}` : ""}`}
            onClick={() => setView("grid")}
          >
            <GridIcon /> GRID
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyMeta}>NO MATCHING NODES</span>
          <span className={styles.emptyTitle}>
            {store.nodes.length === 0 ? "舰队为空" : "无匹配结果"}
          </span>
          {store.nodes.length === 0 ? (
            <Button variant="accent" onClick={() => navigate({ name: "onboarding" })}>
              去登记节点
            </Button>
          ) : null}
        </div>
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

/* ---------- Table view ---------- */

function FleetTable({ nodes }: { nodes: NodeResponse[] }): JSX.Element {
  return (
    <div className={styles.tableWrap}>
      <div style={{ overflowX: "auto" }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>NODE</th>
              <th>STATE</th>
              <th>ROLE / OS</th>
              <th>HOSTNAME</th>
              <th>HEARTBEAT</th>
              <th>FIRST · LAST</th>
              <th>TAGS</th>
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
                    <span className={styles.cellNodeName}>{node.display_name}</span>
                    <code className={styles.cellNodeId}>{node.node_id}</code>
                  </div>
                </td>
                <td>
                  <div className={styles.statusStack}>
                    <StatusPill
                      tone={connectionTone[node.connection_status]}
                      label={connectionLabel[node.connection_status]}
                      pulse={node.connection_status === "online"}
                    />
                    <StatusPill
                      tone={onboardingTone[node.onboarding_status]}
                      label={onboardingLabel[node.onboarding_status]}
                      pulse={node.onboarding_status === "awaiting_first_heartbeat"}
                      subtle
                    />
                  </div>
                </td>
                <td>
                  <span className={styles.cellMeta}>
                    {nodeTypeLabel[node.node_type] ?? node.node_type}
                  </span>
                  {node.os_type ? (
                    <span className={styles.cellMetaSub}>{osLabel[node.os_type] ?? node.os_type}</span>
                  ) : null}
                </td>
                <td>
                  <span className={styles.cellHostname}>{node.hostname ?? "—"}</span>
                </td>
                <td>
                  <span className={styles.cellMeta}>{node.heartbeat_interval_sec}s</span>
                </td>
                <td>
                  <span className={styles.cellTime}>
                    {node.first_seen_at ? formatRelative(node.first_seen_at) : "—"}
                  </span>
                  <span className={styles.cellMetaSub}>
                    {node.last_seen_at ? formatRelative(node.last_seen_at) : "尚未"}
                  </span>
                </td>
                <td>
                  <div className={styles.tags}>
                    {node.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className={styles.tag}>
                        {tag}
                      </span>
                    ))}
                    {node.tags.length > 4 ? (
                      <span className={styles.tag}>+{node.tags.length - 4}</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Grid view ---------- */

function FleetCard({ node }: { node: NodeResponse }): JSX.Element {
  return (
    <article
      className={styles.card}
      onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate({ name: "node-detail", nodeId: node.node_id });
        }
      }}
    >
      <div className={styles.cardHead}>
        <div className={styles.cardTitleBlock}>
          <h3 className={styles.cardTitle}>{node.display_name}</h3>
          <code className={styles.cardId}>{node.node_id}</code>
        </div>
        <StatusPill
          tone={connectionTone[node.connection_status]}
          label={connectionLabel[node.connection_status]}
          pulse={node.connection_status === "online"}
        />
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.metaChip}>{nodeTypeLabel[node.node_type] ?? node.node_type}</span>
        {node.os_type ? (
          <span className={styles.metaChip}>{osLabel[node.os_type] ?? node.os_type}</span>
        ) : null}
        <StatusPill
          tone={onboardingTone[node.onboarding_status]}
          label={onboardingLabel[node.onboarding_status]}
          subtle
        />
      </div>

      <dl className={styles.cardSpec}>
        <div className={styles.specCell}>
          <dt className={styles.specLabel}>HOSTNAME</dt>
          <dd className={styles.specValue}>{node.hostname ?? "—"}</dd>
        </div>
        <div className={styles.specCell}>
          <dt className={styles.specLabel}>HEARTBEAT</dt>
          <dd className={styles.specValue}>{node.heartbeat_interval_sec}s</dd>
        </div>
        <div className={styles.specCell}>
          <dt className={styles.specLabel}>FIRST SEEN</dt>
          <dd className={styles.specValue}>
            {node.first_seen_at ? formatRelative(node.first_seen_at) : "尚未"}
          </dd>
        </div>
        <div className={styles.specCell}>
          <dt className={styles.specLabel}>LAST SEEN</dt>
          <dd className={styles.specValue}>{formatRelative(node.last_seen_at)}</dd>
        </div>
      </dl>
    </article>
  );
}

/* ---------- Helpers ---------- */

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}): JSX.Element {
  return (
    <div className={forms.segmented}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`${forms.segItem}${value === option.value ? ` ${forms.segItemActive}` : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
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

function RowsIcon(): JSX.Element {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon(): JSX.Element {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="0.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.5" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="0.5" />
    </svg>
  );
}
