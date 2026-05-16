import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { NodeResponse, OnboardingStatus, OnlineStatus } from "../../types";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import {
  connectionLabel,
  connectionTone,
  nodeTypeLabel,
  onboardingLabel,
  onboardingTone,
  osLabel,
} from "../../lib/labels";
import { formatRelative } from "../../lib/format";
import page from "../../ui/page.module.css";
import forms from "../../ui/forms.module.css";
import styles from "./FleetView.module.css";

type ConnectionFilter = "all" | OnlineStatus;
type OnboardingFilter = "all" | OnboardingStatus;

export function FleetView(): JSX.Element {
  const store = useConsoleStore();
  const [query, setQuery] = useState("");
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>("all");
  const [onboardingFilter, setOnboardingFilter] = useState<OnboardingFilter>("all");

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
    <div className={page.page}>
      <header className={page.head}>
        <div className={page.titleBlock}>
          <div className={page.eyebrow}>FLEET</div>
          <h1 className={page.title}>节点舰队</h1>
          <p className={page.lede}>实时观察每个节点的接入与连接状态。</p>
        </div>
        <div className={page.actions}>
          <Button variant="accent" onClick={() => navigate({ name: "onboarding" })}>
            创建新节点
          </Button>
        </div>
      </header>

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Conn</span>
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
        <span className={styles.filterDivider} aria-hidden />
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Onboard</span>
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
            placeholder="按名称、node_id、主机名或标签查找"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className={styles.filterCount}>
          {filtered.length}<span className="muted"> / {store.nodes.length}</span>
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="没有符合条件的节点"
            description={
              store.nodes.length === 0
                ? "控制平面尚未登记任何节点。先去创建一个，再回这里看舰队总览。"
                : "调整一下筛选条件，或回到节点接入再加一个。"
            }
            action={
              store.nodes.length === 0 ? (
                <Button variant="accent" onClick={() => navigate({ name: "onboarding" })}>
                  去创建节点
                </Button>
              ) : null
            }
          />
        </Card>
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
      style={{ cursor: "pointer" }}
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
          <dt className={styles.specLabel}>Hostname</dt>
          <dd className={styles.specValue}>{node.hostname ?? "—"}</dd>
        </div>
        <div className={styles.specCell}>
          <dt className={styles.specLabel}>Heartbeat</dt>
          <dd className={styles.specValue}>{node.heartbeat_interval_sec}s</dd>
        </div>
        <div className={styles.specCell}>
          <dt className={styles.specLabel}>Last seen</dt>
          <dd className={styles.specValue}>{formatRelative(node.last_seen_at)}</dd>
        </div>
        <div className={styles.specCell}>
          <dt className={styles.specLabel}>First seen</dt>
          <dd className={styles.specValue}>
            {node.first_seen_at ? formatRelative(node.first_seen_at) : "尚未"}
          </dd>
        </div>
      </dl>

      <div className={styles.cardFoot}>
        <div className={styles.tagRow}>
          {node.tags.slice(0, 4).map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
          {node.tags.length > 4 ? (
            <span className={styles.tag}>+{node.tags.length - 4}</span>
          ) : null}
        </div>
        <span className="muted" style={{ fontSize: "var(--fs-11)" }}>查看详情 →</span>
      </div>
    </article>
  );
}

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
