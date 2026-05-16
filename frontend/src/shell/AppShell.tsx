import { useEffect, useMemo, useState, type ReactNode } from "react";
import { buildHash, navigate, useRoute, type Route } from "../lib/routing";
import { formatRelative } from "../lib/format";
import { useConsoleStore } from "../state/ConsoleStore";
import { OnboardingView } from "../features/nodes/OnboardingView";
import { FleetView } from "../features/nodes/FleetView";
import { NodeDetailView } from "../features/nodes/NodeDetailView";
import { TasksView } from "../features/tasks/TasksView";
import { TaskDetailView } from "../features/tasks/TaskDetailView";
import { SecurityView } from "../features/observability/SecurityView";
import { Button } from "../ui/Button";
import styles from "./AppShell.module.css";

type NavKey = Route["name"];

type NavItem = {
  key: NavKey;
  to: Route;
  label: string;
  icon: ReactNode;
  badge?: () => ReactNode | null;
};

type Props = {
  onLogout: () => void;
};

export function AppShell({ onLogout }: Props): JSX.Element {
  const route = useRoute();
  const store = useConsoleStore();
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const awaitingCount = store.nodes.filter(
    (n) => n.onboarding_status === "awaiting_first_heartbeat",
  ).length;
  const offlineCount = store.nodes.filter((n) => n.connection_status === "offline").length;
  const onlineCount = store.nodes.filter((n) => n.connection_status === "online").length;
  const warningCount = store.warnings.length;

  const navItems = useMemo<NavItem[]>(
    () => [
      {
        key: "onboarding",
        to: { name: "onboarding" },
        label: "节点接入",
        icon: <NavIcon kind="onboarding" />,
        badge: () =>
          awaitingCount ? (
            <span className={`${styles.navBadge} ${styles.navBadgeWarn}`}>{awaitingCount}</span>
          ) : null,
      },
      {
        key: "fleet",
        to: { name: "fleet" },
        label: "节点舰队",
        icon: <NavIcon kind="fleet" />,
        badge: () =>
          offlineCount ? (
            <span className={`${styles.navBadge} ${styles.navBadgeMute}`}>{offlineCount}</span>
          ) : null,
      },
      {
        key: "tasks",
        to: { name: "tasks" },
        label: "任务",
        icon: <NavIcon kind="tasks" />,
      },
      {
        key: "security",
        to: { name: "security" },
        label: "安全审计",
        icon: <NavIcon kind="security" />,
        badge: () =>
          warningCount ? (
            <span className={`${styles.navBadge} ${styles.navBadgeDanger}`}>{warningCount}</span>
          ) : null,
      },
    ],
    [awaitingCount, offlineCount, warningCount],
  );

  const activeKey: NavKey =
    route.name === "node-detail" ? "fleet" : route.name === "task-detail" ? "tasks" : route.name;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden>G</div>
          <div>
            <div className={styles.brandTitle}>GPUFleet</div>
            <div className={styles.brandSub}>Control · v0.1</div>
          </div>
        </div>

        <nav className={styles.navSection}>
          <div className={styles.navLabel}>Workspace</div>
          {navItems.map((item) => (
            <a
              key={item.key}
              className={`${styles.navItem}${activeKey === item.key ? ` ${styles.navItemActive}` : ""}`}
              href={buildHash(item.to)}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.to);
              }}
            >
              <span className={styles.navIcon} aria-hidden>{item.icon}</span>
              <span className={styles.navText}>{item.label}</span>
              {item.badge ? item.badge() : null}
            </a>
          ))}
        </nav>

        <div className={styles.foot}>
          <FleetSummary />
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <Breadcrumb route={route} />
          <div className={styles.topbarActions}>
            <FleetPulse online={onlineCount} awaiting={awaitingCount} offline={offlineCount} total={store.nodes.length} />
            <span className={styles.clock} title={now.toISOString()}>
              <span>{formatClock(now)}</span>
            </span>
            <SyncStatus now={now.getTime()} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void store.refresh()}
              disabled={store.loading === "loading"}
              leadingIcon={<RefreshIcon spin={store.loading === "loading"} />}
            >
              {store.loading === "loading" ? "同步中" : "刷新"}
            </Button>
            <Button variant="quiet" size="sm" onClick={onLogout}>
              退出
            </Button>
          </div>
        </header>

        {store.lastError ? (
          <div className={`${styles.banner} ${styles.bannerError}`}>
            <span>控制台数据加载异常</span>
            <span style={{ color: "var(--text-mute)" }}>·</span>
            <span className="mono">{store.lastError}</span>
          </div>
        ) : null}

        <div className={styles.content}>
          <RouteOutlet route={route} />
        </div>
      </div>
    </div>
  );
}

function formatClock(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function FleetPulse({
  online,
  awaiting,
  offline,
  total,
}: {
  online: number;
  awaiting: number;
  offline: number;
  total: number;
}): JSX.Element | null {
  if (total === 0) return null;
  return (
    <div className={styles.fleetPulse} title={`Fleet · ${total} nodes`}>
      <span className={styles.fleetPulseSeg}>
        <span className={`${styles.fleetDot} ${styles.fleetDotOnline}`} />
        <strong>{online}</strong>
      </span>
      <span className={styles.fleetPulseDivider} aria-hidden />
      <span className={styles.fleetPulseSeg}>
        <span className={`${styles.fleetDot} ${styles.fleetDotWait}`} />
        <strong>{awaiting}</strong>
      </span>
      <span className={styles.fleetPulseDivider} aria-hidden />
      <span className={styles.fleetPulseSeg}>
        <span className={`${styles.fleetDot} ${styles.fleetDotOff}`} />
        <strong>{offline}</strong>
      </span>
    </div>
  );
}

function SyncStatus({ now }: { now: number }): JSX.Element {
  const store = useConsoleStore();
  if (!store.lastSyncedAt) {
    return (
      <span className={styles.syncChip}>
        <span className={`${styles.syncDot} ${styles.syncDotIdle}`} />
        等待同步
      </span>
    );
  }
  return (
    <span className={styles.syncChip}>
      <span className={styles.syncDot} />
      {formatRelative(new Date(store.lastSyncedAt).toISOString(), now)}
    </span>
  );
}

function FleetSummary(): JSX.Element {
  const store = useConsoleStore();
  const total = store.nodes.length;
  const online = store.nodes.filter((n) => n.connection_status === "online").length;
  const awaiting = store.nodes.filter((n) => n.onboarding_status === "awaiting_first_heartbeat").length;
  const offline = store.nodes.filter((n) => n.connection_status === "offline").length;
  return (
    <div className={styles.summary}>
      <div className={styles.summaryHead}>
        <span>Fleet</span>
        <span>{total}</span>
      </div>
      <div className={styles.summaryRow}>
        <span><i className={`${styles.summaryDot} ${styles.summaryDotOnline}`} />在线</span>
        <strong>{online}</strong>
      </div>
      <div className={styles.summaryRow}>
        <span><i className={`${styles.summaryDot} ${styles.summaryDotWaiting}`} />待接入</span>
        <strong>{awaiting}</strong>
      </div>
      <div className={styles.summaryRow}>
        <span><i className={`${styles.summaryDot} ${styles.summaryDotOffline}`} />离线</span>
        <strong>{offline}</strong>
      </div>
    </div>
  );
}

function Breadcrumb({ route }: { route: Route }): JSX.Element {
  const store = useConsoleStore();
  const trail: { label: string; to?: Route }[] = [];
  switch (route.name) {
    case "onboarding":
      trail.push({ label: "节点接入" });
      break;
    case "fleet":
      trail.push({ label: "节点舰队" });
      break;
    case "node-detail": {
      trail.push({ label: "节点舰队", to: { name: "fleet" } });
      const node = store.nodes.find((n) => n.node_id === route.nodeId);
      trail.push({ label: node ? node.display_name : route.nodeId });
      break;
    }
    case "tasks":
      trail.push({ label: "任务" });
      break;
    case "task-detail":
      trail.push({ label: "任务", to: { name: "tasks" } });
      trail.push({ label: route.taskId });
      break;
    case "security":
      trail.push({ label: "安全审计" });
      break;
  }
  return (
    <div className={styles.breadcrumb}>
      {trail.map((entry, idx) => {
        const isLast = idx === trail.length - 1;
        return (
          <span key={`${entry.label}-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {entry.to && !isLast ? (
              <a
                href={buildHash(entry.to)}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(entry.to!);
                }}
              >
                {entry.label}
              </a>
            ) : (
              <span className={styles.breadcrumbCurrent}>{entry.label}</span>
            )}
            {!isLast ? <span className={styles.breadcrumbSep}>/</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function RouteOutlet({ route }: { route: Route }): JSX.Element {
  switch (route.name) {
    case "onboarding":
      return <OnboardingView />;
    case "fleet":
      return <FleetView />;
    case "node-detail":
      return <NodeDetailView nodeId={route.nodeId} />;
    case "tasks":
      return <TasksView />;
    case "task-detail":
      return <TaskDetailView taskId={route.taskId} />;
    case "security":
      return <SecurityView />;
  }
}

/* ============================================================
 * Icons
 * ============================================================ */

function NavIcon({ kind }: { kind: "onboarding" | "fleet" | "tasks" | "security" }): JSX.Element {
  const props = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "onboarding":
      return (
        <svg {...props}>
          <path d="M3 8h6" />
          <path d="M9 5l3 3-3 3" />
          <path d="M13 3v10" />
        </svg>
      );
    case "fleet":
      return (
        <svg {...props}>
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      );
    case "tasks":
      return (
        <svg {...props}>
          <path d="M3 4h10" />
          <path d="M3 8h10" />
          <path d="M3 12h6" />
        </svg>
      );
    case "security":
      return (
        <svg {...props}>
          <path d="M8 1.5L13.5 4v3.5c0 3.2-2.4 5.8-5.5 6.5-3.1-.7-5.5-3.3-5.5-6.5V4L8 1.5z" />
        </svg>
      );
  }
}

function RefreshIcon({ spin }: { spin?: boolean }): JSX.Element {
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
      style={spin ? { animation: "spin 0.9s linear infinite" } : undefined}
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}
